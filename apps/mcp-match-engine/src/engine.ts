// The match engine: a deterministic three-way match (invoice, PO, receipts) with explicit
// tolerance rules, a duplicate check, and the money arithmetic for each resolution action.
// Pure functions over integer cents: the same input always gives the same output, and no model
// ever does this arithmetic (ADR-0020: deterministic tools next to model judgment).
import type { Action, Adjustment, DuplicateResult, Finding, MatchInput, MatchResult, PoIn, Tolerance } from "./types.js";

const fmt = (cents: number) => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;

/** Contract price in effect on a date, or undefined if none. */
export function contractPriceOn(input: MatchInput, itemId: string, date: string) {
  return (input.contractPrices[itemId] ?? []).find((c) => c.effectiveFrom <= date && (c.effectiveTo === null || c.effectiveTo >= date));
}

interface LineAnalysis {
  lineNo: number;
  /** Invoiced quantity in the PO's unit. */
  qtyPo: number;
  /** Units per invoiced unit (case quantity when billed by the case). */
  factor: number;
  lineAmount: number;
  poAmount: number;
  priceVariance: number;
  withinTolerance: boolean;
  received: number;
  shortUnits: number;
  /** Price per PO unit as invoiced (may be fractional when billed by the case). */
  invoicedUnitCents: number;
  contractSupports: boolean | null;
  contractPriceCents: number | null;
  poPriceCents: number;
  uomConverted: boolean;
}

function referencedPoMismatch(input: MatchInput): boolean {
  const { po, invoice, lines } = input;
  if (!po || po.vendorId !== invoice.vendorId) return true;
  return lines.some((l) => l.poLineNo !== null && !po.lines.some((p) => p.lineNo === l.poLineNo && p.itemId === l.itemId));
}

function poFitsInvoice(po: PoIn, input: MatchInput): boolean {
  return input.lines
    .filter((l) => l.poLineNo !== null)
    .every((l) => {
      const factor = l.uom === "CS" ? (input.items[l.itemId ?? ""]?.caseQty ?? 1) : 1;
      return po.lines.some((p) => p.itemId === l.itemId && p.quantity === l.quantity * factor);
    });
}

function analyseLines(input: MatchInput, tolerance: Tolerance): LineAnalysis[] {
  const po = input.po!;
  const out: LineAnalysis[] = [];
  for (const l of input.lines) {
    if (l.poLineNo === null) continue;
    const poLine = po.lines.find((p) => p.lineNo === l.poLineNo)!;
    const item = input.items[l.itemId ?? ""];
    const uomConverted = l.uom === "CS" && item?.uom === "EA";
    const factor = uomConverted ? item!.caseQty : 1;
    const qtyPo = l.quantity * factor;
    const lineAmount = l.quantity * l.unitPriceCents;
    const poAmount = qtyPo * poLine.unitPriceCents;
    const priceVariance = lineAmount - poAmount;
    const allowance = Math.min(Math.floor((poAmount * tolerance.pricePct) / 100), tolerance.priceCents);
    const received = input.receivedByPoLine[poLine.lineNo] ?? 0;
    const contract = contractPriceOn(input, poLine.itemId, input.invoice.invoiceDate);
    out.push({
      lineNo: l.lineNo,
      qtyPo,
      factor,
      lineAmount,
      poAmount,
      priceVariance,
      withinTolerance: Math.abs(priceVariance) <= allowance,
      received,
      shortUnits: Math.max(0, qtyPo - received - tolerance.quantity),
      invoicedUnitCents: lineAmount / qtyPo,
      contractSupports: contract ? lineAmount === qtyPo * contract.priceCents : null,
      contractPriceCents: contract?.priceCents ?? null,
      poPriceCents: poLine.unitPriceCents,
      uomConverted,
    });
  }
  return out;
}

const TYPE_OF: Record<string, string> = {
  PRICE_VARIANCE: "price_variance",
  UOM_CONVERTIBLE: "uom_mismatch",
  QUANTITY_OVER_RECEIVED: "quantity_variance",
  NO_RECEIPT: "no_receipt",
  CHARGE_ALLOWED: "unplanned_charge",
  CHARGE_NOT_ALLOWED: "unplanned_charge",
  PO_MISMATCH: "wrong_po",
  DUPLICATE_SUSPECT: "duplicate",
};

