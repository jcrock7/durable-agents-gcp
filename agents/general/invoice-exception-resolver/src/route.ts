// Routing rules: which path a proposal takes and whether a person must approve. Plain, workflow-safe
// code over config values; the model proposes, these rules decide (ADR-0020).
import { agentConfig } from "./agent.config.js";
import type { Action, Proposal } from "./schemas.js";
import type { Adjustment, MatchResult, PolicyFit, RouteDecision } from "./types.js";

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

/**
 * Does the proposed action fit the policy (ap-resolution-policy)? Only for actions the match engine's
 * findings can settle; undefined otherwise. Plain code: the model has no say in this.
 */
export function policyFit(proposal: Pick<Proposal, "action">, match: MatchResult): PolicyFit | undefined {
  const price = match.findings.filter((f) => f.code === "PRICE_VARIANCE" && f.details);
  if (price.length === 0) return undefined;
  const noContract = price.some((f) => f.details!.contractPriceCents == null);
  const unsupported = price.some((f) => f.details!.contractPriceCents != null && f.details!.contractSupportsInvoice === false);
  const supported = price.every((f) => f.details!.contractSupportsInvoice === true);
  if (proposal.action === "accept_variance") {
    if (unsupported) return { fits: false, expected: "request_credit_memo", why: "the invoiced price is above the contract price on file" };
    if (noContract) return { fits: false, expected: "escalate", why: "there is no contract price on file for the item" };
    return { fits: true };
  }
  if (proposal.action === "request_credit_memo") {
    if (supported) return { fits: false, expected: "accept_variance", why: "the contract price on the invoice date supports the invoiced price" };
    if (noContract && !unsupported) return { fits: false, expected: "escalate", why: "there is no contract price on file for the item" };
    return { fits: true };
  }
  return undefined;
}

export interface RouteOptions {
  /** Let a policy conflict send the case to a person. Off only when replaying runs that started before the rule existed. */
  enforcePolicyFit?: boolean;
}

export interface RouteInput {
  proposal: Proposal;
  adjustment: Adjustment;
  match: MatchResult;
  citationsValid: boolean;
}

export function route({ proposal, adjustment, match, citationsValid }: RouteInput, policy: Policy = agentConfig, { enforcePolicyFit = true }: RouteOptions = {}): RouteDecision {
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
  const fit = policyFit(proposal, match);
  if (fit && !fit.fits && enforcePolicyFit) reasons.push(`${proposal.action} does not fit the policy: ${fit.why}`);
  return { ...PATHS[proposal.action], needsPerson: reasons.length > 0, reasons, ...(fit ? { policyFit: fit } : {}) };
}

/** Why an invoice is on hold after a resolution was recorded, and what releases it. */
export function holdReason(decision: Pick<RouteDecision, "message">, action: string): string {
  if (action === "request_credit_memo") return "waiting for a credit memo from the vendor; released when the credit is recorded";
  if (decision.message) return `waiting on the ${decision.message.recipient}; released when they reply and a person re-checks`;
  return "held by the resolution; released by an accounts payable specialist";
}

/** Evidence references in the rationale and the cited list, and whether they all exist. */
export function checkCitations(proposal: Proposal, evidenceRefs: readonly string[]): { cited: string[]; valid: boolean } {
  const known = new Set(evidenceRefs);
  // Citations like [E2], or grouped like [E1, E3].
  const inText = [...proposal.rationale.matchAll(/\[(E\d+(?:\s*,\s*E\d+)*)\]/g)].flatMap((m) => m[1]!.split(/\s*,\s*/));
  const all = [...new Set([...proposal.citedEvidence.map((r) => r.replace(/[[\]\s]/g, "")), ...inText])];
  const cited = all.filter((r) => known.has(r));
  return { cited, valid: cited.length > 0 && cited.length === all.length };
}
