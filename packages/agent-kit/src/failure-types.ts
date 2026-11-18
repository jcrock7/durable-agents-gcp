/** Failure types raised by activities. Workflow-safe: plain constants only. */
export const FailureType = {
  /** The prompt-injection guardrail rejected the input. Not retried. */
  GuardrailBlocked: "GuardrailBlocked",
  /** The agent's LiteLLM budget is used up. Not retried. */
  BudgetExceeded: "BudgetExceeded",
  /** The agent's LiteLLM key is missing or revoked. Not retried. */
  Unauthorized: "Unauthorized",
  /** The gateway rejected the request (bad model alias, bad parameters). Not retried. */
  InvalidRequest: "InvalidRequest",
  /** A tool call outside the agent's allow-list. Not retried. */
  ToolNotAllowed: "ToolNotAllowed",
  /** A transient model failure (timeout, rate limit, 5xx). Retried. */
  ModelCallFailed: "ModelCallFailed",
} as const;

export type FailureType = (typeof FailureType)[keyof typeof FailureType];

export const NON_RETRYABLE_FAILURES: string[] = [
  FailureType.GuardrailBlocked,
  FailureType.BudgetExceeded,
  FailureType.Unauthorized,
  FailureType.InvalidRequest,
  FailureType.ToolNotAllowed,
];
