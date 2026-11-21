/** A tool as an MCP server lists it (`tools/list`). */
export interface McpToolInfo {
  name: string;
  description?: string;
  /** JSON Schema of the tool's arguments. */
  inputSchema: Record<string, unknown>;
}

/** The result of `tools/call`, as the MCP SDK returns it. */
export interface McpCallResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
}

/** One open session with one MCP server. The HTTP implementation is in http.ts; tests use in-memory ones. */
export interface McpConnection {
  listTools(): Promise<McpToolInfo[]>;
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult>;
  close(): Promise<void>;
}

/** Who asked for the call: workflow code (through an activity), activity code, or the model inside a tool loop. */
export type ToolCaller = "workflow" | "activity" | "model";

/**
 * One tool call, kept for the run's audit trail and the portal's inspector. Arguments are kept;
 * results are kept only as a size, because they can be large and may hold data the run must not copy.
 */
export interface ToolCallRecord {
  /** Unique per call: the model's tool-call id for model calls, else a random UUID. */
  id: string;
  /** `server:tool`. */
  ref: string;
  server: string;
  tool: string;
  caller: ToolCaller;
  args: Record<string, unknown>;
  /** "ok", "error" (the tool reported an error or the call failed) or "refused" (not on the allow-list). */
  outcome: "ok" | "error" | "refused";
  /** Characters of text returned, when the call ran. */
  resultChars?: number;
  error?: string;
  durationMs: number;
  /** ISO timestamp of the call's start. */
  at: string;
  /** Answered from the replay cache (a retried activity resuming), not by the server. */
  replayed?: true;
}
