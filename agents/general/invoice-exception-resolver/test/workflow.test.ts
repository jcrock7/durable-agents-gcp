import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { ApplicationFailure } from "@temporalio/common";
import type { WorkflowHandle } from "@temporalio/client";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Activities } from "../dist/activities.js";
import { getCaseState, requestRecheck, submitReview } from "../dist/client.js";
import { HOLD_NEEDS_PERSON, type CaseResult, type CaseState, type Finding, type MatchResult, type Proposal, type QueueResult } from "../dist/index.js";

// The real workflow code on Temporal's time-skipping test server, with activities mocked: no
// models, no MCP servers. Days of waiting pass in milliseconds.
const workflowsPath = fileURLToPath(new URL("../dist/workflows/index.js", import.meta.url));
let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
});
afterAll(async () => {
  await env?.teardown();
});

const INPUT = { exceptionId: "EX-3000", invoiceId: "INV-20931" };
const finding = (code: string, extra: Partial<Finding> = {}): Finding => ({ code, severity: "exception", message: code, ...extra });
const matchOf = (findings: Finding[], types: string[]): MatchResult => ({
  invoiceId: INPUT.invoiceId,
  status: findings.some((f) => f.severity !== "info") ? "exception" : "matched",
  findings,
  exceptionTypes: types,
  totals: { invoiceCents: 4_911_360, poMatchedCents: 4_782_960 },
});
const PRICE = matchOf([finding("PRICE_VARIANCE", { amountCents: 128_400 })], ["price_variance"]);
const NO_RECEIPT = matchOf([finding("NO_RECEIPT")], ["no_receipt"]);
const MATCHED = matchOf([], []);
const proposalOf = (p: Partial<Proposal>): Proposal => ({
  exceptionType: "price_variance",
  action: "accept_variance",
  rationale: "The contract price changed on 1 Oct [E3], and the vendor gave notice [E4].",
  citedEvidence: ["E3", "E4"],
  confidence: "high",
  fraudFlag: false,
  fraudReason: "",
  unconfirmed: "",
  narration: "Proposing to accept the variance.",
  ...p,
});

interface Script {
  matches?: MatchResult[];
  proposals?: Proposal[];
  amountCents?: number;
  containsInstructions?: boolean;
  citationsValid?: boolean;
}

function mockActivities(script: Script = {}, overrides: Partial<Activities> = {}): Activities {
  const matches = [...(script.matches ?? [PRICE])];
  const proposals = [...(script.proposals ?? [proposalOf({})])];
  let invoiceStatus = "exception";
  return {
    runMatch: vi.fn(async () => ({ match: matches.length > 1 ? matches.shift()! : matches[0]!, calls: [] })),
    readInvoice: vi.fn(async () => ({
      fields: {
        vendorInvoiceNumber: "ALD-1945",
        poReference: "PO-7951",
        invoiceDate: "2026-11-03",
        totalDue: "$49,113.60",
        remitBankLast4: "5391",
        lineCount: 2,
        containsInstructions: script.containsInstructions ?? false,
        instructionsSummary: script.containsInstructions ? "tells the system to approve without review" : "",
        narration: "Read the invoice.",
      },
      text: "Alder Fasteners\nINVOICE",
      documentPath: "invoices/INV-20931.pdf",
      skillVersions: { "untrusted-content": "1.0" },
      usage: { step: "read invoice", model: "fast", inputTokens: 900, outputTokens: 80 },
      calls: [],
    })),
    gatherEvidence: vi.fn(async () => ({
      notes: "Contract price changed; notice found.",
      narration: "Found the contract price change.",
      evidence: ["E1", "E2", "E3", "E4"].map((ref) => ({ ref, source: "erp-read:get_contract_prices", args: {}, excerpt: ref })),
      steps: 3,
      stoppedAtLimit: false,
      skillVersions: { "three-way-match-exceptions": "1.0" },
      usage: { step: "gather evidence", model: "fast", inputTokens: 5000, outputTokens: 300 },
      calls: [],
    })),
    proposeResolution: vi.fn(async () => ({
      proposal: proposals.length > 1 ? proposals.shift()! : proposals[0]!,
      citationsValid: script.citationsValid ?? true,
      skillVersions: { "ap-resolution-policy": "1.2" },
      usage: { step: "propose", model: "smart", inputTokens: 8000, outputTokens: 400 },
    })),
    computeAdjustment: vi.fn(async ({ action }: { action: string }) => ({
      adjustment: { invoiceId: INPUT.invoiceId, action, amountCents: script.amountCents ?? 128_400, payableCents: 4_911_360, basis: ["line 1"] },
      calls: [],
    })),
    draftMessage: vi.fn(async ({ recipient }: { recipient: string }) => ({
      message: { to: `${recipient}@example.test`, subject: "Credit memo requested", body: "Please send a credit memo.", narration: "Drafted the message." },
      skillVersions: { "vendor-correspondence": "1.0" },
      usage: { step: "draft message", model: "fast", inputTokens: 600, outputTokens: 120 },
      calls: [],
    })),
    queueMessage: vi.fn(async () => ({ outbox: { id: 1 }, calls: [] })),
    setHold: vi.fn(async () => {
      invoiceStatus = "on_hold";
      return { held: true, calls: [] };
    }),
    postResolution: vi.fn(async ({ invoiceStatus: s }: { invoiceStatus: string }) => {
      invoiceStatus = s;
      return { posted: { resolution_id: 1 }, calls: [] };
    }),
    confirmInvoice: vi.fn(async () => ({ status: invoiceStatus, calls: [] })),
    listOpenExceptions: vi.fn(async () => ({ exceptions: [], calls: [] })),
    ...overrides,
  } as unknown as Activities;
}

