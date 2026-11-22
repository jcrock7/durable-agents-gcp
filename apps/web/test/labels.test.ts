import { describe, expect, it } from "vitest";
import { ago, caseGroup, caseTag, plain, requestError, sourceLabel, titleCase, until, type CaseSummary } from "../src/api.js";
import { nextStep } from "../src/CaseTable.js";
import { approveEffect, decisionOutcome, escalateEffect, sendBackEffect } from "../src/effects.js";
import { stepTime } from "../src/StepStrip.js";

const c = (p: Partial<CaseSummary>): CaseSummary => ({
  workflowId: "inv-1",
  agentId: "invoice-exception-resolver",
  ref: "INV-1",
  title: "INV-1 · price variance",
  stage: "done",
  status: null,
  temporalStatus: "COMPLETED",
  needsPerson: false,
  startedAt: "2026-11-20T00:00:00.000Z",
  costUsd: 0,
  detail: "",
  ...p,
});

describe("labels", () => {
  it("title-cases short labels, keeping small words low and acronyms high", () => {
    expect(titleCase("accept_variance")).toBe("Accept Variance");
    expect(titleCase("read invoice PDF")).toBe("Read Invoice PDF");
    expect(titleCase("waiting on receipt")).toBe("Waiting on Receipt");
    expect(titleCase("ap-resolution-policy")).toBe("AP Resolution Policy");
    expect(titleCase(undefined)).toBe("");
  });

  it("turns workflow text into plain language", () => {
    expect(plain("accept_variance always needs a person")).toBe("Accept variance always needs a person");
    expect(plain("amount 1023.40 is over the 1000.00 approval line")).toBe("$1,023.40 is over the $1,000.00 approval line");
    expect(plain("Finished: on_hold")).toBe("Finished: on hold");
  });

  it("never capitalises an identifier at the start, such as a username", () => {
    expect(plain("local-user · reason: buyer agreed")).toBe("local-user · reason: buyer agreed");
    expect(plain("ap.lead")).toBe("ap.lead");
    expect(plain("jcrocker@example.com")).toBe("jcrocker@example.com");
    expect(plain("approved")).toBe("Approved");
    expect(plain("accept_variance · 1284.00")).toBe("Accept variance · $1,284.00");
    expect(plain("Accepted the $1284.00 variance.")).toBe("Accepted the $1,284.00 variance.");
    expect(plain("Version 1.3 of the skill")).toBe("Version 1.3 of the skill");
  });

  it("turns failed requests into sentences a reviewer can act on", () => {
    expect(requestError(502)).toBe("The portal API is not responding (HTTP 502). It is retried automatically");
    expect(requestError(401)).toMatch(/sign-in has expired/);
    expect(requestError(409, "not waiting for review")).toBe("Not waiting for review");
  });

  it("names tool sources by system and subject", () => {
    expect(sourceLabel("erp-read:get_contract_prices")).toBe("ERP · Contract Prices");
    expect(sourceLabel("match-engine:run_match")).toBe("Match Engine · Match");
    expect(sourceLabel("docs:read_pdf_text")).toBe("Documents · PDF Text");
  });
});

