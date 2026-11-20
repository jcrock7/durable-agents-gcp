import { describe, expect, it } from "vitest";
import { checkCitations, holdReason, policyFit, route, type MatchResult, type Proposal } from "../dist/index.js";

const match = (types: string[], fraud = false): MatchResult => ({
  invoiceId: "INV-1",
  status: "exception",
  findings: fraud ? [{ code: "BANK_DETAILS_CHANGED", severity: "fraud_signal", message: "bank changed" }] : [],
  exceptionTypes: types,
  totals: { invoiceCents: 0, poMatchedCents: 0 },
});
const proposal = (p: Partial<Proposal>): Proposal => ({
  exceptionType: "unplanned_charge",
  action: "accept_charge",
  rationale: "Freight is allowed [E3].",
  citedEvidence: ["E3"],
  confidence: "high",
  fraudFlag: false,
  fraudReason: "",
  unconfirmed: "",
  alternatives: [],
  evidenceNotes: [],
  ...p,
});
/** A price finding: the contract price on file (null = none) and whether it supports the invoiced price. */
const priced = (contractPriceCents: number | null, contractSupportsInvoice: boolean): MatchResult => ({
  ...match(["price_variance"]),
  findings: [{ code: "PRICE_VARIANCE", severity: "exception", lineNo: 1, message: "price", amountCents: 102_340, details: { poUnitPriceCents: 3365, invoicedUnitPriceCents: 3967, contractPriceCents, contractSupportsInvoice } }],
});
const accept = proposal({ exceptionType: "price_variance", action: "accept_variance" });
const credit = proposal({ exceptionType: "price_variance", action: "request_credit_memo" });
const adj = (amountCents: number) => ({ invoiceId: "INV-1", action: "accept_charge" as const, amountCents, payableCents: 0, basis: [] });

describe("route", () => {
  it("lets a small allowed action through without a person", () => {
    expect(route({ proposal: proposal({}), adjustment: adj(4_500), match: match(["unplanned_charge"]), citationsValid: true })).toMatchObject({ path: "post", needsPerson: false, reasons: [] });
  });

  it("sends actions that always need a person, and amounts over the line, to a person", () => {
    const r = route({ proposal: proposal({ exceptionType: "quantity_variance", action: "short_pay" }), adjustment: adj(250_000), match: match(["quantity_variance"]), citationsValid: true });
    expect(r).toMatchObject({ path: "post", needsPerson: true, message: { recipient: "vendor" } });
    expect(r.reasons).toHaveLength(2);
    expect(route({ proposal: proposal({}), adjustment: adj(-150_000), match: match(["unplanned_charge"]), citationsValid: true }).needsPerson).toBe(true);
  });

  it("flags a classification the match engine does not support", () => {
    const r = route({ proposal: proposal({ exceptionType: "duplicate" }), adjustment: adj(0), match: match(["unplanned_charge"]), citationsValid: true });
    expect(r.reasons[0]).toMatch(/match engine found unplanned_charge/);
  });

  it("escalates fraud signals, escalate actions and low confidence", () => {
    expect(route({ proposal: proposal({}), adjustment: adj(0), match: match(["unplanned_charge"], true), citationsValid: true })).toMatchObject({ path: "escalate", reasons: ["possible fraud", "bank changed"] });
    expect(route({ proposal: proposal({ fraudFlag: true, fraudReason: "look-alike domain" }), adjustment: adj(0), match: match([]), citationsValid: true }).reasons).toContain("look-alike domain");
    expect(route({ proposal: proposal({ action: "escalate", unconfirmed: "no contract price on file" }), adjustment: adj(0), match: match([]), citationsValid: true }).reasons).toEqual(["no contract price on file"]);
    expect(route({ proposal: proposal({ confidence: "low" }), adjustment: adj(0), match: match([]), citationsValid: true }).path).toBe("escalate");
  });

  it("holds for credit memos and waits for receipts", () => {
    expect(route({ proposal: proposal({ exceptionType: "price_variance", action: "request_credit_memo" }), adjustment: adj(10_000), match: match(["price_variance"]), citationsValid: true })).toMatchObject({ path: "hold", invoiceStatus: "on_hold", message: { recipient: "vendor" } });
    expect(route({ proposal: proposal({ exceptionType: "no_receipt", action: "request_receipt_entry" }), adjustment: adj(0), match: match(["no_receipt"]), citationsValid: true })).toMatchObject({ path: "wait", message: { recipient: "receiving" } });
  });
});

describe("policyFit", () => {
  it("rejects accepting a variance the contract price does not support, and points to a credit memo", () => {
    expect(policyFit(accept, priced(3365, false))).toEqual({ fits: false, expected: "request_credit_memo", why: "the invoiced price is above the contract price on file" });
    expect(policyFit(accept, priced(3967, true))).toEqual({ fits: true });
  });

  it("points to escalation when there is no contract price on file", () => {
    expect(policyFit(accept, priced(null, false))).toMatchObject({ fits: false, expected: "escalate" });
    expect(policyFit(credit, priced(null, false))).toMatchObject({ fits: false, expected: "escalate" });
  });

  it("rejects a credit memo when the contract supports the invoice, and accepts one when it does not", () => {
    expect(policyFit(credit, priced(3967, true))).toMatchObject({ fits: false, expected: "accept_variance" });
    expect(policyFit(credit, priced(3365, false))).toEqual({ fits: true });
  });

  it("says nothing when no rule covers the action or there is no price finding", () => {
    expect(policyFit(proposal({}), match(["unplanned_charge"]))).toBeUndefined();
    expect(policyFit(proposal({ action: "short_pay" }), priced(3365, false))).toBeUndefined();
  });

  it("sends a conflict to a person and records the verdict on the route", () => {
    const r = route({ proposal: credit, adjustment: adj(10_000), match: priced(3967, true), citationsValid: true });
    expect(r).toMatchObject({ needsPerson: true, policyFit: { fits: false, expected: "accept_variance" } });
    expect(r.reasons).toEqual(["request_credit_memo does not fit the policy: the contract price on the invoice date supports the invoiced price"]);
  });

  it("records the verdict without changing the path when the rule is not enforced (runs older than the rule)", () => {
    const r = route({ proposal: credit, adjustment: adj(10_000), match: priced(3967, true), citationsValid: true }, undefined, { enforcePolicyFit: false });
    expect(r).toMatchObject({ needsPerson: false, reasons: [], policyFit: { fits: false } });
  });
});

describe("holdReason", () => {
  it("says what a held invoice is waiting for", () => {
    expect(holdReason({ message: { recipient: "vendor", purpose: "" } }, "request_credit_memo")).toMatch(/credit memo from the vendor/);
    expect(holdReason({}, "escalate")).toMatch(/accounts payable specialist/);
  });
});

describe("checkCitations", () => {
  it("accepts only references that exist, from the list and the text", () => {
    expect(checkCitations(proposal({ rationale: "A [E1] and B [E3].", citedEvidence: ["E1"] }), ["E1", "E2", "E3"])).toEqual({ cited: ["E1", "E3"], valid: true });
    expect(checkCitations(proposal({ rationale: "A [E9].", citedEvidence: ["E1"] }), ["E1"])).toEqual({ cited: ["E1"], valid: false });
    expect(checkCitations(proposal({ rationale: "No citations.", citedEvidence: [] }), ["E1"]).valid).toBe(false);
    expect(checkCitations(proposal({ rationale: "Both [E1, E2] agree.", citedEvidence: [] }), ["E1", "E2"])).toEqual({ cited: ["E1", "E2"], valid: true });
  });
});