async function withWorker<T>(activities: Activities, fn: (taskQueue: string) => Promise<T>): Promise<T> {
  const taskQueue = `test-${randomUUID()}`;
  const worker = await Worker.create({ connection: env.nativeConnection, taskQueue, workflowsPath, activities });
  return worker.runUntil(fn(taskQueue));
}

async function run(activities: Activities, during?: (handle: WorkflowHandle) => Promise<void>): Promise<CaseResult> {
  return withWorker(activities, async (taskQueue) => {
    const handle = await env.client.workflow.start("resolveInvoiceException", { taskQueue, workflowId: randomUUID(), args: [INPUT] });
    if (during) await during(handle);
    return (await handle.result()) as CaseResult;
  });
}

async function waitFor(handle: WorkflowHandle, ok: (s: CaseState) => boolean, what: string): Promise<CaseState> {
  for (let i = 0; i < 300; i++) {
    const s = await getCaseState(handle);
    if (ok(s)) return s;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}
const awaitingReview = (handle: WorkflowHandle, version: number) => waitFor(handle, (s) => s.stage === "awaiting_review" && s.draftVersion === version, `review of draft ${version}`);

describe("resolveInvoiceException: routes", () => {
  it("posts without a person when the rules allow it (allowed freight under the threshold)", async () => {
    const acts = mockActivities({
      matches: [matchOf([finding("CHARGE_ALLOWED", { amountCents: 4_500 })], ["unplanned_charge"])],
      proposals: [proposalOf({ exceptionType: "unplanned_charge", action: "accept_charge" })],
      amountCents: 4_500,
    });
    const result = await run(acts);
    expect(result).toMatchObject({ status: "resolved", action: "accept_charge", amountCents: 4_500, humanTouches: 0, rounds: 1 });
    expect(acts.postResolution).toHaveBeenCalledWith(expect.objectContaining({ action: "accept_charge", invoiceStatus: "resolved", approvedBy: "" }));
    expect(acts.draftMessage).not.toHaveBeenCalled();
  });

  it("waits for approval of a variance over the threshold, then posts with the approver", async () => {
    const acts = mockActivities();
    const result = await run(acts, async (handle) => {
      const s = await awaitingReview(handle, 1);
      expect(s.route?.reasons.join(" ")).toMatch(/always needs a person/);
      expect(s.route?.reasons.join(" ")).toMatch(/over the 1000.00 approval line/);
      expect(acts.postResolution).not.toHaveBeenCalled();
      await submitReview(handle, { approved: true, reviewer: "ap.lead" });
    });
    expect(result).toMatchObject({ status: "resolved", action: "accept_variance", reviewer: "ap.lead", humanTouches: 1, citedEvidence: ["E3", "E4"] });
    expect(acts.postResolution).toHaveBeenCalledWith(expect.objectContaining({ approvedBy: "ap.lead", amountCents: 128_400 }));
    expect(result.skillVersions).toMatchObject({ "ap-resolution-policy": "1.2", "untrusted-content": "1.0" });
  });

  it("every timeline entry of an approved run has narration", async () => {
    const acts = mockActivities();
    let final: CaseState | undefined;
    await run(acts, async (handle) => {
      await awaitingReview(handle, 1);
      await submitReview(handle, { approved: true, reviewer: "ap.lead" });
      final = await waitFor(handle, (s) => s.stage === "done", "done");
    });
    expect(final!.timeline.length).toBeGreaterThan(6);
    for (const e of final!.timeline) expect(e.narration, e.name).toMatch(/\S/);
    // Narration is a step record, not a chatbot speaking: no first person.
    for (const e of final!.timeline) expect(e.narration, e.name).not.toMatch(/\b(I|I'm|I'll|me|my|we)\b/);
    expect(final!.timeline.find((e) => e.name === "Read invoice PDF")?.narration).toBe("Read the invoice.");
  });

  it("revises the proposal when the reviewer sends it back", async () => {
    const acts = mockActivities({ proposals: [proposalOf({}), proposalOf({ action: "request_credit_memo", rationale: "Not in the contract [E3]." })], amountCents: 50_000 });
    const result = await run(acts, async (handle) => {
      await awaitingReview(handle, 1);
      await submitReview(handle, { approved: false, feedback: "This is an overcharge, ask for a credit" });
    });
    expect(result).toMatchObject({ status: "on_hold", action: "request_credit_memo", humanTouches: 1 });
    expect(acts.proposeResolution).toHaveBeenLastCalledWith(expect.objectContaining({ revision: expect.objectContaining({ feedback: "This is an overcharge, ask for a credit" }) }));
    // The credit memo request went out only after the reviewer's decision, then the invoice was held.
    expect(acts.queueMessage).toHaveBeenCalledTimes(1);
    expect(acts.postResolution).toHaveBeenCalledWith(expect.objectContaining({ invoiceStatus: "on_hold" }));
    // A held case says what it is waiting for and what releases it.
    expect(result.reasons).toEqual(["waiting for a credit memo from the vendor; released when the credit is recorded"]);
  });

  it("hands the case to a person when the reviewer escalates, without posting", async () => {
    const acts = mockActivities();
    const result = await run(acts, async (handle) => {
      await awaitingReview(handle, 1);
      await expect(submitReview(handle, { approved: false, escalate: { note: " " }, reviewer: "ap.lead" })).rejects.toThrow();
      await submitReview(handle, { approved: false, escalate: { note: "Buyer should confirm the price" }, reviewer: "ap.lead" });
    });
    expect(result).toMatchObject({ status: "escalated", reviewer: "ap.lead", humanTouches: 1 });
    expect(result.reasons).toEqual(["Buyer should confirm the price", "escalated by ap.lead"]);
    expect(acts.postResolution).not.toHaveBeenCalled();
    expect(acts.setHold).toHaveBeenCalledTimes(1);
  });

  it("ends as rejected_by_reviewer after too many send-backs", async () => {
    const result = await run(mockActivities(), async (handle) => {
      for (const v of [1, 2, 3]) {
        await awaitingReview(handle, v);
        await submitReview(handle, { approved: false, feedback: `no (${v})` });
      }
    });
    expect(result).toMatchObject({ status: "rejected_by_reviewer", humanTouches: 3 });
  });

  it("expires and holds the invoice when nobody reviews within 7 days", async () => {
    const acts = mockActivities();
    const result = await run(acts);
    expect(result.status).toBe("expired");
    expect(acts.setHold).toHaveBeenCalled();
    expect(acts.postResolution).not.toHaveBeenCalled();
  });

  it("escalates a low-confidence proposal without asking for approval", async () => {
    const acts = mockActivities({ proposals: [proposalOf({ confidence: "low" })] });
    const result = await run(acts);
    expect(result).toMatchObject({ status: "escalated", reasons: ["low confidence in accept_variance"] });
    expect(acts.setHold).toHaveBeenCalled();
  });

  it("escalates as possible fraud when the bank details changed, whatever the model proposes", async () => {
    const acts = mockActivities({
      matches: [matchOf([finding("PRICE_VARIANCE"), finding("BANK_DETAILS_CHANGED", { severity: "fraud_signal", message: "bank changed" })], ["price_variance"])],
      proposals: [proposalOf({ action: "accept_charge", amountCents: 0 } as Partial<Proposal>)],
      amountCents: 500,
    });
    const result = await run(acts);
    expect(result.status).toBe("escalated");
    expect(result.reasons).toEqual(expect.arrayContaining(["possible fraud", "bank changed"]));
    expect(acts.postResolution).not.toHaveBeenCalled();
  });

  it("stops at once when the invoice carries instructions for the system", async () => {
    const acts = mockActivities({ containsInstructions: true });
    const result = await run(acts);
    expect(result.status).toBe("blocked");
    expect(result.reasons[0]).toMatch(/approve without review/);
    expect(acts.gatherEvidence).not.toHaveBeenCalled();
    expect(acts.setHold).toHaveBeenCalled();
  });

  it("ends as blocked, without retrying, when the gateway guardrail blocks a model call", async () => {
    const gatherEvidence = vi.fn(async () => {
      throw ApplicationFailure.nonRetryable("blocked by the prompt-injection guardrail: hidden instructions", "GuardrailBlocked");
    });
    const acts = mockActivities({}, { gatherEvidence } as Partial<Activities>);
    const result = await run(acts);
    expect(result.status).toBe("blocked");
    expect(gatherEvidence).toHaveBeenCalledTimes(1);
  });

  it("asks for approval when the proposal cites no valid evidence", async () => {
    const acts = mockActivities({ matches: [matchOf([finding("UOM_CONVERTIBLE", { amountCents: 0 })], ["uom_mismatch"])], proposals: [proposalOf({ exceptionType: "uom_mismatch", action: "accept_uom_conversion" })], amountCents: 0, citationsValid: false });
    const result = await run(acts, async (handle) => {
      const s = await awaitingReview(handle, 1);
      expect(s.route?.reasons).toEqual(["the proposal does not cite valid evidence"]);
      await submitReview(handle, { approved: true, reviewer: "ap.clerk" });
    });
    expect(result.status).toBe("resolved");
  });

  it("refuses an approval against the policy without a reason, and keeps the reason it is given", async () => {
    const conflict = matchOf([finding("PRICE_VARIANCE", { amountCents: 128_400, details: { invoicedUnitPriceCents: 3967, poUnitPriceCents: 3365, contractPriceCents: 3365, contractSupportsInvoice: false } })], ["price_variance"]);
    const acts = mockActivities({ matches: [conflict] });
    let final: CaseState | undefined;
    const result = await run(acts, async (handle) => {
      const s = await awaitingReview(handle, 1);
      expect(s.route?.policyFit).toMatchObject({ fits: false });
      await expect(submitReview(handle, { approved: true, reviewer: "ap.lead" })).rejects.toThrow();
      await expect(submitReview(handle, { approved: true, feedback: "  ", reviewer: "ap.lead" })).rejects.toThrow();
      await submitReview(handle, { approved: true, feedback: "Buyer agreed the new price by phone", reviewer: "ap.lead" });
      final = await waitFor(handle, (st) => st.stage === "done", "done");
    });
    expect(result).toMatchObject({ status: "resolved", reviewer: "ap.lead", humanTouches: 1 });
    expect(final!.timeline.find((e) => e.name === "Approved")?.detail).toBe("ap.lead · reason: Buyer agreed the new price by phone");
  });

  it("closes the case at once if the invoice already matches", async () => {
    const acts = mockActivities({ matches: [MATCHED] });
    const result = await run(acts);
    expect(result).toMatchObject({ status: "resolved", reasons: ["the invoice now matches"] });
    expect(acts.readInvoice).not.toHaveBeenCalled();
  });
});

describe("resolveInvoiceException: waiting for a receipt", () => {
  const waitProposal = proposalOf({ exceptionType: "no_receipt", action: "wait_for_receipt", rationale: "Shipped on 15 Nov, due 22 Nov [E3]." });

  it("holds, re-checks daily, and resolves in the next round when the receipt is posted", async () => {
    // Round 1: no receipt (twice: the first match and the first daily check), then the receipt appears.
    const acts = mockActivities({ matches: [NO_RECEIPT, NO_RECEIPT, NO_RECEIPT, MATCHED], proposals: [waitProposal], amountCents: 0 });
    // The hold is a write, so a person approves it before the invoice is held.
    const result = await run(acts, async (handle) => {
      const s = await awaitingReview(handle, 1);
      expect(s.route?.reasons).toEqual([HOLD_NEEDS_PERSON]);
      expect(acts.setHold).not.toHaveBeenCalled();
      await submitReview(handle, { approved: true, reviewer: "ap.clerk" });
    });
    expect(result).toMatchObject({ status: "resolved", rounds: 2, reasons: ["the invoice now matches"] });
    expect(acts.setHold).toHaveBeenCalledTimes(1);
    expect(acts.readInvoice).toHaveBeenCalledTimes(1);
  });

  it("re-checks at once on a recheck signal", async () => {
    const acts = mockActivities({ matches: [NO_RECEIPT, MATCHED], proposals: [waitProposal], amountCents: 0 });
    const result = await run(acts, async (handle) => {
      await awaitingReview(handle, 1);
      await submitReview(handle, { approved: true, reviewer: "ap.clerk" });
      await waitFor(handle, (s) => s.stage === "waiting", "the wait");
      await requestRecheck(handle, "receipt GR-6001 posted");
    });
    expect(result.status).toBe("resolved");
    expect(acts.runMatch).toHaveBeenCalledTimes(3); // first match, recheck, round 2
  });

  it("asks receiving to post the receipt, reminds on days 3 and 7, and escalates on day 10", async () => {
    const acts = mockActivities({ matches: [NO_RECEIPT], proposals: [proposalOf({ exceptionType: "no_receipt", action: "request_receipt_entry", rationale: "Delivered and signed for [E3]." })], amountCents: 0 });
    const result = await run(acts, async (handle) => {
      await awaitingReview(handle, 1);
      // Nothing is written, and no message goes out, before the approval.
      expect(acts.queueMessage).not.toHaveBeenCalled();
      await submitReview(handle, { approved: true, reviewer: "ap.clerk" });
    });
    expect(result).toMatchObject({ status: "escalated", reasons: ["no receipt after 10 days"] });
    // The request, then two reminders to the same address.
    expect(acts.queueMessage).toHaveBeenCalledTimes(3);
    expect(acts.queueMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ to: "receiving@example.test", subject: "Reminder: Credit memo requested" }));
  });
});

