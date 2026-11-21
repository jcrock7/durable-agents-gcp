import { describe, expect, it } from "vitest";
import { caseGroup, caseTag, plain, sourceLabel, titleCase, type CaseSummary } from "../src/api.js";
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
    expect(approveEffect({ ...base, path: "post", amountCents: 102_340, payableCents: 981_330 })).toBe("“Accept Variance” for $1,023.40 is written to the ERP, the exception on invoice INV-20267 is cleared, and the invoice becomes payable for $9,813.30.");
    expect(approveEffect({ ...base, actionLabel: "Reject Duplicate", path: "post", amountCents: 0, payableCents: 0, messageTo: "vendor" })).toBe("“Reject Duplicate” is written to the ERP, the exception on invoice INV-20267 is cleared, and nothing is paid on this invoice. A message is sent to the vendor.");
  });

  it("says a held invoice is not paid, and omits payment when the action does not settle it", () => {
    expect(approveEffect({ ...base, actionLabel: "Request Credit Memo", path: "hold", amountCents: 102_340, payableCents: 878_990, messageTo: "vendor" })).toBe("“Request Credit Memo” for $1,023.40 is recorded in the ERP and invoice INV-20267 stays on hold. Nothing is paid yet. A message is sent to the vendor.");
    expect(approveEffect({ ...base, path: "post", payableCents: null })).toBe("“Accept Variance” is written to the ERP, the exception on invoice INV-20267 is cleared.");
  });

  it("describes sending back and escalating", () => {
    expect(sendBackEffect("Invoice Resolver", 1)).toMatch(/brings round 2 back to you/);
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
    expect(stepTime(t, 1)).toBe("+9s");
    expect(stepTime(t, 2)).toBe("+6m");
    expect(stepTime(t, 3)).toBe("Now");
  });
});

describe("decision receipt", () => {
  const base = { actionLabel: "Accept Variance", ref: "INV-20931", amountCents: 128_400, payableCents: 4_911_360, reviewer: "jcrocker" };

  it("reports an approved and posted decision with the reason given", () => {
    const o = decisionOutcome({ ...base, path: "post", approvedAt: "2026-11-21T07:37:29.237Z", postedAt: "2026-11-21T07:37:29.483Z", approvalReason: "vendor notice on file" });
    expect(o?.tone).toBe("ok");
    expect(o?.title).toBe("Approved by jcrocker");
    expect(o?.body).toMatch(/^“Accept Variance” for \$1,284\.00 was written to the ERP at .+ on 21 Nov 2026\. The invoice is payable for \$49,113\.60\. Reason given: vendor notice on file$/);
  });

  it("says nothing was posted on an escalation, and that no person was needed when none decided", () => {
    expect(decisionOutcome({ ...base, escalationNote: "buyer to confirm" })).toEqual({ tone: "crit", title: "Escalated by jcrocker", body: "Nothing was posted. Invoice INV-20931 is on hold for an AP specialist. Note: buyer to confirm" });
    expect(decisionOutcome({ ...base, reviewer: undefined, path: "post", postedAt: "2026-11-21T07:37:29.483Z" })).toMatchObject({ title: "Closed Without a Person" });
  });

  it("reports nothing before a decision, and an approval that has not posted yet as pending", () => {
    expect(decisionOutcome({ ...base, path: "post" })).toBeUndefined();
    expect(decisionOutcome({ ...base, path: "post", approvedAt: "2026-11-21T07:37:29.237Z" })).toMatchObject({ tone: "idle", title: "Approved by jcrocker" });
  });
});
