import { ApplicationFailure } from "@temporalio/common";
import { APICallError } from "ai";
import { FailureType } from "./failure-types.js";

/**
 * Turn an error from a model call into the failure Temporal should see.
 *
 * Retrying can't fix a guardrail block, an exhausted budget, a bad key or a malformed request, so
 * those become non-retryable failures with a type the workflow can branch on. Anything else
 * (timeouts, 429 rate limits, 5xx) stays retryable under the activity's retry policy.
 */
export function toActivityFailure(error: unknown): Error {
  const api = findApiCallError(error);
  if (!api) return error instanceof Error ? error : new Error(String(error));

  const status = api.statusCode;
  const body = api.responseBody ?? "";
  const details = { status, message: api.message };

  if (/prompt-injection guardrail/i.test(body)) {
    return ApplicationFailure.nonRetryable(
      `blocked by the prompt-injection guardrail: ${guardrailReason(body) ?? "no reason given"}`,
      FailureType.GuardrailBlocked,
      details,
    );
  }
  if (/budget_exceeded|budget has been exceeded/i.test(body)) {
    return ApplicationFailure.nonRetryable("the agent's LiteLLM budget is exhausted", FailureType.BudgetExceeded, details);
  }
  if (status === 401 || status === 403) {
    return ApplicationFailure.nonRetryable("LiteLLM rejected the agent's key", FailureType.Unauthorized, details);
  }
  if (status === 400 || status === 404 || status === 422) {
    return ApplicationFailure.nonRetryable(`LiteLLM rejected the request: ${api.message}`, FailureType.InvalidRequest, details);
  }
  return ApplicationFailure.retryable(`model call failed: ${api.message}`, FailureType.ModelCallFailed, details);
}

function findApiCallError(error: unknown): APICallError | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if (APICallError.isInstance(current)) return current;
    const next = current as { lastError?: unknown; cause?: unknown };
    current = next.lastError ?? next.cause;
  }
  return undefined;
}

function guardrailReason(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: { provider_specific_fields?: { reason?: string } } };
    return parsed.error?.provider_specific_fields?.reason;
  } catch {
    return undefined;
  }
}