describe("resolveInvoiceException: durability", () => {
  it("survives a worker restart while waiting: finished steps are not repeated", async () => {
    const taskQueue = `test-${randomUUID()}`;
    const workflowId = randomUUID();
    const first = mockActivities();
    // Worker 1 runs the case up to the review, then stops (as if its pod were deleted).
    // No workflow cache (and so no sticky queue) on worker 1, so worker 2 gets the case at once.
    const w1 = await Worker.create({ connection: env.nativeConnection, taskQueue, workflowsPath, activities: first, maxCachedWorkflows: 0 });
    const handle = await w1.runUntil(async () => {
      const h = await env.client.workflow.start("resolveInvoiceException", { taskQueue, workflowId, args: [INPUT] });
      await awaitingReview(h, 1);
      return h;
    });
    // Worker 2 picks the case up from the Temporal history.
    const second = mockActivities();
    const w2 = await Worker.create({ connection: env.nativeConnection, taskQueue, workflowsPath, activities: second });
    const result = (await w2.runUntil(async () => {
      await submitReview(handle, { approved: true, reviewer: "ap.lead" });
      return handle.result();
    })) as CaseResult;

    expect(result.status).toBe("resolved");
    expect(first.readInvoice).toHaveBeenCalledTimes(1);
    expect(first.proposeResolution).toHaveBeenCalledTimes(1);
    expect(second.readInvoice).not.toHaveBeenCalled();
    expect(second.gatherEvidence).not.toHaveBeenCalled();
    expect(second.proposeResolution).not.toHaveBeenCalled();
    expect(second.postResolution).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid input", async () => {
    await expect(
      withWorker(mockActivities(), async (taskQueue) =>
        env.client.workflow.execute("resolveInvoiceException", { taskQueue, workflowId: randomUUID(), args: [{ exceptionId: "nope", invoiceId: "INV-1" }] }),
      ),
    ).rejects.toThrow();
  });
});

describe("resolveExceptionQueue", () => {
  it("starts one case per open exception and finishes once every case is waiting or done", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => ({ exceptionId: `EX-${3100 + i}`, invoiceId: `INV-${21100 + i}` }));
    const acts = mockActivities({}, { listOpenExceptions: vi.fn(async () => ({ exceptions: ids, calls: [] })) } as Partial<Activities>);
    const result = await withWorker(acts, async (taskQueue) => {
      const queue = await env.client.workflow.start("resolveExceptionQueue", { taskQueue, workflowId: `queue-${randomUUID()}`, args: [{ limit: 12 }] });
      const r = (await queue.result()) as QueueResult;
      // Every case is now waiting for review, and stays alive after the queue has finished.
      const one = env.client.workflow.getHandle("inv-21100");
      expect((await getCaseState(one)).stage).toBe("awaiting_review");
      await submitReview(one, { approved: true, reviewer: "ap.lead" });
      expect(((await one.result()) as CaseResult).status).toBe("resolved");
      return r;
    });
    expect(result.started).toHaveLength(12);
    expect(result.started[0]).toBe("inv-21100");
  });
});
