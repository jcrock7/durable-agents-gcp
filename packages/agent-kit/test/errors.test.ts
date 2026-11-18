import { ApplicationFailure } from "@temporalio/common";
import { APICallError } from "ai";
import { describe, expect, it } from "vitest";
import { FailureType, toActivityFailure } from "../dist/index.js";

function apiError(statusCode: number, responseBody: string): APICallError {
  return new APICallError({
    message: `HTTP ${statusCode}`,
    url: "http://litellm:4000/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    responseBody,
    isRetryable: statusCode >= 500,
  });
}

function failure(error: unknown): ApplicationFailure {
  const result = toActivityFailure(error);
  expect(result).toBeInstanceOf(ApplicationFailure);
  return result as ApplicationFailure;
}

describe("toActivityFailure", () => {
  it("makes a guardrail block non-retryable and keeps the classifier's reason", () => {
    const body = JSON.stringify({
      error: {
        message: "Blocked by prompt-injection guardrail",
        provider_specific_fields: { reason: "tries to override instructions" },
      },
    });
    const f = failure(apiError(400, body));
    expect(f.type).toBe(FailureType.GuardrailBlocked);
    expect(f.nonRetryable).toBe(true);
    expect(f.message).toContain("tries to override instructions");
  });

  it("makes an exhausted budget non-retryable", () => {
    const f = failure(apiError(400, '{"error":{"type":"budget_exceeded","message":"Budget has been exceeded!"}}'));
    expect(f.type).toBe(FailureType.BudgetExceeded);
    expect(f.nonRetryable).toBe(true);
  });

  it("makes a rejected key non-retryable", () => {
    const f = failure(apiError(401, '{"error":{"message":"Authentication Error"}}'));
    expect(f.type).toBe(FailureType.Unauthorized);
    expect(f.nonRetryable).toBe(true);
  });

  it("keeps rate limits and server errors retryable", () => {
    for (const status of [429, 500, 503]) {
      const f = failure(apiError(status, "{}"));
      expect(f.type).toBe(FailureType.ModelCallFailed);
      expect(f.nonRetryable).toBe(false);
    }
  });

  it("finds the API error behind a wrapper", () => {
    const wrapped = Object.assign(new Error("RetryError"), { lastError: apiError(401, "{}") });
    expect(failure(wrapped).type).toBe(FailureType.Unauthorized);
  });

  it("passes other errors through unchanged", () => {
    const plain = new Error("socket hang up");
    expect(toActivityFailure(plain)).toBe(plain);
  });
});
