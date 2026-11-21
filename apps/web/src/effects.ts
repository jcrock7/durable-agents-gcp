import { cents } from "./api.js";

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
    const pay = payableCents == null ? "" : payableCents === 0 ? ", and nothing is paid on this invoice" : `, and the invoice becomes payable for ${cents(payableCents)}`;
    return `${what} is written to the ERP, the exception on invoice ${ref} is cleared${pay}.${message}`;
  }
  if (path === "hold") return `${what} is recorded in the ERP and invoice ${ref} stays on hold. Nothing is paid yet.${message}`;
  if (path === "wait") return `invoice ${ref} is held and the case waits for the goods receipt, re-checking daily.${message}`;
  return `the case follows the “${actionLabel}” path.${message}`;
}

/** What sending back does. */
export function sendBackEffect(agentName: string, round: number): string {
  return `nothing is written. The case returns to the ${agentName} agent, which reworks its proposal using your feedback and brings round ${round + 1} back to you.`;
}

/** What escalating does. */
export function escalateEffect(ref: string): string {
  return `nothing is posted. Invoice ${ref} is put on hold and the case moves to Escalated for an AP specialist, with your note.`;
}

export interface OutcomeInput extends EffectInput {
  status?: string;
  reviewer?: string;
  /** When the reviewer approved, from the run's timeline. */
  approvedAt?: string;
  /** The reason the approver gave, when they gave one. */
  approvalReason?: string;
  /** When the resolution was written to the ERP; absent if nothing was written. */
  postedAt?: string;
  /** The reviewer's note when they escalated. */
  escalationNote?: string;
}

export interface Outcome {
  tone: "ok" | "idle" | "crit";
  title: string;
  body: string;
}

const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleTimeString("en-GB", { hour12: false })} on ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
};

/** What was decided and what it did, once a case has a decision. Built only from what the run recorded; undefined when there is nothing to report yet. */
export function decisionOutcome(i: OutcomeInput): Outcome | undefined {
  const what = `“${i.actionLabel}”${i.amountCents ? ` for ${cents(Math.abs(i.amountCents))}` : ""}`;
  const who = i.reviewer ?? "a reviewer";
  if (i.escalationNote != null) {
    return { tone: "crit", title: `Escalated by ${who}`, body: `Nothing was posted. Invoice ${i.ref} is on hold for an AP specialist. Note: ${i.escalationNote}` };
  }
  const reason = i.approvalReason ? ` Reason given: ${i.approvalReason}` : "";
  if (i.postedAt) {
    const pay = i.payableCents == null ? "" : i.payableCents === 0 ? " Nothing is paid on this invoice." : ` The invoice is payable for ${cents(i.payableCents)}.`;
    const wrote = i.path === "hold" ? `${what} was recorded in the ERP at ${when(i.postedAt)}, and invoice ${i.ref} stays on hold.` : `${what} was written to the ERP at ${when(i.postedAt)}.${pay}`;
    return i.approvedAt ? { tone: "ok", title: `Approved by ${who}`, body: `${wrote}${reason}` } : { tone: "ok", title: "Closed Without a Person", body: `${wrote} No rule required a person.` };
  }
  if (i.approvedAt) return { tone: "idle", title: `Approved by ${who}`, body: `Approved at ${when(i.approvedAt)}. The agent is carrying out the decision; nothing has been written to the ERP yet.${reason}` };
  return undefined;
}
