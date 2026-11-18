import { defineQuery } from "@temporalio/workflow";
import type { Progress } from "./types.js";

/** Current stage, sources and draft of a run. */
export const progressQuery = defineQuery<Progress>("progress");

// Approve or reject the draft: the shared "review" update from agent-kit.
export { reviewUpdate, type ReviewDecision, type ReviewAck } from "@agents/agent-kit/workflow";
