import { describe, expect, it } from "vitest";
import { daysOf, deadlineOf, decisionOf, personReasonsOf, researchOf, thresholdOf, writesOf } from "../dist/decision.js";

const call = (ref: string, at: string, args: Record<string, unknown> = {}) => ({ ref, at, args, outcome: "ok", caller: "workflow", durationMs: 5 });
const T = (m: number) => `2026-11-21T10:${String(m).padStart(2, "0")}:00.000Z`;

describe("decisionOf", () => {
  it("reads the approver, their reason and when the resolution was posted", () => {
    const d = decisionOf({
      reviewer: "ap.lead",
      feedback: ["ask for a credit"],
      timeline: [
        { name: "Approved", at: T(5), detail: "ap.lead · reason: Buyer agreed the price by phone" },
        { name: "Post resolution", at: T(6), detail: "" },
      ],
    });
    expect(d).toEqual({ reviewer: "ap.lead", approvedAt: T(5), approvalReason: "Buyer agreed the price by phone", postedAt: T(6), sentBack: 1 });
  });

  it("reads an escalation note", () => {
    expect(decisionOf({ reviewer: "ap.lead", timeline: [{ name: "Escalated by reviewer", at: T(3), detail: "Buyer should confirm" }] })).toMatchObject({ escalatedAt: T(3), escalationNote: "Buyer should confirm" });
  });
});

describe("writesOf", () => {
  it("credits writes after an approval to the approver", () => {
    const w = writesOf({ reviewer: "ap.lead", timeline: [{ name: "Approved", at: T(5), detail: "ap.lead" }], toolCalls: [call("erp-write:set_invoice_hold", T(6))] });
    expect(w).toEqual([{ ref: "erp-write:set_invoice_hold", label: "Invoice put on hold", at: T(6), by: "person", who: "ap.lead", why: "Approved by ap.lead." }]);
  });

  it("names the rule behind writes no person approved", () => {
    const protective = writesOf({ status: "blocked", timeline: [], toolCalls: [call("erp-write:set_invoice_hold", T(1))] });
    expect(protective[0]).toMatchObject({ by: "rule", why: expect.stringMatching(/^Protective hold/) });
    const old = writesOf({ stage: "waiting", route: { path: "wait" }, timeline: [], toolCalls: [call("erp-write:set_invoice_hold", T(1))] });
    expect(old[0]!.why).toMatch(/started before holds needed approval/);
    const cleared = writesOf({ timeline: [], toolCalls: [call("erp-write:post_resolution", T(1), { action: "cleared_by_rematch" })] });
    expect(cleared[0]!.why).toMatch(/matched its purchase order/);
    const within = writesOf({ timeline: [], toolCalls: [call("erp-write:post_resolution", T(1), { action: "accept_charge" })] });
    expect(within[0]).toMatchObject({ by: "rule", why: expect.stringMatching(/^Within the approval rules/) });
  });

  it("skips reads and refused calls", () => {
    expect(writesOf({ timeline: [], toolCalls: [call("erp-read:get_invoice", T(1)), { ...call("erp-write:post_resolution", T(2)), outcome: "refused" }] })).toEqual([]);
  });
});

describe("thresholdOf", () => {
  it("returns the amount and the approval line in cents", () => {
    expect(thresholdOf({ route: { reasons: ["amount 1284.00 is over the 1000.00 approval line"] } })).toEqual({ amountCents: 128_400, lineCents: 100_000 });
    expect(thresholdOf({ route: { reasons: [] } })).toBeUndefined();
  });
});

describe("personReasonsOf", () => {
  it("names each approval rule that sent the case to a person, in business language", () => {
    const r = personReasonsOf({
      route: { path: "post", needsPerson: true, reasons: ["accept_variance always needs a person", "amount 1284.00 is over the 1000.00 approval line", "accept_variance does not fit the policy: no notice"] },
    });
    expect(r).toEqual([
      { kind: "always", group: "policy", label: "Accepting a price variance always needs a person", rule: "accept_variance always needs a person" },
      { kind: "approval_line", group: "policy", label: "Over the $1,000 approval line", rule: "amount 1284.00 is over the 1000.00 approval line" },
      { kind: "policy_conflict", group: "policy", label: "The proposal conflicts with the AP policy", rule: "accept_variance does not fit the policy: no notice" },
    ]);
  });

  it("names the risk or evidence reason for an escalation, and nothing when no rule needed a person", () => {
    expect(personReasonsOf({ route: { path: "escalate", needsPerson: true, reasons: ["possible fraud", "bank details changed"] } })).toEqual([{ kind: "fraud", group: "risk", label: "Possible fraud", rule: "possible fraud; bank details changed" }]);
    expect(personReasonsOf({ route: { path: "escalate", needsPerson: true, reasons: ["no contract price on file"] } })[0]?.kind).toBe("evidence");
    expect(personReasonsOf({ status: "blocked" })[0]?.kind).toBe("guardrail");
    expect(personReasonsOf({ route: { path: "post", needsPerson: false, reasons: [] } })).toEqual([]);
  });
});

describe("deadlineOf", () => {
  it("is the configured days after the case started waiting, only while it waits", () => {
    const waiting = { stage: "awaiting_review", timeline: [{ name: "Waiting for approval", at: T(0) }] };
    expect(deadlineOf(waiting, 7)?.expiresAt).toBe("2026-11-28T10:00:00.000Z");
    expect(deadlineOf({ ...waiting, stage: "done" }, 7)).toBeUndefined();
    expect(deadlineOf(waiting, undefined)).toBeUndefined();
  });
});

describe("researchOf and daysOf", () => {
  it("shows which sources a draft cites, leaves out or marks unrelated, and each point's sources", () => {
    const r = researchOf({
      question: "How do durable workflows survive a crash?",
      sources: [1, 2, 3, 4, 5].map((id) => ({ id, title: `S${id}`, url: "" })),
      draft: { summary: "Replay [1].", keyPoints: ["Replay [1]", "Retries [1][2]"], citedSources: [1, 2], unrelatedSources: [4, 9] },
    });
    expect(r).toEqual({ question: "How do durable workflows survive a crash?", points: 2, sources: 5, cited: [1, 2], uncited: [3, 4, 5], unrelated: [4], pointSources: [[1], [1, 2]] });
    expect(researchOf({ sources: [] })).toBeUndefined();
  });

  it("reads a workflow duration in days, and a research deadline says what expiry means", () => {
    expect(daysOf("7 days")).toBe(7);
    expect(daysOf("2h")).toBeUndefined();
    const d = deadlineOf({ stage: "awaiting_review", timeline: [{ name: "Waiting for approval", at: T(0) }] }, 7);
    expect(d?.onExpiry).toMatch(/brief is not approved/);
  });
});

describe("override", () => {
  it("marks an approval the policy check did not support", () => {
    const timeline = [{ name: "Approved", at: T(5), detail: "ap.lead · reason: buyer confirmed by phone" }];
    expect(decisionOf({ reviewer: "ap.lead", route: { policyFit: { fits: false } }, timeline })?.againstPolicy).toBe(true);
    expect(decisionOf({ reviewer: "ap.lead", route: { policyFit: { fits: true } }, timeline })?.againstPolicy).toBeUndefined();
  });
});