/** Three-way match one invoice: price against the PO (within tolerance), quantity against receipts, charges against vendor terms. */
export function runMatch(input: MatchInput, tolerance: Tolerance): MatchResult {
  const findings: Finding[] = [];
  const { invoice, vendor } = input;

  if (invoice.remitBankLast4 !== vendor.bankLast4) {
    findings.push({
      code: "BANK_DETAILS_CHANGED",
      severity: "fraud_signal",
      message: `Invoice asks for payment to account ending ${invoice.remitBankLast4}; the vendor master has ${vendor.bankLast4}.`,
      details: { invoiceBankLast4: invoice.remitBankLast4, vendorBankLast4: vendor.bankLast4 },
    });
  }

  const duplicate = checkDuplicate(input);
  if (duplicate.duplicate) {
    findings.push({
      code: "DUPLICATE_SUSPECT",
      severity: "exception",
      message: `Matches ${duplicate.candidates.map((c) => `${c.invoiceId} (${c.status})`).join(", ")}.`,
      amountCents: invoice.totalCents,
      details: { candidates: duplicate.candidates },
    });
  }

  let poMatchedCents = 0;
  if (referencedPoMismatch(input)) {
    const candidates = input.otherOpenPos.filter((po) => po.vendorId === invoice.vendorId && poFitsInvoice(po, input)).map((po) => po.id);
    findings.push({
      code: "PO_MISMATCH",
      severity: "exception",
      message: input.po
        ? `Invoice lines do not match ${input.po.id} (${input.po.status}).${candidates.length ? ` Open PO${candidates.length > 1 ? "s" : ""} that fit: ${candidates.join(", ")}.` : " No open PO for this vendor fits."}`
        : `PO ${invoice.poId} does not exist.`,
      details: { referencedPo: invoice.poId, candidatePoIds: candidates },
    });
  } else {
    const lines = analyseLines(input, tolerance);
    if (!input.hasReceipts) {
      findings.push({ code: "NO_RECEIPT", severity: "exception", message: `No goods receipt posted for ${input.po!.id}.` });
    }
    for (const a of lines) {
      if (a.uomConverted && a.priceVariance === 0) {
        findings.push({
          code: "UOM_CONVERTIBLE",
          severity: "exception",
          lineNo: a.lineNo,
          message: `Billed by the case (${a.factor} per case): ${a.qtyPo} units at ${fmt(a.poPriceCents)} each, same amount as the PO line.`,
          amountCents: 0,
          details: { factor: a.factor, quantityInPoUnits: a.qtyPo },
        });
      } else if (a.priceVariance !== 0 && !a.withinTolerance) {
        findings.push({
          code: "PRICE_VARIANCE",
          severity: "exception",
          lineNo: a.lineNo,
          message: `Line ${a.lineNo}: ${fmt(a.lineAmount)} invoiced vs ${fmt(a.poAmount)} on the PO (${fmt(a.priceVariance)}).${
            a.contractPriceCents === null
              ? " No contract price on file."
              : a.contractSupports
                ? ` The contract price on the invoice date (${fmt(a.contractPriceCents)}) supports the invoice.`
                : ` The contract price on the invoice date is ${fmt(a.contractPriceCents)}.`
          }`,
          amountCents: a.priceVariance,
          details: {
            poUnitPriceCents: a.poPriceCents,
            invoicedUnitPriceCents: a.invoicedUnitCents,
            contractPriceCents: a.contractPriceCents,
            contractSupportsInvoice: a.contractSupports,
          },
        });
      }
      if (input.hasReceipts && a.shortUnits > 0) {
        findings.push({
          code: "QUANTITY_OVER_RECEIVED",
          severity: "exception",
          lineNo: a.lineNo,
          message: `Line ${a.lineNo}: ${a.qtyPo} invoiced, ${a.received} received (${a.shortUnits} short).`,
          amountCents: Math.round(a.shortUnits * a.invoicedUnitCents),
          details: { invoiced: a.qtyPo, received: a.received, shortUnits: a.shortUnits },
        });
      }
      poMatchedCents += Math.min(a.lineAmount, a.poAmount);
    }
  }

  for (const charge of input.lines.filter((l) => l.poLineNo === null)) {
    const amount = charge.quantity * charge.unitPriceCents;
    const allowed = vendor.freightTerms === "add" && amount <= vendor.freightCapCents;
    findings.push({
      code: allowed ? "CHARGE_ALLOWED" : "CHARGE_NOT_ALLOWED",
      severity: "exception",
      lineNo: charge.lineNo,
      message: `Line ${charge.lineNo} "${charge.description}" (${fmt(amount)}) is not on the PO. Vendor freight terms: ${vendor.freightTerms}${
        vendor.freightTerms === "add" ? `, cap ${fmt(vendor.freightCapCents)}` : ""
      }.`,
      amountCents: amount,
    });
  }

  const exceptionFindings = findings.filter((f) => f.severity !== "info");
  return {
    invoiceId: invoice.id,
    status: exceptionFindings.length ? "exception" : "matched",
    findings,
    exceptionTypes: [...new Set(findings.map((f) => TYPE_OF[f.code]).filter((t): t is string => Boolean(t)))],
    totals: { invoiceCents: invoice.totalCents, poMatchedCents },
  };
}

