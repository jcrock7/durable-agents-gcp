import { defineQuery, defineSignal } from "@temporalio/workflow";
import type { CaseState } from "./types.js";

/** Everything the portal shows about a case. */
export const caseStateQuery = defineQuery<CaseState>("caseState");

/**
 * Something the case may be waiting for has happened: a vendor replied, or a receipt was posted.
 * The case re-checks at once instead of at its next daily check.
 */
export const recheckSignal = defineSignal<[{ reason: string }]>("recheck");

/** Child → queue: this case no longer needs a working slot (it is waiting, or done). */
export const caseSettledSignal = defineSignal<[{ invoiceId: string }]>("caseSettled");

// Approve or reject the proposal: the shared "review" update from agent-kit.
export { reviewUpdate, type ReviewAck, type ReviewDecision } from "@agents/agent-kit/workflow";
