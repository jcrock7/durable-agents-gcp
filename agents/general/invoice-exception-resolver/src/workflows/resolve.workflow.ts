import { ApplicationFailure, condition, getExternalWorkflowHandle, proxyActivities, setHandler, workflowInfo } from "@temporalio/workflow";
import { FailureType, MODEL_CALL_OPTIONS, ReviewGate, TOOL_CALL_OPTIONS, failureTypeOf } from "@agents/agent-kit/workflow";
import type { Activities } from "../activities.js";
import { agentConfig } from "../agent.config.js";
import { PROMPT_VERSION } from "../prompts/index.js";
import { route } from "../route.js";
import { ResolveInputSchema, type ResolveInput } from "../schemas.js";
import { caseSettledSignal, caseStateQuery, recheckSignal } from "../signals.js";
import type { CaseResult, CaseState, CaseStatus, Evidence, Stage, ToolCallRecord, Usage } from "../types.js";

// Deterministic orchestration only: every model and tool call is an activity.
const { readInvoice, gatherEvidence, proposeResolution, draftMessage } = proxyActivities<Activities>(MODEL_CALL_OPTIONS);
const { runMatch, computeAdjustment, queueMessage, setHold, postResolution, confirmInvoice } = proxyActivities<Activities>(TOOL_CALL_OPTIONS);

const DAY_MS = 24 * 60 * 60 * 1000;
export const REVIEW_TIMEOUT = "7 days";
export const MAX_REVISIONS = 2;

/**
 * Work one invoice exception:
 * match → read the invoice → gather evidence → propose → route → (review) → message → post → confirm,
 * or hold and wait for a receipt (daily re-match, reminders, escalation), up to `limits.rounds` rounds.
 */
