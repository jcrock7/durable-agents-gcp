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
