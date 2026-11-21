// Heartbeat details for the agent's activities (Live Run view, docs/superpowers/specs/2026-11-20-live-run-view-design.md).
// The portal reads them from the pending activity to show tool calls while a step runs; a retried
// gatherEvidence resumes from them so tool calls it already made are not made again.
import { replayKey, type ToolCallRecord } from "@agents/agent-kit";
import { z } from "zod";

export const ProgressSchema = z.object({
  v: z.literal(1),
  note: z.string().optional(),
  /** Tool calls completed so far in this attempt, in order. */
  calls: z.array(z.custom<ToolCallRecord>((c) => typeof c === "object" && c !== null && typeof (c as ToolCallRecord).ref === "string")),
  /** Result text of model tool calls, for resuming (gatherEvidence only). */
  results: z.array(z.object({ key: z.string(), text: z.string() })),
});
export type Progress = z.infer<typeof ProgressSchema>;

/** Heartbeat details stay well under Temporal's payload limit. */
export const PROGRESS_MAX_BYTES = 256 * 1024;

export const emptyProgress = (note?: string): Progress => ({ v: 1, ...(note ? { note } : {}), calls: [], results: [] });

const size = (p: Progress) => Buffer.byteLength(JSON.stringify(p));

/** Add a completed call. Its result text is kept only while the details stay under PROGRESS_MAX_BYTES. */
export function addCall(p: Progress, record: ToolCallRecord, resultText?: string): Progress {
  const next: Progress = { ...p, calls: [...p.calls, record] };
  if (resultText === undefined) return next;
  const withResult: Progress = { ...next, results: [...next.results, { key: replayKey(record.ref, record.args), text: resultText }] };
  return size(withResult) <= PROGRESS_MAX_BYTES ? withResult : next;
}

/** What a retry resumes from. Details that don't parse (another code version, or none) give a fresh start. */
export function resumeFrom(details: unknown): { replay: Map<string, string>; calls: ToolCallRecord[] } {
  const parsed = ProgressSchema.safeParse(details);
  if (!parsed.success) return { replay: new Map(), calls: [] };
  return { replay: new Map(parsed.data.results.map((r) => [r.key, r.text])), calls: parsed.data.calls };
}
