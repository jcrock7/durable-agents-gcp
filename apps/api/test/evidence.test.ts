import { describe, expect, it } from "vitest";
import { evidenceSummaries, recordsOf, summarizeEvidence } from "../dist/evidence.js";

const state = { invoice: { vendorInvoiceNumber: "ALD-1945", invoiceDate: "2026-11-03", poReference: "PO-7951", totalDue: "$49,113.60" } };
const prices = [
  '{"id":"cp-80008","vendor_id":"V-0101","item_id":"ITM-1008","price_cents":292,"effective_from":"2026-01-01T00:00:00Z","effective_to":"2026-09-30T00:00:00Z"}',
  '{"id":"cp-80200","vendor_id":"V-0101","item_id":"ITM-1008","price_cents":399,"effective_from":"2026-10-01T00:00:00Z","effective_to":null}',
].join("\n");

describe("evidence summaries", () => {
  it("names the contract price in effect on the invoice date, not the first row", () => {
    const s = summarizeEvidence({ ref: "E3", source: "erp-read:get_contract_prices", excerpt: prices }, state);
    expect(s.title).toBe("Contract Price");
    expect(s.body).toBe("ITM-1008: $3.99 a unit, in effect on the invoice date (3 Nov 2026); valid 1 Oct 2026 onward. Other prices on file: $2.92 (1 Jan 2026 to 30 Sept 2026).".replace("Sept", new Date("2026-09-30T00:00:00Z").toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })));
  });

  it("says so when no contract price covers the invoice date", () => {
    const s = summarizeEvidence({ source: "erp-read:get_contract_prices", excerpt: prices.split("\n")[0] }, { invoice: { invoiceDate: "2026-11-03" } });
    expect(s.body).toMatch(/^ITM-1008: \$2\.92 \(1 Jan 2026 to 30 Sep[t]? 2026\)\. None is in effect on the invoice date \(3 Nov 2026\)\.$/);
  });

  it("summarises a vendor message and counts the rest", () => {
    const msg = (id: string) => JSON.stringify({ id, sent_at: "2026-09-21T16:49:00Z", from_address: "ar@alder-fasteners.example", subject: "Price change notice", body: "Dear customer,\n\nThe price changes." });
    const s = summarizeEvidence({ source: "erp-read:search_vendor_messages", excerpt: `${msg("MSG-1")}\n${msg("MSG-2")}` }, state);
    expect(s.title).toBe("Vendor Message, 21 Sep 2026".replace("Sep", new Date("2026-09-21T00:00:00Z").toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })));
    expect(s.body).toBe("“Price change notice” from ar@alder-fasteners.example. Dear customer, The price changes. 1 more message in the raw output.");
  });

  it("formats the match engine's figures and drops the finding code", () => {
    const s = summarizeEvidence({ source: "match-engine:run_match", excerpt: "PRICE_VARIANCE: Line 1: $4788.00 invoiced vs $3504.00 on the PO ($1284.00)." }, state);
    expect(s).toEqual({ title: "Three-Way Match", body: "Line 1: $4,788.00 invoiced vs $3,504.00 on the PO ($1,284.00)." });
  });

  it("describes the invoice document from the case, an empty search, and a cut-off result", () => {
    expect(summarizeEvidence({ source: "docs:read_pdf_text", excerpt: "Alder Fasteners\nINVOICE" }, state, "2027-01-02")).toEqual({ title: "Invoice ALD-1945", body: "Dated 3 Nov 2026, for PO-7951, due 2 Jan 2027, total $49,113.60." });
    expect(summarizeEvidence({ source: "erp-read:search_vendor_messages", excerpt: "(no rows)" }, state).body).toBe("The search returned nothing.");
    const cutOff = `${prices}\n{"id":"cp-9","vendor_id":"V-0\n[cut at 1500 characters]`;
    expect(recordsOf(cutOff)).toMatchObject({ truncated: true, rows: [{ id: "cp-80008" }, { id: "cp-80200" }] });
    expect(summarizeEvidence({ source: "erp-read:get_contract_prices", excerpt: cutOff }, state).body).toMatch(/cut short/);
  });

  it("keys the summaries by reference", () => {
    expect(Object.keys(evidenceSummaries({ ...state, evidence: [{ ref: "E1", source: "match-engine:run_match", excerpt: "X: ok" }, { ref: "E2", source: "erp-read:get_po", excerpt: '{"id":"PO-1","status":"open"}' }] }))).toEqual(["E1", "E2"]);
  });
});
