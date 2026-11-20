import { WorkflowExecutionAlreadyStartedError } from "@temporalio/common";
import { ApplicationFailure, ParentClosePolicy, condition, proxyActivities, setHandler, startChild, workflowInfo } from "@temporalio/workflow";
import { TOOL_CALL_OPTIONS } from "@agents/agent-kit/workflow";
import type { Activities } from "../activities.js";
import { agentConfig } from "../agent.config.js";
import { QueueInputSchema, type QueueInput } from "../schemas.js";
import { caseSettledSignal } from "../signals.js";
import type { QueueResult } from "../types.js";
import { resolveInvoiceException } from "./resolve.workflow.js";

const { listOpenExceptions } = proxyActivities<Activities>(TOOL_CALL_OPTIONS);

/** Workflow id of the case for an invoice: INV-20931 → inv-20931 (the ids the portal shows). */
export const caseWorkflowId = (invoiceId: string) => invoiceId.toLowerCase();

/**
 * Fan the open exceptions out to one child workflow each, at most `queue.maxParallel` being
 * actively worked at a time. A case gives its slot back when it starts waiting (for a person or a
 * receipt) or finishes, so long waits never block the queue. Children are abandoned, not
 * cancelled, when the queue ends: each case lives on until it is resolved.
 */
export async function resolveExceptionQueue(rawInput: QueueInput = {}): Promise<QueueResult> {
  const parsed = QueueInputSchema.safeParse(rawInput);
  if (!parsed.success) throw ApplicationFailure.nonRetryable(`invalid input: ${parsed.error.message}`, "InvalidInput");
  const { maxParallel } = agentConfig.queue;
  const active = new Set<string>();
  setHandler(caseSettledSignal, ({ invoiceId }) => {
    active.delete(invoiceId);
  });

  const { exceptions } = await listOpenExceptions({ limit: parsed.data.limit });
  const result: QueueResult = { started: [], skipped: [] };
  for (const ex of exceptions) {
    await condition(() => active.size < maxParallel);
    try {
      await startChild(resolveInvoiceException, {
        workflowId: caseWorkflowId(ex.invoiceId),
        args: [{ ...ex, parentWorkflowId: workflowInfo().workflowId }],
        parentClosePolicy: ParentClosePolicy.ABANDON,
      });
      active.add(ex.invoiceId);
      result.started.push(caseWorkflowId(ex.invoiceId));
    } catch (error) {
      // A case already running for this invoice: leave it alone.
      if (error instanceof WorkflowExecutionAlreadyStartedError) result.skipped.push(caseWorkflowId(ex.invoiceId));
      else throw error;
    }
  }
  await condition(() => active.size === 0);
  return result;
}
