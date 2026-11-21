// The Live Run view's data (docs/superpowers/specs/2026-11-20-live-run-view-design.md): the case's
// query state, its Temporal history condensed for the engine drawer, and its pending activities
// (attempts, last failure, heartbeat details), which is how retries and failover show while they happen.
import type { PendingActivity, RawHistoryEvent } from "./sources.js";

export type EngineKind = "retry" | "failover" | "timer" | "worker";

export interface EngineEvent {
  id: number;
  at: string;
  type: string;
  attrs: Record<string, string | number>;
  activityType?: string;
  kind?: EngineKind;
}

export interface LivePending extends PendingActivity {
  kind?: "retry" | "failover";
}

const TIMEOUT_TYPES: Record<number, string> = { 1: "START_TO_CLOSE", 2: "SCHEDULE_TO_START", 3: "SCHEDULE_TO_CLOSE", 4: "HEARTBEAT" };
/** A worker that dies mid-activity shows up as one of these timeouts on the next attempt. */
const LOST_WORKER = new Set(["HEARTBEAT", "START_TO_CLOSE"]);

export function timeoutTypeName(value: unknown): string | undefined {
  if (typeof value === "number") return TIMEOUT_TYPES[value];
  if (typeof value === "string") return value.replace(/^TIMEOUT_TYPE_/, "");
  return undefined;
}

const seconds = (d: unknown): string | undefined => {
  const s = (d as { seconds?: number } | undefined)?.seconds;
  return typeof s === "number" ? `${s}s` : undefined;
};

interface FailureLike {
  message?: string;
  timeoutFailureInfo?: { timeoutType?: unknown };
}

/** History events after `after`, with only what the drawer shows. */
export function condenseHistory(events: RawHistoryEvent[], after: number): EngineEvent[] {
  const scheduled = new Map<number, string>();
  for (const e of events) {
    if (e.type === "ActivityTaskScheduled") {
      const name = (e.attrs.activityType as { name?: string } | undefined)?.name;
      if (name) scheduled.set(e.id, name);
    }
  }
  return events
    .filter((e) => e.id > after)
    .map((e) => {
      const a = e.attrs;
      const attrs: Record<string, string | number> = {};
      const set = (k: string, v: unknown) => {
        if (typeof v === "string" || typeof v === "number") attrs[k] = v;
      };
      const activityType = e.type === "ActivityTaskScheduled" ? scheduled.get(e.id) : scheduled.get(Number(a.scheduledEventId));
      set("activityType", activityType);
      set("attempt", a.attempt);
      set("identity", a.identity);
      set("startToCloseTimeout", seconds(a.startToCloseTimeout));
      set("heartbeatTimeout", seconds(a.heartbeatTimeout));
      set("retryMaxAttempts", (a.retryPolicy as { maximumAttempts?: number } | undefined)?.maximumAttempts);
      set("startToFireTimeout", seconds(a.startToFireTimeout));
      const failure = (a.failure ?? a.lastFailure) as FailureLike | undefined;
      set("failure", failure?.message?.slice(0, 200));
      set("timeoutType", timeoutTypeName(a.timeoutType ?? failure?.timeoutFailureInfo?.timeoutType));

      let kind: EngineKind | undefined;
      if (e.type === "TimerStarted") kind = "timer";
      if (e.type === "ActivityTaskStarted" && Number(a.attempt) > 1) kind = LOST_WORKER.has(String(attrs.timeoutType)) ? "failover" : "retry";
      if (e.type === "ActivityTaskTimedOut") kind = LOST_WORKER.has(String(attrs.timeoutType)) ? "failover" : "retry";
      return { id: e.id, at: e.at, type: e.type, attrs, ...(activityType ? { activityType } : {}), ...(kind ? { kind } : {}) };
    });
}

/** Whether a pending activity is being retried, and whether the cause was a lost worker. */
export function classifyFailover(p: PendingActivity): "retry" | "failover" | undefined {
  if (p.lastFailure?.timeoutType && LOST_WORKER.has(p.lastFailure.timeoutType)) return "failover";
  if (p.attempt > 1) return "retry";
  return undefined;
}

/** The identity of the worker most recently seen doing work for this run. */
export function lastWorker(events: RawHistoryEvent[], pending: PendingActivity[]): string | undefined {
  const fromPending = pending.find((p) => p.lastWorkerIdentity)?.lastWorkerIdentity;
  if (fromPending) return fromPending;
  for (let i = events.length - 1; i >= 0; i--) {
    const id = events[i]!.attrs.identity;
    if (typeof id === "string" && id) return id;
  }
  return undefined;
}