/** Strip the suffixes vendors add when re-sending an invoice (ABC-1234-R, ABC-1234-COPY2). */
export function normalizeInvoiceNumber(n: string): string {
  return n.trim().toUpperCase().replace(/[-\s]*(R|A|RESEND|RESENT|COPY|DUP)\d*$/, "");
}

/** Look for the same invoice already in the vendor's history: same PO and amount, or the same number once re-send suffixes are removed. */
export function checkDuplicate(input: MatchInput): DuplicateResult {
  const { invoice } = input;
  const number = normalizeInvoiceNumber(invoice.vendorInvoiceNumber);
  const candidates = input.history
    .filter((h) => h.id !== invoice.id)
    .map((h) => {
      const reasons: string[] = [];
      if (normalizeInvoiceNumber(h.vendorInvoiceNumber) === number) reasons.push(`same invoice number (${h.vendorInvoiceNumber})`);
      if (h.poId === invoice.poId && h.totalCents === invoice.totalCents) reasons.push(`same PO and amount (${h.poId}, ${fmt(h.totalCents)})`);
      return { invoiceId: h.id, vendorInvoiceNumber: h.vendorInvoiceNumber, status: h.status, reasons };
    })
    .filter((c) => c.reasons.length > 0);
  // A duplicate of an invoice that was already accepted (paid, matched or resolved).
  return { invoiceId: invoice.id, duplicate: candidates.some((c) => ["paid", "resolved", "matched"].includes(c.status)), candidates };
}

/** The money for a proposed action, computed from the match, never by a model. */
export function computeAdjustment(input: MatchInput, action: Action, tolerance: Tolerance): Adjustment {
  const total = input.invoice.totalCents;
  const result = runMatch(input, tolerance);
  const of = (code: string) => result.findings.filter((f) => f.code === code);
  const sum = (fs: Finding[]) => fs.reduce((s, f) => s + (f.amountCents ?? 0), 0);
  const basis = (fs: Finding[]) => fs.map((f) => f.message);
  const out = (amountCents: number, payableCents: number | null, b: string[]): Adjustment => ({ invoiceId: input.invoice.id, action, amountCents, payableCents, basis: b });

  switch (action) {
    case "accept_variance": {
      const v = of("PRICE_VARIANCE");
      return out(sum(v), total, basis(v));
    }
    case "request_credit_memo": {
      const v = [...of("PRICE_VARIANCE").filter((f) => (f.amountCents ?? 0) > 0), ...of("CHARGE_NOT_ALLOWED")];
      const credit = sum(v);
      return out(credit, total - credit, basis(v));
    }
    case "short_pay": {
      const s = of("QUANTITY_OVER_RECEIVED");
      return out(sum(s), total - sum(s), basis(s));
    }
    case "accept_charge": {
      const c = of("CHARGE_ALLOWED");
      return out(sum(c), total, basis(c));
    }
    case "accept_uom_conversion":
      return out(0, total, basis(of("UOM_CONVERTIBLE")));
    case "reject_duplicate":
      return out(total, 0, basis(of("DUPLICATE_SUSPECT")));
    case "wait_for_receipt":
    case "request_receipt_entry":
    case "reassign_po":
    case "escalate":
      return out(0, null, [`${action}: no money changes until the case is settled.`]);
  }
}
