// Plain data shared by workflow code, activities and clients. No imports with side effects.
import type { ToolCallRecord } from "@agents/agent-kit";
import type { Action, InvoiceFields, MessageDraft, Proposal } from "./schemas.js";

export type { ToolCallRecord };

/** A match-engine finding, as run_match returns it. */
export interface Finding {
  code: string;
  severity: "info" | "exception" | "fraud_signal";
  lineNo?: number;
  message: string;
  amountCents?: number;
  details?: Record<string, unknown>;
}

export interface MatchResult {
  invoiceId: string;
  status: "matched" | "exception";
  findings: Finding[];
  exceptionTypes: string[];
  totals: { invoiceCents: number; poMatchedCents: number };
}

export interface Adjustment {
  invoiceId: string;
  action: Action;
  amountCents: number;
  payableCents: number | null;
  basis: string[];
}

/** One piece of evidence the proposal may cite: one tool result. */
export interface Evidence {
  ref: string;
  /** server:tool that produced it. */
  source: string;
  args: Record<string, unknown>;
  /** The result, cut to a readable length. */
  excerpt: string;
}

export interface Usage {
  step: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** What the gateway charged (USD), from its response header. */
  costUsd: number;
}

export type Recipient = "vendor" | "buyer" | "receiving";

export interface RouteDecision {
  /** post: record the resolution now; hold: record it with the invoice on hold; wait: hold and wait for a receipt; escalate: hold and hand to a person. */
  path: "post" | "hold" | "wait" | "escalate";
  needsPerson: boolean;
  reasons: string[];
  message?: { recipient: Recipient; purpose: string };
  invoiceStatus: "resolved" | "on_hold";
}

export type CaseStatus = "resolved" | "on_hold" | "escalated" | "rejected_by_reviewer" | "blocked" | "expired";

export type Stage =
  | "matching"
  | "reading_invoice"
  | "gathering_evidence"
  | "proposing"
  | "awaiting_review"
  | "sending_message"
  | "posting"
  | "waiting"
  | "done";

export interface TimelineEntry {
  name: string;
  at: string;
  detail: string;
  state: "done" | "now" | "error";
}

/** Everything the portal shows about one case (the caseState query). */
export interface CaseState {
  exceptionId: string;
  invoiceId: string;
  stage: Stage;
  round: number;
  status?: CaseStatus;
  reasons: string[];
  match?: MatchResult;
  invoice?: InvoiceFields;
  evidence: Evidence[];
  notes?: string;
  proposal?: Proposal;
  citationsValid?: boolean;
  draftVersion: number;
  adjustment?: Adjustment;
  route?: RouteDecision;
  reviewer?: string;
  feedback: string[];
  message?: MessageDraft & { to: string };
  waitingFor?: string;
  remindersSent: number;
  timeline: TimelineEntry[];
  toolCalls: ToolCallRecord[];
  skillVersions: Record<string, string>;
  usage: Usage[];
}

export interface CaseResult {
  exceptionId: string;
  invoiceId: string;
  status: CaseStatus;
  action?: Action;
  exceptionType?: string;
  amountCents?: number;
  reasons: string[];
  reviewer?: string;
  rounds: number;
  humanTouches: number;
  citedEvidence: string[];
  toolCalls: number;
  usage: Usage[];
  skillVersions: Record<string, string>;
  promptVersion: string;
}

export interface QueueResult {
  started: string[];
  skipped: string[];
}
