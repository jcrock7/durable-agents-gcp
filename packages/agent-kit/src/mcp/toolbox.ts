import { randomUUID } from "node:crypto";
import { ApplicationFailure } from "@temporalio/common";
import { jsonSchema, tool, type ToolCallRepairFunction, type ToolSet } from "ai";
import { FailureType } from "../failure-types.js";
import { AllowList, parseToolRef, type ToolPolicy } from "./allowlist.js";
import type { McpCallResult, McpConnection, McpToolInfo, ToolCallRecord, ToolCaller } from "./types.js";

export interface McpToolboxOptions {
  policy: ToolPolicy;
  /** Opens a session with one server. Called at most once per server, on first use. */
  connect: (server: string) => Promise<McpConnection>;
  /** Characters of a tool result passed back to the model. Longer results are cut. Default 20,000. */
  maxResultChars?: number;
  /** Called after every call, refused ones included. Use it to log or trace. */
  onCall?: (record: ToolCallRecord) => void;
  /**
   * Called with the result of every call that ran. Records keep only result sizes; an activity
   * that needs the content (for example to cite it as evidence) collects it here.
   */
  onResult?: (record: ToolCallRecord, result: McpCallResult) => void;
  /**
   * Results from an earlier attempt of this activity, keyed by `replayKey(ref, args)`. A model
   * tool call that hits the cache is answered from it without reaching the server, and recorded
   * with `replayed: true`. `onResult` is not called for it.
   */
  replay?: Map<string, string>;
}

/** A tool the agent may use, as listed by its server. */
export interface AllowedTool extends McpToolInfo {
  ref: string;
  server: string;
}

/**
 * The agent's view of its MCP servers: only allow-listed tools are listed, unlisted calls are
 * refused, write tools are kept from the model, and every call is recorded (ADR-0020).
 *
 * Create one per activity run, and `close()` it when the activity ends.
 */
export class McpToolbox {
  /** Every call made through this toolbox, in order. */
  readonly calls: ToolCallRecord[] = [];

  private readonly allow: AllowList;
  private readonly connections = new Map<string, Promise<McpConnection>>();
  private readonly maxResultChars: number;

  constructor(private readonly options: McpToolboxOptions) {
    this.allow = new AllowList(options.policy);
    this.maxResultChars = options.maxResultChars ?? 20_000;
  }

  /** Allow-listed tools on every server the agent uses. With `forModel`, write tools are left out. */
  async listTools(options: { forModel?: boolean } = {}): Promise<AllowedTool[]> {
    const tools: AllowedTool[] = [];
    for (const server of this.allow.servers()) {
      const listed = await (await this.connection(server)).listTools();
      for (const info of listed) {
        const visible = options.forModel ? this.allow.isModelVisible(server, info.name) : this.allow.isAllowed(server, info.name);
        if (visible) tools.push({ ...info, server, ref: `${server}:${info.name}` });
      }
    }
    return tools;
  }

  /**
   * Call one tool. Refuses (non-retryable `ToolNotAllowed`) anything outside the allow-list, and
   * write tools when the caller is the model. A tool that reports an error returns normally with
   * `isError`; a transport failure throws and is retried by the activity's policy.
   */
  async call(ref: string, args: Record<string, unknown>, caller: ToolCaller, signal?: AbortSignal, id: string = randomUUID()): Promise<McpCallResult> {
    const { server, tool: name } = parseToolRef(ref);
    const startedAt = Date.now();
    const base = { id, ref, server, tool: name, caller, args, at: new Date(startedAt).toISOString() };

    const permitted = caller === "model" ? this.allow.isModelVisible(server, name) : this.allow.isAllowed(server, name);
    if (!permitted) {
      this.record({ ...base, outcome: "refused", durationMs: 0 });
      throw ApplicationFailure.nonRetryable(
        caller === "model" && this.allow.isAllowed(server, name)
          ? `${ref} is a workflow-only tool; the model may not call it`
          : `${ref} is not on this agent's tool allow-list`,
        FailureType.ToolNotAllowed,
        { ref, caller },
      );
    }

    try {
      const result = await (await this.connection(server)).callTool(name, args, signal);
      const record: ToolCallRecord = {
        ...base,
        outcome: result.isError ? "error" : "ok",
        resultChars: resultText(result, Number.MAX_SAFE_INTEGER).length,
        durationMs: Date.now() - startedAt,
        ...(result.isError ? { error: resultText(result, 500) } : {}),
      };
      this.record(record);
      this.options.onResult?.(record, result);
      return result;
    } catch (error) {
      this.record({ ...base, outcome: "error", error: String(error instanceof Error ? error.message : error), durationMs: Date.now() - startedAt });
      throw error;
    }
  }

