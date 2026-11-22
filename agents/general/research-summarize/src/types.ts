import type { Draft } from "./schemas.js";

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface SourceRef {
  /** Citation number used in the draft: [1], [2], ... */
  id: number;
  title: string;
  url: string;
}

export interface Source extends SourceRef {
  /** Plain-text article extract, truncated to the agent's limit. */
  text: string;
}

export type Stage =
  | "planning"
  | "searching"
  | "reading"
  | "drafting"
  | "awaiting_review"
  | "revising"
  | "done";

/** One model call's tokens and gateway cost. */
export interface Usage {
  step: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** Live state, returned by the "progress" query. */
export interface Progress {
  stage: Stage;
  /** The question asked. Absent on runs started before it was recorded. */
  question?: string;
  /** How long a draft waits for review (the config value), so the portal can show the deadline. */
  reviewTimeout?: string;
  /** Model calls, with gateway cost. Absent on runs started before cost was recorded. */
  usage?: Usage[];
  queries: string[];
  sources: SourceRef[];
  draftVersion: number;
  draft?: Draft;
  lastFeedback?: string;
  /** What the run did, in order, for the portal's step strip. */
  timeline?: Array<{ name: string; at: string; detail: string; state: "done" | "now" }>;
}

export type ResearchStatus =
  /** A reviewer approved the draft. */
  | "approved"
  /** Run with requireApproval: false; the first draft is the result. */
  | "auto_approved"
  /** Rejected after the maximum number of revisions. */
  | "rejected"
  /** Nobody reviewed the draft before the timeout. */
  | "expired"
  /** The prompt-injection guardrail rejected the question or a source. */
  | "blocked"
  /** No usable sources were found. */
  | "no_sources";

export interface ResearchResult {
  status: ResearchStatus;
  question: string;
  summary?: string;
  keyPoints?: string[];
  sources: SourceRef[];
  draftVersion: number;
  reviewer?: string;
  /** Why the run ended without an approved answer. */
  reason?: string;
  promptVersion: string;
}