describe("case states", () => {
  it("uses one name per state", () => {
    expect(caseTag(c({ needsPerson: true, stage: "awaiting_review", temporalStatus: "RUNNING" }))).toEqual(["warn", "Needs Decision"]);
    expect(caseTag(c({ status: "on_hold" }))).toEqual(["idle", "On Hold"]);
    expect(caseTag(c({ status: "terminated", temporalStatus: "TERMINATED" }))).toEqual(["idle", "Cancelled"]);
    expect(caseTag(c({ status: "blocked" }))).toEqual(["crit", "Blocked"]);
    expect(caseTag(c({ status: "resolved" }))).toEqual(["ok", "Resolved"]);
  });

  it("groups what a person still has to watch", () => {
    expect(caseGroup(c({ stage: "waiting", temporalStatus: "RUNNING" }))).toBe("waiting");
    expect(caseGroup(c({ stage: "gathering_evidence", temporalStatus: "RUNNING" }))).toBe("running");
    expect(caseGroup(c({ status: "rejected_by_reviewer" }))).toBe("closed");
    expect(caseGroup(c({ stage: "done", status: null, temporalStatus: "FAILED" }))).toBe("cancelled");
    expect(caseTag(c({ stage: "done", status: null, temporalStatus: "FAILED" }))).toEqual(["idle", "Failed"]);
  });

  it("says what happens next from the recorded reason, falling back to the latest step", () => {
    expect(nextStep(c({ status: "on_hold", detail: "Finished: on_hold", reason: "waiting for a credit memo from the vendor; released when the credit is recorded" }))).toBe("Waiting for a credit memo from the vendor; released when the credit is recorded");
    expect(nextStep(c({ status: "resolved", detail: "Finished: resolved", reason: "the invoice now matches" }))).toBe("Finished: resolved");
    expect(nextStep(c({ stage: "waiting", detail: "Waiting for receipt: re-checks daily" }))).toBe("Waiting for receipt: re-checks daily");
  });
});

describe("decision bar", () => {
  const base = { actionLabel: "Accept Variance", ref: "INV-20267" };

  it("states the payment effect of approving a posting action", () => {
    expect(approveEffect({ ...base, path: "post", amountCents: 102_340, payableCents: 981_330 })).toBe("“Accept Variance” for $1,023.40 is written to the ERP and the exception on case INV-20267 is cleared, and the invoice becomes payable for $9,813.30.");
    expect(approveEffect({ ...base, actionLabel: "Reject Duplicate", path: "post", amountCents: 0, payableCents: 0, messageTo: "vendor" })).toBe("“Reject Duplicate” is written to the ERP and the exception on case INV-20267 is cleared, and nothing is paid on the invoice. A message is sent to the vendor.");
  });

  it("says a held invoice is not paid, and omits payment when the action does not settle it", () => {
    expect(approveEffect({ ...base, actionLabel: "Request Credit Memo", path: "hold", amountCents: 102_340, payableCents: 878_990, messageTo: "vendor" })).toBe("“Request Credit Memo” for $1,023.40 is recorded in the ERP for case INV-20267 and the invoice stays on hold. Nothing is paid yet. A message is sent to the vendor.");
    expect(approveEffect({ ...base, path: "post", payableCents: null })).toBe("“Accept Variance” is written to the ERP and the exception on case INV-20267 is cleared.");
    // Waiting for a receipt is a hold, approved first.
    expect(approveEffect({ ...base, path: "wait" })).toBe("the invoice is put on hold in the ERP, so it is not paid, and case INV-20267 waits for the goods receipt, re-checking daily.");
  });

  it("describes sending back and escalating", () => {
    expect(sendBackEffect("Invoice Resolver", 1)).toMatch(/brings draft 2 back to you/);
    expect(escalateEffect("INV-20267")).toMatch(/nothing is posted.*Escalated for an AP specialist/);
  });
});

describe("step strip", () => {
  it("shows the clock for the first step, elapsed time after it and Now for the current one", () => {
    const t = [
      { at: "2026-11-20T00:39:52.000Z", state: "done" },
      { at: "2026-11-20T00:40:01.000Z", state: "done" },
      { at: "2026-11-20T00:45:52.000Z", state: "done" },
      { at: "2026-11-20T00:46:00.000Z", state: "now" },
    ];
    expect(stepTime(t, 1)).toBe("+9 sec");
    expect(stepTime(t, 2)).toBe("+6 min");
    expect(stepTime(t, 3)).toBe("Now");
  });
});