  /**
   * The model-visible tools as AI SDK tools, for a model-driven loop. Each execution goes through
   * `call(…, "model")`, so it is allow-listed and recorded. Tool names become `server__tool`,
   * because model APIs don't accept ":" in names.
   */
  async modelTools(signal?: AbortSignal): Promise<ToolSet> {
    const tools: ToolSet = {};
    for (const info of await this.listTools({ forModel: true })) {
      tools[modelToolName(info.server, info.name)] = tool({
        description: info.description ?? info.ref,
        inputSchema: jsonSchema(info.inputSchema as Parameters<typeof jsonSchema>[0]),
        execute: async (input: unknown, { toolCallId }: { toolCallId: string }) => {
          const args = (input ?? {}) as Record<string, unknown>;
          const cached = this.options.replay?.get(replayKey(info.ref, args));
          if (cached !== undefined) {
            this.record({ id: toolCallId, ref: info.ref, server: info.server, tool: info.name, caller: "model", args, outcome: "ok", resultChars: cached.length, durationMs: 0, at: new Date().toISOString(), replayed: true });
            return cached;
          }
          const result = await this.call(info.ref, args, "model", signal, toolCallId);
          const text = resultText(result, this.maxResultChars);
          return result.isError ? `ERROR: ${text}` : text;
        },
      });
    }
    return tools;
  }

  /**
   * For `generateText({ repairToolCall })`: when the model asks for a tool it was not given, record
   * the refusal and don't repair the call. The model gets an error result and can carry on.
   */
  readonly refuseUnknownTools: ToolCallRepairFunction<ToolSet> = async ({ toolCall, tools }) => {
    if (!(toolCall.toolName in tools)) {
      const ref = fromModelToolName(toolCall.toolName);
      const parsed = safeParseRef(ref);
      this.record({
        id: toolCall.toolCallId,
        ref,
        server: parsed?.server ?? "unknown",
        tool: parsed?.tool ?? toolCall.toolName,
        caller: "model",
        args: safeJson(toolCall.input),
        outcome: "refused",
        durationMs: 0,
        at: new Date().toISOString(),
      });
    }
    return null;
  };

  async close(): Promise<void> {
    const open = [...this.connections.values()];
    this.connections.clear();
    await Promise.allSettled(open.map(async (pending) => (await pending).close()));
  }

  private connection(server: string): Promise<McpConnection> {
    let pending = this.connections.get(server);
    if (!pending) {
      pending = this.options.connect(server);
      pending.catch(() => this.connections.delete(server));
      this.connections.set(server, pending);
    }
    return pending;
  }

  private record(record: ToolCallRecord): void {
    this.calls.push(record);
    this.options.onCall?.(record);
  }
}

/** The text parts of a tool result, joined and cut to `maxChars`. Structured content is used if there is no text. */
export function resultText(result: McpCallResult, maxChars = 20_000): string {
  const text = result.content
    .map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
  const full = text || (result.structuredContent === undefined ? "" : JSON.stringify(result.structuredContent));
  return full.length > maxChars ? `${full.slice(0, maxChars)}\n[cut at ${maxChars} characters]` : full;
}

/** The replay-cache key for a call: the tool ref and its arguments, with object keys sorted. */
export function replayKey(ref: string, args: Record<string, unknown>): string {
  const sorted = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sorted)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])]))
        : v;
  return `${ref}|${JSON.stringify(sorted(args))}`;
}

export function modelToolName(server: string, toolName: string): string {
  return `${server}__${toolName}`.replace(/[^A-Za-z0-9_-]/g, "_");
}

function fromModelToolName(name: string): string {
  const at = name.indexOf("__");
  return at > 0 ? `${name.slice(0, at)}:${name.slice(at + 2)}` : name;
}

function safeParseRef(ref: string) {
  try {
    return parseToolRef(ref);
  } catch {
    return undefined;
  }
}

function safeJson(input: string): Record<string, unknown> {
  try {
    const value = JSON.parse(input) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : { value };
  } catch {
    return { raw: input };
  }
}
