// Typed helpers for starting and steering cases, for the API (apps/api), scripts and tests.
import type { Client, WorkflowHandle } from "@temporalio/client";
import { agentConfig } from "./agent.config.js";
import type { QueueInput, ResolveInput } from "./schemas.js";
import { caseStateQuery, recheckSignal, reviewUpdate, type ReviewAck, type ReviewDecision } from "./signals.js";
import type { CaseState } from "./types.js";

export const caseWorkflowId = (invoiceId: string) => invoiceId.toLowerCase();

export function startCase(client: Client, input: ResolveInput): Promise<WorkflowHandle> {
  return client.workflow.start("resolveInvoiceException", {
    taskQueue: agentConfig.taskQueue,
    workflowId: caseWorkflowId(input.invoiceId),
    args: [input],
  });
}

export function startQueue(client: Client, input: QueueInput = {}, workflowId = `exception-queue-${Date.now()}`): Promise<WorkflowHandle> {
  return client.workflow.start("resolveExceptionQueue", { taskQueue: agentConfig.taskQueue, workflowId, args: [input] });
}

export function getCaseState(handle: WorkflowHandle): Promise<CaseState> {
  return handle.query(caseStateQuery);
}

/** Approve, or send back with feedback. Throws if the case isn't waiting for review. */
export function submitReview(handle: WorkflowHandle, decision: ReviewDecision): Promise<ReviewAck> {
  return handle.executeUpdate(reviewUpdate, { args: [decision] });
}

/** A vendor replied or a receipt was posted: re-check now. */
export function requestRecheck(handle: WorkflowHandle, reason: string): Promise<void> {
  return handle.signal(recheckSignal, { reason });
}
