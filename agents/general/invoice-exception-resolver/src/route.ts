// Routing rules: which path a proposal takes and whether a person must approve. Plain, workflow-safe
// code over config values; the model proposes, these rules decide (ADR-0020).
import { agentConfig } from "./agent.config.js";
import type { Action, Proposal } from "./schemas.js";
import type { Adjustment, MatchResult, RouteDecision } from "./types.js";

type Policy = Pick<typeof agentConfig, "approval">;

const PATHS: Record<Action, Pick<RouteDecision, "path" | "invoiceStatus" | "message">> = {
  accept_variance: { path: "post", invoiceStatus: "resolved" },
  accept_uom_conversion: { path: "post", invoiceStatus: "resolved" },
  accept_charge: { path: "post", invoiceStatus: "resolved" },
  short_pay: { path: "post", invoiceStatus: "resolved", message: { recipient: "vendor", purpose: "Tell the vendor we are paying only for the units received" } },
  reject_duplicate: { path: "post", invoiceStatus: "resolved", message: { recipient: "vendor", purpose: "Tell the vendor this invoice duplicates one already paid and will not be paid again" } },
  reassign_po: { path: "post", invoiceStatus: "resolved", message: { recipient: "buyer", purpose: "Ask the buyer to confirm the invoice belongs to the correct open PO" } },
  request_credit_memo: { path: "hold", invoiceStatus: "on_hold", message: { recipient: "vendor", purpose: "Ask the vendor for a credit memo for the amount billed in error" } },
  wait_for_receipt: { path: "wait", invoiceStatus: "on_hold" },
  request_receipt_entry: { path: "wait", invoiceStatus: "on_hold", message: { recipient: "receiving", purpose: "Ask receiving to post the goods receipt for goods that were delivered" } },
  escalate: { path: "escalate", invoiceStatus: "on_hold" },
};

export interface RouteInput {
  proposal: Proposal;
  adjustment: Adjustment;
  match: MatchResult;
  citationsValid: boolean;
}

export function route({ proposal, adjustment, match, citationsValid }: RouteInput, policy: Policy = agentConfig): RouteDecision {
  const fraudSignals = match.findings.filter((f) => f.severity === "fraud_signal").map((f) => f.message);
  if (proposal.fraudFlag || fraudSignals.length > 0) {
    return {
      path: "escalate",
      needsPerson: true,
      invoiceStatus: "on_hold",
      reasons: ["possible fraud", ...(proposal.fraudReason ? [proposal.fraudReason] : []), ...fraudSignals],
    };
  }
  if (proposal.action === "escalate") {
    return { path: "escalate", needsPerson: true, invoiceStatus: "on_hold", reasons: [proposal.unconfirmed || "the evidence does not settle the case"] };
  }
  if (proposal.confidence === "low") {
    return { path: "escalate", needsPerson: true, invoiceStatus: "on_hold", reasons: [`low confidence in ${proposal.action}`] };
  }

  const reasons: string[] = [];
  const always = policy.approval.alwaysFor as readonly string[];
  if (always.includes(proposal.action)) reasons.push(`${proposal.action} always needs a person`);
  if (Math.abs(adjustment.amountCents) > policy.approval.amountCents) {
    reasons.push(`amount ${(Math.abs(adjustment.amountCents) / 100).toFixed(2)} is over the ${(policy.approval.amountCents / 100).toFixed(2)} approval line`);
  }
  if (!citationsValid) reasons.push("the proposal does not cite valid evidence");
  if (match.exceptionTypes.length > 0 && !match.exceptionTypes.includes(proposal.exceptionType)) {
    reasons.push(`classified as ${proposal.exceptionType}, but the match engine found ${match.exceptionTypes.join(", ")}`);
  }
  return { ...PATHS[proposal.action], needsPerson: reasons.length > 0, reasons };
}

/** Evidence references in the rationale and the cited list, and whether they all exist. */
export function checkCitations(proposal: Proposal, evidenceRefs: readonly string[]): { cited: string[]; valid: boolean } {
  const known = new Set(evidenceRefs);
  const inText = [...proposal.rationale.matchAll(/\[(E\d+)\]/g)].map((m) => m[1]!);
  const all = [...new Set([...proposal.citedEvidence.map((r) => r.replace(/[[\]\s]/g, "")), ...inText])];
  const cited = all.filter((r) => known.has(r));
  return { cited, valid: cited.length > 0 && cited.length === all.length };
}
