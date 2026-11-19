import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMatchServer, type MatchInput } from "../dist/index.js";
import { rowsOf } from "../dist/load.js";

const input: MatchInput = {
  invoice: { id: "INV-1", vendorId: "V-1", vendorInvoiceNumber: "ABC-1", poId: "PO-1", invoiceDate: "2026-11-03", totalCents: 478_800, status: "exception", remitBankLast4: "1111" },
  lines: [{ lineNo: 1, poLineNo: 1, itemId: "ITM-1", description: "Rivet", quantity: 1200, uom: "EA", unitPriceCents: 399 }],
  po: { id: "PO-1", vendorId: "V-1", status: "open", issuedOn: "2026-09-10", lines: [{ lineNo: 1, itemId: "ITM-1", quantity: 1200, unitPriceCents: 292 }] },
  receivedByPoLine: { 1: 1200 },
  hasReceipts: true,
  vendor: { id: "V-1", bankLast4: "1111", freightTerms: "prepaid", freightCapCents: 0 },
  items: { "ITM-1": { uom: "EA", caseQty: 50 } },
  contractPrices: { "ITM-1": [{ id: "cp-1", priceCents: 292, effectiveFrom: "2026-01-01", effectiveTo: "2026-09-30" }, { id: "cp-2", priceCents: 399, effectiveFrom: "2026-10-01", effectiveTo: null }] },
  history: [],
  otherOpenPos: [],
};

let client: Client;
beforeAll(async () => {
  const load = async (id: string) => {
    if (id !== "INV-1") throw Object.assign(new Error(`invoice ${id} not found`), { name: "NotFoundError" });
    return input;
  };
  const [c, s] = InMemoryTransport.createLinkedPair();
  await createMatchServer({ load, tolerance: { pricePct: 2, priceCents: 5000, quantity: 0 } }).connect(s);
  client = new Client({ name: "test", version: "1" });
  await client.connect(c);
});
afterAll(async () => client.close());

type Result = { content: Array<{ text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };

describe("match-engine MCP server", () => {
  it("offers three read-only tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["check_duplicate", "compute_adjustment", "run_match"]);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
  });

  it("returns the match and the adjustment as JSON", async () => {
    const match = (await client.callTool({ name: "run_match", arguments: { invoice_id: "INV-1" } })) as Result;
    expect(match.structuredContent).toMatchObject({ status: "exception", exceptionTypes: ["price_variance"] });
    const adj = (await client.callTool({ name: "compute_adjustment", arguments: { invoice_id: "INV-1", action: "request_credit_memo" } })) as Result;
    expect(JSON.parse(adj.content[0]!.text)).toMatchObject({ amountCents: 128_400 });
  });

  it("applies a caller's tolerance", async () => {
    const loose = (await client.callTool({ name: "run_match", arguments: { invoice_id: "INV-1", price_tolerance_pct: 50, price_tolerance_cents: 1_000_000 } })) as Result;
    expect(loose.structuredContent).toMatchObject({ status: "matched" });
  });

  it("rejects bad arguments and reports unknown invoices as tool errors", async () => {
    const bad = (await client.callTool({ name: "compute_adjustment", arguments: { invoice_id: "INV-1", action: "pay_twice" } })) as Result;
    expect(bad.isError).toBe(true);
    const missing = (await client.callTool({ name: "run_match", arguments: { invoice_id: "INV-999" } })) as Result;
    expect(missing.isError).toBe(true);
    expect(missing.content[0]!.text).toMatch(/not found/);
  });
});

describe("rowsOf", () => {
  it("reads one JSON row per text block, and none from an empty result", () => {
    expect(rowsOf({ content: [{ type: "text", text: '{"id":"a"}' }, { type: "text", text: '{"id":"b"}' }] })).toEqual([{ id: "a" }, { id: "b" }]);
    expect(rowsOf({ content: [] })).toEqual([]);
    expect(rowsOf({ content: [{ type: "text", text: "null" }] })).toEqual([]);
    expect(() => rowsOf({ content: [{ type: "text", text: "boom" }], isError: true })).toThrow(/boom/);
  });
});
