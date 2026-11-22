import { cents, dateTime, type DecisionRecord } from "./api.js";

// Naming: the case reference (INV-20931, the ERP's invoice id) is always "case INV-…"; the vendor's own
// number (SAL-4410) is always "vendor invoice SAL-…". "The invoice" means the document itself.

export interface EffectInput {
  /** Title-cased action, e.g. "Accept Variance". */
  actionLabel: string;
  /** Case reference, e.g. INV-20267. */
  ref: string;
  path?: "post" | "hold" | "wait" | "escalate";
  amountCents?: number | null;
  /** What becomes payable after the action; null when the action does not settle payment. */
  payableCents?: number | null;
  /** Who gets a message once the action is approved. */
  messageTo?: string;
}

/** What approving does, in one sentence a reviewer can rely on. Built only from what the workflow recorded. */
export function approveEffect({ actionLabel, ref, path, amountCents, payableCents, messageTo }: EffectInput): string {
  const what = `“${actionLabel}”${amountCents ? ` for ${cents(Math.abs(amountCents))}` : ""}`;
  const message = messageTo ? ` A message is sent to the ${messageTo}.` : "";
  if (path === "post") {
    const pay = payableCents == null ? "" : payableCents === 0 ? ", and nothing is paid on the invoice" : `, and the invoice becomes payable for ${cents(payableCents)}`;
    return `${what} is written to the ERP and the exception on case ${ref} is cleared${pay}.${message}`;
  }
  if (path === "hold") return `${what} is recorded in the ERP for case ${ref} and the invoice stays on hold. Nothing is paid yet.${message}`;
  if (path === "wait") return `the invoice is put on hold in the ERP, so it is not paid, and case ${ref} waits for the goods receipt, re-checking daily.${message}`;
  return `case ${ref} follows the “${actionLabel}” path.${message}`;
}

/** What sending back does. `drafts` is how many proposals the reviewer has seen so far. */
export function sendBackEffect(agentName: string, drafts: number): string {
  return `nothing is written. The case returns to the ${agentName} agent, which reworks its proposal using your feedback and brings draft ${drafts + 1} back to you.`;
}

/** What escalating does. */
export function escalateEffect(ref: string): string {
  return `nothing is posted. The invoice is put on hold in the ERP, so it is not paid, and case ${ref} moves to Escalated for an AP specialist, with your note.`;
}

export interface OutcomeInput extends EffectInput {
  status?: string;
  /** The decision as the API read it from the run. */
  decision?: DecisionRecord | null;
}

export interface Outcome {
  /** ok: resolved within the rules; warn: a person overrode the policy check; idle: escalated or still being carried out. Red is kept for rule stops. */
  tone: "ok" | "warn" | "idle" | "crit";
  title: string;
  body: string;
}

const when = dateTime;

/** What was decided and what it did, once a case has a decision. Built only from what the run recorded; undefined when there is nothing to report yet. */
export function decisionOutcome(i: OutcomeInput): Outcome | undefined {
  const d = i.decision;
  const what = `“${i.actionLabel}”${i.amountCents ? ` for ${cents(Math.abs(i.amountCents))}` : ""}`;
  const who = d?.reviewer ?? "a reviewer";
  if (d?.escalatedAt) {
    return {
      tone: "idle",
      title: `Escalated by ${who}`,
      body: `No resolution was posted. The escalation put the invoice on hold, so it is not paid, and the case is with an AP specialist. Note: ${d.escalationNote ?? ""}`,
    };
  }
  const reason = d?.approvalReason ? ` Reason given: ${d.approvalReason}` : "";
  if (d?.postedAt) {
    const pay = i.payableCents == null ? "" : i.payableCents === 0 ? " Nothing is paid on the invoice." : ` The invoice is payable for ${cents(i.payableCents)}.`;
    const wrote = i.path === "hold" ? `${what} was recorded in the ERP on ${when(d.postedAt)}, and the invoice stays on hold.` : `${what} was written to the ERP on ${when(d.postedAt)}.${pay}`;
    if (d.approvedAt && d.againstPolicy) return { tone: "warn", title: `Approved Against the Policy by ${who}`, body: `${wrote}${reason}` };
    return d.approvedAt ? { tone: "ok", title: `Approved by ${who}`, body: `${wrote}${reason}` } : { tone: "ok", title: "Closed Without a Person", body: `${wrote} No rule required a person.` };
  }
  if (d?.approvedAt) {
    const doing = i.path === "wait" ? "The invoice is on hold and the case is waiting for the goods receipt." : "The agent is carrying out the decision; nothing has been written to the ERP yet.";
    return { tone: d.againstPolicy ? "warn" : "idle", title: `Approved${d.againstPolicy ? " Against the Policy" : ""} by ${who}`, body: `Approved on ${when(d.approvedAt)}. ${doing}${reason}` };
  }
  return undefined;
}