export async function resolveInvoiceException(rawInput: ResolveInput): Promise<CaseResult> {
  const parsed = ResolveInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw ApplicationFailure.nonRetryable(`invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, "InvalidInput");
  }
  const input = parsed.data;
  const runId = workflowInfo().workflowId;
  const { limits, wait } = agentConfig;

  const state: CaseState = {
    exceptionId: input.exceptionId,
    invoiceId: input.invoiceId,
    stage: "matching",
    round: 0,
    reasons: [],
    evidence: [],
    draftVersion: 0,
    feedback: [],
    remindersSent: 0,
    timeline: [],
    toolCalls: [],
    skillVersions: {},
    usage: [],
  };
  setHandler(caseStateQuery, () => state);
  let recheck = false;
  setHandler(recheckSignal, ({ reason }) => {
    recheck = true;
    step("Re-check requested", reason);
  });
  const review = new ReviewGate();
  let humanTouches = 0;

  function step(name: string, detail = "", s: "done" | "now" | "error" = "done") {
    const last = state.timeline.at(-1);
    if (last?.state === "now") last.state = "done";
    state.timeline.push({ name, at: new Date().toISOString(), detail, state: s });
  }
  function enter(stage: Stage) {
    state.stage = stage;
  }
  function record(r: { calls?: ToolCallRecord[]; usage?: Usage; skillVersions?: Record<string, string> }) {
    if (r.calls) state.toolCalls.push(...r.calls);
    if (r.usage) state.usage.push(r.usage);
    if (r.skillVersions) Object.assign(state.skillVersions, r.skillVersions);
  }
  let settledSent = false;
  async function settle() {
    if (settledSent || !input.parentWorkflowId) return;
    settledSent = true;
    try {
      await getExternalWorkflowHandle(input.parentWorkflowId).signal(caseSettledSignal, { invoiceId: input.invoiceId });
    } catch {
      // The queue may have finished or been cancelled; the case carries on regardless.
    }
  }
  async function finish(status: CaseStatus, reasons: string[] = []): Promise<CaseResult> {
    state.status = status;
    state.reasons.push(...reasons);
    enter("done");
    step(`Finished: ${status}`, reasons.join("; "));
    const last = state.timeline.at(-1);
    if (last) last.state = "done";
    await settle();
    return {
      exceptionId: input.exceptionId,
      invoiceId: input.invoiceId,
      status,
      action: state.proposal?.action,
      exceptionType: state.proposal?.exceptionType,
      amountCents: state.adjustment?.amountCents,
      reasons: state.reasons,
      reviewer: state.reviewer,
      rounds: state.round,
      humanTouches,
      citedEvidence: state.proposal?.citedEvidence ?? [],
      toolCalls: state.toolCalls.length,
      usage: state.usage,
      skillVersions: state.skillVersions,
      promptVersion: PROMPT_VERSION,
    };
  }
  async function holdAndFinish(status: CaseStatus, reasons: string[]): Promise<CaseResult> {
    record(await setHold({ invoiceId: input.invoiceId }));
    step("Invoice on hold", reasons.join("; "));
    return finish(status, reasons);
  }

  try {
    let invoiceText = "";
    let documentPath = "";
    let erpRecord: { vendorId: string; poId: string } | undefined;
    for (state.round = 1; state.round <= limits.rounds; state.round++) {
      // 1. Match.
      enter("matching");
      const { match, calls } = await runMatch({ invoiceId: input.invoiceId });
      record({ calls });
      state.match = match;
      step("Match", `${match.status}: ${match.findings.map((f) => f.code).join(", ") || "no findings"}`);
      if (match.status === "matched") {
        enter("posting");
        record(await postResolution({ invoiceId: input.invoiceId, exceptionId: input.exceptionId, action: "cleared_by_rematch", amountCents: 0, note: "The invoice now matches its PO and receipts.", approvedBy: "", runId, invoiceStatus: "resolved" }));
        return finish("resolved", ["the invoice now matches"]);
      }

      // 2. Read the invoice (first round only).
      if (state.round === 1) {
        enter("reading_invoice");
        const read = await readInvoice({ invoiceId: input.invoiceId });
        record(read);
        state.invoice = read.fields;
        invoiceText = read.text;
        documentPath = read.documentPath;
        erpRecord = read.record;
        step("Read invoice PDF", `${read.fields.vendorInvoiceNumber} · ${read.fields.totalDue}`);
        if (read.fields.containsInstructions) {
          return holdAndFinish("blocked", [`the invoice contains instructions addressed to the system: ${read.fields.instructionsSummary || "unspecified"}`]);
        }
      }

      // 3. Gather evidence.
      enter("gathering_evidence");
      const gathered = await gatherEvidence({ invoiceId: input.invoiceId, match, invoiceText, documentPath, record: erpRecord });
      record(gathered);
      state.evidence = gathered.evidence;
      state.notes = gathered.notes;
      step("Gather evidence", `${gathered.evidence.length} items · ${gathered.steps} model steps${gathered.stoppedAtLimit ? " · stopped at the round limit" : ""}`);

      // 4–5. Propose and route; a person reviews when the rules say so, and may send it back.
      let revision: { previous: NonNullable<CaseState["proposal"]>; feedback: string } | undefined;
      for (;;) {
        enter("proposing");
        const proposed = await proposeResolution({ invoiceId: input.invoiceId, match, evidence: state.evidence as Evidence[], notes: state.notes ?? "", revision });
        record(proposed);
        state.proposal = proposed.proposal;
        state.citationsValid = proposed.citationsValid;
        state.draftVersion += 1;
        step(revision ? "Revise proposal" : "Propose resolution", `${proposed.proposal.action} (${proposed.proposal.confidence})`);

        const adj = await computeAdjustment({ invoiceId: input.invoiceId, action: proposed.proposal.action });
        record(adj);
        state.adjustment = adj.adjustment;
        const decision = route({ proposal: proposed.proposal, adjustment: adj.adjustment, match, citationsValid: proposed.citationsValid });
        state.route = decision;
        step("Route", `${decision.path}${decision.needsPerson ? ` → person: ${decision.reasons.join("; ")}` : ""}`);

        if (decision.path === "escalate") return holdAndFinish("escalated", decision.reasons);
        if (!decision.needsPerson) break;

        enter("awaiting_review");
        step("Waiting for approval", decision.reasons.join("; "), "now");
        await settle();
        const verdict = await review.wait(state.draftVersion, REVIEW_TIMEOUT);
        if (!verdict) return holdAndFinish("expired", [`no review within ${REVIEW_TIMEOUT}`]);
        humanTouches += 1;
        state.reviewer = verdict.reviewer;
        if (verdict.approved) {
          step("Approved", verdict.reviewer ?? "");
          break;
        }
        state.feedback.push(verdict.feedback ?? "");
        step("Sent back", verdict.feedback ?? "");
        if (state.feedback.length > MAX_REVISIONS) return holdAndFinish("rejected_by_reviewer", [verdict.feedback ?? "rejected"]);
        revision = { previous: proposed.proposal, feedback: verdict.feedback ?? "" };
      }

      const proposal = state.proposal!;
      const decision = state.route!;
      const adjustment = state.adjustment!;

      // Message, if the action calls for one. Sent only now: after approval where it was needed.
      if (decision.message) {
        enter("sending_message");
        const drafted = await draftMessage({
          invoiceId: input.invoiceId,
          recipient: decision.message.recipient,
          purpose: decision.message.purpose,
          facts: { action: proposal.action, amount: `$${(Math.abs(adjustment.amountCents) / 100).toFixed(2)}`, basis: adjustment.basis },
        });
        record(drafted);
        state.message = drafted.message;
        record(await queueMessage({ ...drafted.message, invoiceId: input.invoiceId, runId }));
        step("Message queued", `to ${drafted.message.to}: ${drafted.message.subject}`);
      }

      // 6–7. Post and confirm.
      if (decision.path === "post" || decision.path === "hold") {
        enter("posting");
        record(
          await postResolution({
            invoiceId: input.invoiceId,
            exceptionId: input.exceptionId,
            action: proposal.action,
            amountCents: adjustment.amountCents,
            note: `${proposal.rationale}\nEvidence: ${proposal.citedEvidence.map((r) => `${r} ${state.evidence.find((e) => e.ref === r)?.source ?? ""}`).join("; ")}`,
            approvedBy: state.reviewer ?? "",
            runId,
            invoiceStatus: decision.invoiceStatus,
          }),
        );
        step("Post resolution", `${proposal.action} · ${(adjustment.amountCents / 100).toFixed(2)}`);
        const confirmed = await confirmInvoice({ invoiceId: input.invoiceId });
        record(confirmed);
        step("Confirm", `invoice is ${confirmed.status}`);
        if (confirmed.status !== decision.invoiceStatus) {
          return finish("escalated", [`expected the invoice to be ${decision.invoiceStatus}, the ERP shows ${confirmed.status}`]);
        }
        return finish(decision.invoiceStatus === "on_hold" ? "on_hold" : "resolved");
      }

      // Wait for the receipt: hold, re-match daily (or on a recheck signal), remind, escalate.
      record(await setHold({ invoiceId: input.invoiceId }));
      enter("waiting");
      state.waitingFor = "a goods receipt";
      step("Waiting for receipt", `re-checks daily; reminders on days ${wait.reminderDays.join(" and ")}; escalates on day ${wait.escalateDays}`, "now");
      await settle();
      const started = Date.now();
      let received = false;
      while (!received) {
        recheck = false;
        await condition(() => recheck, "1 day");
        const days = Math.floor((Date.now() - started) / DAY_MS);
        const again = await runMatch({ invoiceId: input.invoiceId });
        record(again);
        received = !again.match.findings.some((f) => f.code === "NO_RECEIPT");
        if (received) {
          step("Receipt found", `day ${days}`);
          break;
        }
        if (days >= wait.escalateDays) return holdAndFinish("escalated", [`no receipt after ${wait.escalateDays} days`]);
        const due = wait.reminderDays.filter((d) => days >= d).length;
        while (state.remindersSent < due) {
          state.remindersSent += 1;
          const to = state.message?.to;
          if (to) {
            record(await queueMessage({ to, subject: `Reminder: ${state.message!.subject}`, body: `Following up on our message about invoice ${state.invoice?.vendorInvoiceNumber ?? input.invoiceId}.\n\n${state.message!.body}`, invoiceId: input.invoiceId, runId }));
          }
          step(`Reminder ${state.remindersSent}`, to ? `to ${to}` : "still waiting (no one to remind)");
        }
      }
      state.waitingFor = undefined;
      // Next round: the case is re-matched with the new receipt.
    }
    return holdAndFinish("escalated", [`still unresolved after ${limits.rounds} rounds`]);
  } catch (error) {
    // A guardrail block is an answer, not a crash: hold the invoice and end with the reason.
    if (failureTypeOf(error) === FailureType.GuardrailBlocked) {
      return holdAndFinish("blocked", [(error as Error & { cause?: Error }).cause?.message ?? "blocked by the guardrail"]);
    }
    throw error;
  }
}
