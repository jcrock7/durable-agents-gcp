// Typed helpers for starting and steering runs, for the API (apps/api) and scripts.
import type { Client, WorkflowHandle } from "@temporalio/client";
import { agentConfig } from "./agent.config.js";
import type { ResearchInput } from "./schemas.js";
import { progressQuery, reviewUpdate, type ReviewAck, type ReviewDecision } from "./signals.js";
import type { Progress } from "./types.js";
import type { researchAndSummarize } from "./workflows/research.workflow.js";

export type ResearchHandle = WorkflowHandle<typeof researchAndSummarize>;

export function startResearch(client: Client, input: ResearchInput, workflowId?: string): Promise<ResearchHandle> {
  return client.workflow.start<typeof researchAndSummarize>(agentConfig.workflowType, {
    taskQueue: agentConfig.taskQueue,
    workflowId: workflowId ?? `research-${crypto.randomUUID()}`,
    args: [input],
  });
}

export function getProgress(handle: WorkflowHandle): Promise<Progress> {
  return handle.query(progressQuery);
}

/** Approve, or reject with feedback. Throws if the run isn't waiting for review. */
export function submitReview(handle: WorkflowHandle, decision: ReviewDecision): Promise<ReviewAck> {
  return handle.executeUpdate(reviewUpdate, { args: [decision] });
}
