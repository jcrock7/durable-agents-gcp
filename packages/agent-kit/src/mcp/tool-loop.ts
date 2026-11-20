import { generateText, stepCountIs, type LanguageModel } from "ai";
import { gatewayCostUsd, MODEL_CALL } from "../llm.js";
import type { McpToolbox } from "./toolbox.js";
import type { ToolCallRecord } from "./types.js";

export interface ToolLoopOptions {
  model: LanguageModel;
  system: string;
  prompt: string;
  toolbox: McpToolbox;
  /** Model steps at most, counting the final answer. A step may call several tools. */
  maxSteps: number;
  abortSignal?: AbortSignal;
}

export interface ToolLoopResult {
  /** The model's final text. */
  text: string;
  /** Model steps taken. */
  steps: number;
  /** True if the loop hit `maxSteps` while the model still wanted to call tools. */
  stoppedAtLimit: boolean;
  /** Tool calls made during this loop, refused ones included. */
  calls: ToolCallRecord[];
  /** Tokens over all steps, and the gateway's reported cost (USD). */
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

/**
 * A model-driven loop over the agent's read-only MCP tools, inside one activity (ADR-0020). The
 * model sees only model-visible tools; asking for any other tool is recorded as refused. The loop
 * stops after `maxSteps` model steps whatever the model wants.
 */
export async function runToolLoop(options: ToolLoopOptions): Promise<ToolLoopResult> {
  const { toolbox } = options;
  const before = toolbox.calls.length;
  const result = await generateText({
    ...MODEL_CALL,
    model: options.model,
    system: options.system,
    prompt: options.prompt,
    tools: await toolbox.modelTools(options.abortSignal),
    repairToolCall: toolbox.refuseUnknownTools,
    stopWhen: stepCountIs(options.maxSteps),
    abortSignal: options.abortSignal,
  });
  const last = result.steps.at(-1);
  return {
    text: result.text,
    steps: result.steps.length,
    stoppedAtLimit: result.steps.length >= options.maxSteps && (last?.toolCalls.length ?? 0) > 0,
    calls: toolbox.calls.slice(before),
    usage: {
      inputTokens: result.totalUsage.inputTokens ?? 0,
      outputTokens: result.totalUsage.outputTokens ?? 0,
      costUsd: result.steps.reduce((sum, s) => sum + gatewayCostUsd(s.response?.headers), 0),
    },
  };
}
