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

/** Live state, returned by the "progress" query. */
export interface Progress {
  stage: Stage;
  queries: string[];
  sources: SourceRef[];
  draftVersion: number;
  draft?: Draft;
  lastFeedback?: string;
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
