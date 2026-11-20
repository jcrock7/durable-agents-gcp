import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

/** Model aliases defined in the LiteLLM gateway config (platform/services/litellm). */
export type ModelAlias = "fast" | "smart";

export interface LiteLLMOptions {
  /** The agent's LiteLLM virtual key: carries its budget and attributes its spend. */
  apiKey: string;
  /** OpenAI-compatible base URL of the gateway. Defaults to LITELLM_BASE_URL, then the in-cluster service. */
  baseURL?: string;
}

/**
 * Model clients for one agent. Every call goes through LiteLLM by alias, so agents never hold
 * cloud credentials and never name a provider model (ADR-0005).
 *
 * Retries belong to Temporal, not the AI SDK: pass `maxRetries: 0` on each call (see MODEL_CALL)
 * so a failed attempt is retried by the activity's retry policy, visible in the workflow history.
 */
export function createModels(options: LiteLLMOptions): Record<ModelAlias, LanguageModel> {
  const provider = createOpenAICompatible({
    name: "litellm",
    baseURL: options.baseURL ?? process.env.LITELLM_BASE_URL ?? "http://litellm:4000/v1",
    apiKey: options.apiKey,
    supportsStructuredOutputs: true,
  });
  return { fast: provider.chatModel("fast"), smart: provider.chatModel("smart") };
}

/** Settings shared by every model call made inside an activity. */
export const MODEL_CALL = { maxRetries: 0 } as const;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`environment variable ${name} is not set`);
  return value;
}

/**
 * The cost LiteLLM charged for one model call, from its x-litellm-response-cost response header
 * (USD; 0 if absent, for example with a provider that doesn't report it).
 */
export function gatewayCostUsd(headers: Record<string, string | undefined> | undefined): number {
  const value = Number(headers?.["x-litellm-response-cost"] ?? 0);
  return Number.isFinite(value) ? value : 0;
}