describe("decision receipt", () => {
  const base = { actionLabel: "Accept Variance", ref: "INV-20931", amountCents: 128_400, payableCents: 4_911_360 };

  it("reports an approved and posted decision with the reason given", () => {
    const o = decisionOutcome({ ...base, path: "post", decision: { reviewer: "jcrocker", approvedAt: "2026-11-21T07:37:29.237Z", postedAt: "2026-11-21T07:37:29.483Z", approvalReason: "vendor notice on file", sentBack: 0 } });
    expect(o?.tone).toBe("ok");
    expect(o?.title).toBe("Approved by jcrocker");
    expect(o?.body).toMatch(/^“Accept Variance” for \$1,284\.00 was written to the ERP on 21 Nov 2026, \d\d:\d\d\. The invoice is payable for \$49,113\.60\. Reason given: vendor notice on file$/);
  });

  it("says nothing was posted on an escalation, and that no person was needed when none decided", () => {
    expect(decisionOutcome({ ...base, decision: { reviewer: "jcrocker", escalatedAt: "2026-11-21T07:37:29.237Z", escalationNote: "buyer to confirm", sentBack: 0 } })).toEqual({ tone: "idle", title: "Escalated by jcrocker", body: "No resolution was posted. The escalation put the invoice on hold, so it is not paid, and the case is with an AP specialist. Note: buyer to confirm" });
    expect(decisionOutcome({ ...base, path: "post", decision: { postedAt: "2026-11-21T07:37:29.483Z", sentBack: 0 } })).toMatchObject({ title: "Closed Without a Person" });
  });

  it("reports nothing before a decision, and an approval that has not posted yet as pending", () => {
    expect(decisionOutcome({ ...base, path: "post" })).toBeUndefined();
    expect(decisionOutcome({ ...base, path: "post", decision: { sentBack: 0 } })).toBeUndefined();
    expect(decisionOutcome({ ...base, path: "post", decision: { reviewer: "jcrocker", approvedAt: "2026-11-21T07:37:29.237Z", sentBack: 0 } })).toMatchObject({ tone: "idle", title: "Approved by jcrocker" });
  });
});

describe("until", () => {
  it("counts down to a deadline in days and hours, then hours and minutes", () => {
    const now = Date.parse("2026-11-21T10:00:00Z");
    expect(until("2026-11-26T13:00:00Z", now)).toBe("5 days 3 hr");
    expect(until("2026-11-21T14:12:00Z", now)).toBe("4 hr 12 min");
    expect(until("2026-11-21T10:08:00Z", now)).toBe("8 min");
    expect(until("2026-11-21T09:00:00Z", now)).toBe("now");
  });
});

describe("override receipt", () => {
  it("marks an approval against the policy in amber and says so", () => {
    const o = decisionOutcome({ actionLabel: "Request Credit Memo", ref: "INV-20931-D3", path: "hold", amountCents: 128_400, decision: { reviewer: "local-user", approvedAt: "2026-11-22T01:00:17Z", postedAt: "2026-11-22T01:00:19Z", approvalReason: "buyer confirmed", sentBack: 1, againstPolicy: true } });
    expect(o).toMatchObject({ tone: "warn", title: "Approved Against the Policy by local-user" });
    expect(o?.body).toMatch(/Reason given: buyer confirmed$/);
  });
});

describe("ago", () => {
  it("writes elapsed time in words, never a bare m that could mean months", () => {
    const now = Date.parse("2026-11-21T10:00:00Z");
    expect(ago("2026-11-21T09:59:15Z", now)).toBe("45 sec");
    expect(ago("2026-11-21T09:54:00Z", now)).toBe("6 min");
    expect(ago("2026-11-21T06:06:00Z", now)).toBe("3 hr 54 min");
    expect(ago("2026-11-19T09:00:00Z", now)).toBe("2 days");
  });
});

describe("ago rounding", () => {
  it("never shows 60 minutes", () => {
    const now = Date.parse("2026-11-21T10:00:00Z");
    expect(ago("2026-11-21T07:00:20Z", now)).toBe("3 hr 0 min");
  });
});
