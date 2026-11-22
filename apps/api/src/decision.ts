// What a case's decision was and who allowed each write to the ERP, read from the run's recorded
// timeline and tool calls. Kept here so the browser never parses workflow text to find these facts.

type AnyState = Record<string, any>;

/** One write to the ERP and what allowed it: a person's decision or a named workflow rule. */
export interface WriteRecord {
  /** The tool, e.g. "erp-write:set_invoice_hold". */
  ref: string;
  /** Plain name of the write, e.g. "Invoice put on hold". */
  label: string;
  at: string;
  by: "person" | "rule";
  /** The person, when a person allowed it. */
  who?: string;
  /** The rule or decision, in a sentence. */
  why: string;
}

/** The decision on a case, once there is one. */
export interface DecisionRecord {
  reviewer?: string;
  approvedAt?: string;
  /** The reason the approver gave, when they gave one. */
  approvalReason?: string;
  escalatedAt?: string;
  escalationNote?: string;
  /** When the resolution was written to the ERP. */
  postedAt?: string;
  /** How many times the reviewer sent the proposal back. */
  sentBack: number;
  /** True when a person approved a proposal the policy check said does not fit: an override. */
  againstPolicy?: boolean;
}

/** The approval line a proposal went over, when that rule fired. Amounts in cents. */
export interface Threshold {
  amountCents: number;
  lineCents: number;
}

const LABEL: Record<string, string> = {
  "erp-write:set_invoice_hold": "Invoice put on hold",
  "erp-write:post_resolution": "Resolution posted",
  "erp-write:queue_message": "Message queued",
};

const lastAt = (timeline: AnyState[], name: RegExp): AnyState | undefined => [...timeline].reverse().find((t) => name.test(String(t.name)));

export function decisionOf(state: AnyState | undefined): DecisionRecord | undefined {
  if (!state) return undefined;
  const timeline: AnyState[] = Array.isArray(state.timeline) ? state.timeline : [];
  const approved = lastAt(timeline, /^approved$/i);
  const escalated = lastAt(timeline, /^escalated by reviewer$/i);
  const posted = lastAt(timeline, /^post resolution$/i);
  const reason = / · reason: ([\s\S]+)$/.exec(String(approved?.detail ?? ""))?.[1]?.trim();
  return {
    ...(state.reviewer ? { reviewer: String(state.reviewer) } : {}),
    ...(approved ? { approvedAt: String(approved.at) } : {}),
    ...(reason ? { approvalReason: reason } : {}),
    ...(escalated ? { escalatedAt: String(escalated.at), escalationNote: String(escalated.detail ?? "") } : {}),
    ...(posted ? { postedAt: String(posted.at) } : {}),
    sentBack: Array.isArray(state.feedback) ? state.feedback.length : 0,
    ...(approved && state.route?.policyFit?.fits === false ? { againstPolicy: true } : {}),
  };
}

/** Each successful ERP write, with what allowed it. */
export function writesOf(state: AnyState | undefined): WriteRecord[] {
  if (!state) return [];
  const d = decisionOf(state)!;
  const calls: AnyState[] = (state.toolCalls ?? []).filter((c: AnyState) => String(c.ref).startsWith("erp-write:") && c.outcome === "ok");
  const after = (at: string, since?: string) => since !== undefined && Date.parse(at) >= Date.parse(since);
  const endsWithSpecialist = ["blocked", "escalated", "expired"].includes(String(state.status ?? "")) || state.route?.path === "escalate";
  return calls.map((c): WriteRecord => {
    const ref = String(c.ref);
    const at = String(c.at);
    const base = { ref, label: LABEL[ref] ?? ref, at };
    if (after(at, d.escalatedAt)) return { ...base, by: "person", who: d.reviewer, why: `${d.reviewer ?? "The reviewer"} escalated the case; the hold keeps the invoice unpaid until the specialist acts.` };
    if (after(at, d.approvedAt)) return { ...base, by: "person", who: d.reviewer, why: `Approved by ${d.reviewer ?? "a reviewer"}.` };
    if (ref === "erp-write:post_resolution" && c.args?.action === "cleared_by_rematch") {
      return { ...base, by: "rule", why: "The invoice matched its purchase order and receipts on re-check; clearing a matched invoice needs no approval." };
    }
    if (ref === "erp-write:set_invoice_hold") {
      return endsWithSpecialist
        ? { ...base, by: "rule", why: "Protective hold: a case that ends with a specialist is held, so the invoice is not paid while a person takes over." }
        : { ...base, by: "rule", why: "This run started before holds needed approval, so the wait-for-receipt rule held the invoice." };
    }
    return { ...base, by: "rule", why: "Within the approval rules: no rule required a person for this action and amount." };
  });
}

/** The approval line from the route, when the amount went over it. */
export function thresholdOf(state: AnyState | undefined): Threshold | undefined {
  const reasons: string[] = state?.route?.reasons ?? [];
  for (const r of reasons) {
    const m = /amount (\d+(?:\.\d+)?) is over the (\d+(?:\.\d+)?) approval line/.exec(r);
    if (m) return { amountCents: Math.round(Number(m[1]) * 100), lineCents: Math.round(Number(m[2]) * 100) };
  }
  return undefined;
}

