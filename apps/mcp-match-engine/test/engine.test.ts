import { describe, expect, it } from "vitest";
import { agentConfig } from "@agents/invoice-exception-resolver";
import { generateErp, type ErpData } from "@agents/invoice-exception-resolver/data";
import { checkDuplicate, computeAdjustment, normalizeInvoiceNumber, runMatch, type Action, type MatchInput } from "../dist/index.js";

const data: ErpData = generateErp();
const tolerance = agentConfig.tolerance;

/** The input erp-read would give the engine for one invoice, built straight from the generator. */
function inputFor(invoiceId: string): MatchInput {
  const invoice = data.invoices.find((i) => i.id === invoiceId)!;
  const toPo = (id: string) => {
    const po = data.purchaseOrders.find((p) => p.id === id);
    return po && { ...po, lines: data.poLines.filter((l) => l.poId === id).map(({ lineNo, itemId, quantity, unitPriceCents }) => ({ lineNo, itemId, quantity, unitPriceCents })) };
  };
  const receipts = data.receipts.filter((g) => g.poId === invoice.poId);
  const receivedByPoLine: Record<number, number> = {};
  for (const g of receipts) for (const l of data.receiptLines.filter((x) => x.receiptId === g.id)) receivedByPoLine[l.poLineNo] = (receivedByPoLine[l.poLineNo] ?? 0) + l.quantity;
  const lines = data.invoiceLines.filter((l) => l.invoiceId === invoiceId);
  const itemIds = [...new Set(lines.map((l) => l.itemId).filter((x): x is string => x !== null))];
  const vendor = data.vendors.find((v) => v.id === invoice.vendorId)!;
  return {
    invoice,
    lines,
    po: toPo(invoice.poId) ?? null,
    receivedByPoLine,
    hasReceipts: receipts.length > 0,
    vendor,
    items: Object.fromEntries(itemIds.map((id) => [id, data.items.find((i) => i.id === id)!])),
    contractPrices: Object.fromEntries(itemIds.map((id) => [id, data.contractPrices.filter((c) => c.itemId === id).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))])),
    history: data.invoices.filter((i) => i.vendorId === invoice.vendorId && i.id !== invoiceId),
    otherOpenPos: data.purchaseOrders.filter((p) => p.vendorId === invoice.vendorId && p.status === "open" && p.id !== invoice.poId).map((p) => toPo(p.id)!),
  };
}

const MONEY_ACTIONS: Action[] = ["accept_variance", "request_credit_memo", "short_pay", "accept_uom_conversion", "accept_charge", "reject_duplicate"];

describe("match engine on every seeded exception", () => {
  for (const label of data.labels) {
    it(`${label.scenario} ${label.invoiceId}`, () => {
      const input = inputFor(label.invoiceId);
      const result = runMatch(input, tolerance);
      expect(result.status).toBe("exception");
      expect(result.exceptionTypes).toContain(label.expectedType);

      const codes = result.findings.map((f) => f.code);
      expect(codes.includes("BANK_DETAILS_CHANGED")).toBe(label.fraudFlag);

      if (label.amountCents !== undefined && MONEY_ACTIONS.includes(label.expectedAction as Action)) {
        expect(computeAdjustment(input, label.expectedAction as Action, tolerance).amountCents).toBe(label.amountCents);
      }

      const price = result.findings.find((f) => f.code === "PRICE_VARIANCE");
      switch (label.scenario) {
        case "price_variance_contract":
          expect(price?.details?.contractSupportsInvoice).toBe(true);
          break;
        case "price_overcharge":
          expect(price?.details?.contractSupportsInvoice).toBe(false);
          break;
        case "missing_evidence":
          expect(price?.details?.contractPriceCents).toBeNull();
          break;
        case "wrong_po":
          expect(result.findings.find((f) => f.code === "PO_MISMATCH")?.details?.candidatePoIds).toContain(label.evidence[0]);
          break;
        case "duplicate_resent":
          expect(checkDuplicate(input).candidates.map((c) => c.invoiceId)).toContain(label.evidence[0]);
          expect(computeAdjustment(input, "reject_duplicate", tolerance).payableCents).toBe(0);
          break;
        case "receipt_in_transit":
        case "receipt_not_entered":
          expect(codes).toContain("NO_RECEIPT");
          break;
      }
    });
  }
});

describe("match engine on clean invoices", () => {
  it("matches every invoice that is not a seeded exception", () => {
    const exceptionIds = new Set(data.exceptions.map((e) => e.invoiceId));
    const clean = data.invoices.filter((i) => !exceptionIds.has(i.id));
    expect(clean.length).toBeGreaterThan(800);
    const mismatched = clean.map((i) => runMatch(inputFor(i.id), tolerance)).filter((r) => r.status !== "matched");
    expect(mismatched.map((r) => `${r.invoiceId}: ${r.findings.map((f) => f.code).join(",")}`)).toEqual([]);
  });
});

describe("tolerance and arithmetic", () => {
  const base = inputFor("INV-20931");

  it("is deterministic", () => {
    expect(JSON.stringify(runMatch(base, tolerance))).toBe(JSON.stringify(runMatch(base, tolerance)));
  });

  it("passes a variance within the lower of the percentage and cents limits", () => {
    const line = base.lines[0]!;
    const po = base.po!.lines.find((l) => l.lineNo === line.poLineNo)!;
    const poAmount = po.quantity * po.unitPriceCents; // 1,200 × $2.92 = $3,504.00; 2% = $70.08, cap $50.00
    expect(poAmount).toBe(350_400);
    const at = (unitPriceCents: number, quantity = 1200) => ({ ...base, lines: [{ ...line, unitPriceCents, quantity }, ...base.lines.slice(1)] });
    // +4 cents × 1,200 = $48.00: within $50.00
    expect(runMatch(at(296), tolerance).findings.some((f) => f.code === "PRICE_VARIANCE")).toBe(false);
    // +5 cents × 1,200 = $60.00: within 2% ($70.08) but over $50.00, so it fails
    expect(runMatch(at(297), tolerance).findings.some((f) => f.code === "PRICE_VARIANCE")).toBe(true);
    // Under-billing is a variance too
    expect(runMatch(at(250), tolerance).findings.find((f) => f.code === "PRICE_VARIANCE")?.amountCents).toBe(-50_400);
  });

  it("computes credit, short-pay and payable amounts in integer cents", () => {
    const credit = computeAdjustment(base, "request_credit_memo", tolerance);
    expect(credit).toMatchObject({ amountCents: 128_400, payableCents: base.invoice.totalCents - 128_400 });
    expect(computeAdjustment(base, "accept_variance", tolerance)).toMatchObject({ amountCents: 128_400, payableCents: base.invoice.totalCents });
    expect(computeAdjustment(base, "escalate", tolerance)).toMatchObject({ amountCents: 0, payableCents: null });
    for (const action of MONEY_ACTIONS) expect(Number.isInteger(computeAdjustment(base, action, tolerance).amountCents)).toBe(true);
  });

  it("normalizes re-sent invoice numbers", () => {
    expect(normalizeInvoiceNumber("ald-1945-R")).toBe("ALD-1945");
    expect(normalizeInvoiceNumber("ALD-1945 COPY2")).toBe("ALD-1945");
    expect(normalizeInvoiceNumber("ALD-1945")).toBe("ALD-1945");
  });
});
