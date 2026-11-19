import { describe, expect, it } from "vitest";
import {
  DEMO_INVOICE_ID,
  documents,
  generateErp,
  HIDDEN_INSTRUCTION,
  invoicePdf,
  readPdfText,
  SCENARIO_COUNTS,
  seedSql,
  writePdf,
  type ErpData,
} from "../dist/data/index.js";

const data: ErpData = generateErp();

describe("synthetic ERP generator", () => {
  it("is deterministic for a seed and differs across seeds", () => {
    expect(JSON.stringify(generateErp())).toBe(JSON.stringify(data));
    expect(JSON.stringify(generateErp(7))).not.toBe(JSON.stringify(data));
  });

  it("seeds every scenario the business case needs, one label per open exception", () => {
    const total = Object.values(SCENARIO_COUNTS).reduce((a, b) => a + b, 0);
    expect(data.exceptions).toHaveLength(total);
    expect(data.labels).toHaveLength(total);
    for (const [scenario, count] of Object.entries(SCENARIO_COUNTS)) {
      expect(data.labels.filter((l) => l.scenario === scenario), scenario).toHaveLength(count);
    }
    for (const ex of data.exceptions) {
      expect(data.invoices.find((i) => i.id === ex.invoiceId)?.status).toBe("exception");
      expect(data.labels.some((l) => l.exceptionId === ex.id && l.invoiceId === ex.invoiceId)).toBe(true);
    }
    expect(data.exceptions.length / data.invoices.length).toBeGreaterThan(0.08);
    expect(data.exceptions.length / data.invoices.length).toBeLessThan(0.12);
  });

  it("keeps references intact", () => {
    const ids = (rows: Array<{ id: string }>) => new Set(rows.map((r) => r.id));
    const vendors = ids(data.vendors);
    const items = ids(data.items);
    const pos = ids(data.purchaseOrders);
    const invoices = ids(data.invoices);
    expect(data.items.every((i) => vendors.has(i.vendorId))).toBe(true);
    expect(data.poLines.every((l) => pos.has(l.poId) && items.has(l.itemId))).toBe(true);
    expect(data.receipts.every((g) => pos.has(g.poId))).toBe(true);
    expect(data.invoices.every((i) => pos.has(i.poId) && vendors.has(i.vendorId))).toBe(true);
    expect(data.invoiceLines.every((l) => invoices.has(l.invoiceId) && (l.itemId === null || items.has(l.itemId)))).toBe(true);
    expect(data.messages.every((m) => vendors.has(m.vendorId))).toBe(true);
    for (const inv of data.invoices) {
      const sum = data.invoiceLines.filter((l) => l.invoiceId === inv.id).reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);
      expect(inv.totalCents, inv.id).toBe(sum);
    }
    expect(new Set(data.invoices.map((i) => i.id)).size).toBe(data.invoices.length);
  });

  it("builds the demo case: 1,200 units, contract price $2.92 → $3.99, vendor notice on file", () => {
    const label = data.labels.find((l) => l.invoiceId === DEMO_INVOICE_ID)!;
    expect(label).toMatchObject({ scenario: "price_variance_contract", expectedAction: "accept_variance", needsPerson: true, amountCents: 128_400 });
    const line = data.invoiceLines.find((l) => l.invoiceId === DEMO_INVOICE_ID && l.lineNo === 1)!;
    expect(line).toMatchObject({ quantity: 1200, unitPriceCents: 399 });
    const prices = data.contractPrices.filter((c) => c.itemId === line.itemId).map((c) => c.priceCents);
    expect(prices).toEqual([292, 399]);
    expect(data.messages.some((m) => m.subject.startsWith("Price change notice") && m.body.includes("$2.92") && m.body.includes("$3.99"))).toBe(true);
  });

  it("makes each scenario's evidence true in the data", () => {
    for (const l of data.labels.filter((x) => x.scenario === "quantity_short")) {
      const inv = data.invoices.find((i) => i.id === l.invoiceId)!;
      const line = data.invoiceLines.find((x) => x.invoiceId === inv.id && x.lineNo === 1)!;
      const receipt = data.receipts.find((g) => g.poId === inv.poId)!;
      const received = data.receiptLines.find((g) => g.receiptId === receipt.id && g.poLineNo === line.poLineNo)!.quantity;
      expect(received).toBeLessThan(line.quantity);
      expect(l.amountCents).toBe((line.quantity - received) * line.unitPriceCents);
    }
    for (const l of data.labels.filter((x) => x.scenario === "receipt_in_transit" || x.scenario === "receipt_not_entered")) {
      const inv = data.invoices.find((i) => i.id === l.invoiceId)!;
      expect(data.receipts.some((g) => g.poId === inv.poId)).toBe(false);
    }
    for (const l of data.labels.filter((x) => x.scenario === "missing_evidence")) {
      const line = data.invoiceLines.find((x) => x.invoiceId === l.invoiceId && x.lineNo === 1)!;
      expect(data.contractPrices.some((c) => c.itemId === line.itemId)).toBe(false);
    }
    for (const l of data.labels.filter((x) => x.scenario === "uom_mismatch")) {
      const inv = data.invoices.find((i) => i.id === l.invoiceId)!;
      const line = data.invoiceLines.find((x) => x.invoiceId === inv.id && x.lineNo === 1)!;
      const poLine = data.poLines.find((p) => p.poId === inv.poId && p.lineNo === line.poLineNo)!;
      expect(line.uom).toBe("CS");
      expect(line.quantity * line.unitPriceCents).toBe(poLine.quantity * poLine.unitPriceCents);
    }
    for (const l of data.labels.filter((x) => x.scenario === "bank_change_request")) {
      const inv = data.invoices.find((i) => i.id === l.invoiceId)!;
      expect(inv.remitBankLast4).not.toBe(data.vendors.find((v) => v.id === inv.vendorId)!.bankLast4);
      expect(l.fraudFlag).toBe(true);
    }
    for (const l of data.labels.filter((x) => x.scenario === "duplicate_resent")) {
      const dup = data.invoices.find((i) => i.id === l.invoiceId)!;
      const original = data.invoices.find((i) => i.id === l.evidence[0])!;
      expect(original.status).toBe("paid");
      expect(dup.totalCents).toBe(original.totalCents);
      expect(dup.poId).toBe(original.poId);
    }
  });

  it("puts hidden instructions only in the seeded injection invoices", () => {
    expect(data.hiddenTextInvoices).toHaveLength(SCENARIO_COUNTS.hidden_instructions);
    const hidden = data.invoices.find((i) => i.id === data.hiddenTextInvoices[0])!;
    expect(readPdfText(invoicePdf(data, hidden))).toContain(HIDDEN_INSTRUCTION);
    const demo = data.invoices.find((i) => i.id === DEMO_INVOICE_ID)!;
    expect(readPdfText(invoicePdf(data, demo)).join("\n")).not.toContain("AUTOMATED SYSTEMS");
  });

  it("writes a document for every invoice and message", () => {
    const docs = documents(data);
    expect(docs.size).toBe(data.invoices.length + data.messages.length);
    expect(docs.get(`invoices/${DEMO_INVOICE_ID}.pdf`)).toBeInstanceOf(Uint8Array);
  });

  it("keeps eval labels out of the seed SQL", () => {
    const sql = seedSql(data);
    expect(sql).toContain("CREATE TABLE erp.invoices");
    expect(sql).toContain("GRANT SELECT ON ALL TABLES IN SCHEMA erp TO erp_reader");
    expect(sql).not.toMatch(/expectedAction|accept_uom_conversion|hidden_instructions/);
  });
});

describe("PDF text round trip", () => {
  it("escapes and recovers parentheses and backslashes, and rejects non-ASCII", () => {
    const pdf = writePdf([{ text: "Total (net) \\ $1.00", x: 10, y: 10 }], "t");
    expect(readPdfText(pdf)).toEqual(["Total (net) \\ $1.00"]);
    expect(() => writePdf([{ text: "café", x: 0, y: 0 }], "t")).toThrow(/ASCII/);
    expect(() => readPdfText(new TextEncoder().encode("not a pdf"))).toThrow(/not a PDF/);
  });
});
