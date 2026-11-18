import { ActivityFailure, ApplicationFailure, type ActivityOptions } from "@temporalio/common";
import { NON_RETRYABLE_FAILURES } from "../failure-types.js";

/**
 * Model calls: generous timeout for long generations, exponential backoff for rate limits.
 * Each attempt is one LLM request; retries show up in the workflow history. The activity
 * heartbeats while waiting (withHeartbeat), so if its worker dies Temporal retries it after
 * 20 seconds rather than 3 minutes.
 */
export const MODEL_CALL_OPTIONS: ActivityOptions = {
  startToCloseTimeout: "3 minutes",
  heartbeatTimeout: "20 seconds",
  retry: {
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
    maximumInterval: "1 minute",
    maximumAttempts: 5,
    nonRetryableErrorTypes: NON_RETRYABLE_FAILURES,
  },
};

/** Tool calls (HTTP APIs): short timeout, quick retries. */
export const TOOL_CALL_OPTIONS: ActivityOptions = {
  startToCloseTimeout: "30 seconds",
  retry: {
    initialInterval: "1 second",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
    maximumAttempts: 5,
    nonRetryableErrorTypes: NON_RETRYABLE_FAILURES,
  },
};

/** The failure type an activity raised (e.g. "GuardrailBlocked"), or undefined for anything else. */
export function failureTypeOf(error: unknown): string | undefined {
  if (error instanceof ActivityFailure && error.cause instanceof ApplicationFailure) {
    return error.cause.type ?? undefined;
  }
  return undefined;
}