/** Why a case needed a person, grouped for a business reader: the policy, a risk, or the evidence. */
export interface PersonReason {
  kind: "approval_line" | "always" | "policy_conflict" | "hold" | "fraud" | "low_confidence" | "evidence" | "citations" | "type_mismatch" | "guardrail";
  group: "policy" | "risk" | "evidence";
  label: string;
  /** The rule's recorded text, exact, for the technical reader. */
  rule?: string;
}

const ACTION_LABEL: Record<string, string> = {
  accept_variance: "Accepting a price variance",
  short_pay: "Short-paying an invoice",
  reject_duplicate: "Rejecting a duplicate",
};
const usd0 = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

/** The route's recorded reasons in plain language. Empty when no rule sent the case to a person. */
export function personReasonsOf(state: AnyState | undefined): PersonReason[] {
  if (!state) return [];
  const out: PersonReason[] = [];
  const add = (r: PersonReason, rule?: string) => {
    if (!out.some((o) => o.kind === r.kind)) out.push(rule ? { ...r, rule } : r);
  };
  if (state.status === "blocked") add({ kind: "guardrail", group: "risk", label: "A guardrail stopped the run" });
  const route = state.route as AnyState | undefined;
  const reasons: string[] = route?.reasons ?? [];
  if (route?.path === "escalate") {
    // escalate: fraud ("possible fraud", then signals), unsettled evidence, or low confidence; always exactly one kind.
    const first = reasons[0] ?? "";
    if (first === "possible fraud") add({ kind: "fraud", group: "risk", label: "Possible fraud" }, reasons.join("; "));
    else if (/^low confidence/.test(first)) add({ kind: "low_confidence", group: "risk", label: "The agent was not confident" }, first);
    else if (first) add({ kind: "evidence", group: "evidence", label: "The evidence did not settle the case" }, first);
    return out;
  }
  if (!route?.needsPerson) return out;
  for (const r of reasons) {
    const line = /amount (\d+(?:\.\d+)?) is over the (\d+(?:\.\d+)?) approval line/.exec(r);
    if (line) add({ kind: "approval_line", group: "policy", label: `Over the ${usd0(Number(line[2]) * 100)} approval line` }, r);
    else if (/ always needs a person$/.test(r)) add({ kind: "always", group: "policy", label: `${ACTION_LABEL[r.replace(/ always needs a person$/, "")] ?? "This action"} always needs a person` }, r);
    else if (/ does not fit the policy/.test(r)) add({ kind: "policy_conflict", group: "policy", label: "The proposal conflicts with the AP policy" }, r);
    else if (/goods receipt needs a person/.test(r)) add({ kind: "hold", group: "policy", label: "Holding for a goods receipt needs a person" }, r);
    else if (/does not cite valid evidence/.test(r)) add({ kind: "citations", group: "evidence", label: "The proposal did not cite valid evidence" }, r);
    else if (/^classified as .*match engine found/.test(r)) add({ kind: "type_mismatch", group: "evidence", label: "The agent and the match engine disagreed on the exception" }, r);
  }
  return out;
}

/** "7 days" (a workflow duration) as a number of days; undefined for anything else. */
export function daysOf(duration: unknown): number | undefined {
  const m = /^(\d+(?:\.\d+)?)\s*days?$/i.exec(String(duration ?? "").trim());
  return m ? Number(m[1]) : undefined;
}

/** What a research draft rests on: how many points, which sources it cites, which it leaves out or the agent marked unrelated. */
export interface ResearchCoverage {
  question?: string;
  points: number;
  sources: number;
  cited: number[];
  uncited: number[];
  /** Sources the agent itself marked as not bearing on the question (runs from 2026-11-22 on). */
  unrelated: number[];
  /** Each key point's citations, so a point resting on one source is visible. */
  pointSources: number[][];
}

export function researchOf(state: AnyState | undefined): ResearchCoverage | undefined {
  if (!state?.draft) return undefined;
  const ids: number[] = (state.sources ?? []).map((s: AnyState) => Number(s.id));
  const points: string[] = state.draft.keyPoints ?? [];
  const refs = (text: string) => [...String(text).matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])).filter((n) => ids.includes(n));
  const inText = new Set([...refs(state.draft.summary ?? ""), ...points.flatMap(refs)]);
  const cited = ids.filter((id) => inText.has(id) || (state.draft.citedSources ?? []).includes(id));
  return {
    ...(state.question ? { question: String(state.question) } : {}),
    points: points.length,
    sources: ids.length,
    cited,
    uncited: ids.filter((id) => !cited.includes(id)),
    unrelated: (state.draft.unrelatedSources ?? []).map(Number).filter((n: number) => ids.includes(n)),
    pointSources: points.map((p) => [...new Set(refs(p))]),
  };
}

/** When a waiting proposal expires, and what happens then. Only while the case waits on a reviewer. */
export function deadlineOf(state: AnyState | undefined, reviewDays: number | undefined): { expiresAt: string; onExpiry: string } | undefined {
  if (!state || !reviewDays || state.stage !== "awaiting_review") return undefined;
  const waiting = lastAt(Array.isArray(state.timeline) ? state.timeline : [], /^waiting for approval$/i);
  if (!waiting) return undefined;
  return {
    expiresAt: new Date(Date.parse(String(waiting.at)) + reviewDays * 86_400_000).toISOString(),
    onExpiry: state.invoiceId
      ? "If nobody decides by then, the invoice is put on hold and the case goes to a specialist."
      : "If nobody decides by then, the run ends as expired and the brief is not approved.",
  };
}
