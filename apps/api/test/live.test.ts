import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../dist/app.js";
import { classifyFailover, condenseHistory } from "../dist/live.js";
import type { KubernetesSource, LiteLLMSource, PendingActivity, RawHistoryEvent, RunDescription, TemporalSource } from "../dist/sources.js";

const at = (s: number) => new Date(Date.UTC(2026, 10, 20, 12, 0, s)).toISOString();
const dur = (s: number) => ({ seconds: s, nanos: 0 });

/** A small history: start, two activities (the second retried after a heartbeat timeout), a timer. */
const HISTORY: RawHistoryEvent[] = [
  { id: 1, at: at(0), type: "WorkflowExecutionStarted", attrs: {} },
  { id: 2, at: at(0), type: "WorkflowTaskScheduled", attrs: {} },
  { id: 3, at: at(0), type: "WorkflowTaskStarted", attrs: { identity: "1@worker-7d9f" } },
  { id: 4, at: at(0), type: "WorkflowTaskCompleted", attrs: { identity: "1@worker-7d9f" } },
  { id: 5, at: at(0), type: "ActivityTaskScheduled", attrs: { activityType: { name: "runMatch" }, startToCloseTimeout: dur(30), retryPolicy: { maximumAttempts: 5 } } },
  { id: 6, at: at(1), type: "ActivityTaskStarted", attrs: { scheduledEventId: 5, attempt: 1, identity: "1@worker-7d9f" } },
  { id: 7, at: at(1), type: "ActivityTaskCompleted", attrs: { scheduledEventId: 5, startedEventId: 6, identity: "1@worker-7d9f" } },
  { id: 8, at: at(1), type: "WorkflowTaskScheduled", attrs: {} },
  { id: 9, at: at(2), type: "WorkflowTaskStarted", attrs: { identity: "1@worker-7d9f" } },
  { id: 10, at: at(2), type: "WorkflowTaskCompleted", attrs: {} },
  { id: 11, at: at(2), type: "ActivityTaskScheduled", attrs: { activityType: { name: "gatherEvidence" }, startToCloseTimeout: dur(180), heartbeatTimeout: dur(20) } },
  {
    id: 12,
    at: at(40),
    type: "ActivityTaskStarted",
    attrs: { scheduledEventId: 11, attempt: 2, identity: "1@worker-a21c", lastFailure: { message: "activity Heartbeat timeout", timeoutFailureInfo: { timeoutType: 4 } } },
  },
  { id: 13, at: at(55), type: "ActivityTaskCompleted", attrs: { scheduledEventId: 11, startedEventId: 12, identity: "1@worker-a21c" } },
  { id: 14, at: at(56), type: "TimerStarted", attrs: { timerId: "1", startToFireTimeout: dur(86_400) } },
  { id: 15, at: at(57), type: "WorkflowTaskStarted", attrs: { identity: "1@worker-a21c" } },
];

const pending = (p: Partial<PendingActivity>): PendingActivity => ({ activityId: "6", activityType: "gatherEvidence", attempt: 1, state: "STARTED", ...p });

describe("condenseHistory", () => {
  it("condenseHistory maps activity events to their activity type and filters by after", () => {
    const all = condenseHistory(HISTORY, 0);
    expect(all.find((e) => e.id === 7)).toMatchObject({ type: "ActivityTaskCompleted", activityType: "runMatch" });
    expect(all.find((e) => e.id === 5)?.attrs).toMatchObject({ activityType: "runMatch", startToCloseTimeout: "30s", retryMaxAttempts: 5 });
    expect(all.find((e) => e.id === 12)).toMatchObject({ activityType: "gatherEvidence", kind: "failover", attrs: { attempt: 2, identity: "1@worker-a21c", timeoutType: "HEARTBEAT" } });
    expect(all.find((e) => e.id === 14)).toMatchObject({ kind: "timer", attrs: { startToFireTimeout: "86400s" } });
    const later = condenseHistory(HISTORY, 11);
    expect(later.map((e) => e.id)).toEqual([12, 13, 14, 15]);
    expect(later[1]!.activityType).toBe("gatherEvidence"); // resolved through an event before `after`
  });
});

describe("classifyFailover", () => {
  it("classifyFailover: heartbeat timeout → failover; plain error → retry", () => {
    expect(classifyFailover(pending({ attempt: 2, lastFailure: { message: "x", timeoutType: "HEARTBEAT" } }))).toBe("failover");
    expect(classifyFailover(pending({ attempt: 2, lastFailure: { message: "TimeoutError 5000ms" } }))).toBe("retry");
    expect(classifyFailover(pending({ attempt: 1 }))).toBeUndefined();
  });
});

const RUN: RunDescription = {
  runId: "run-1",
  status: "RUNNING",
  startTime: at(0),
  pending: [pending({ attempt: 2, lastFailure: { message: "hb", timeoutType: "HEARTBEAT" }, lastWorkerIdentity: "1@worker-a21c", heartbeat: { v: 1, calls: [], results: [] } })],
};
const temporal: TemporalSource = {
  listRuns: vi.fn(async () => []),
  count: vi.fn(async () => 0),
  query: vi.fn(async () => ({ stage: "gathering_evidence", timeline: [] })),
  update: vi.fn(),
  signal: vi.fn(),
  start: vi.fn(),
  healthy: vi.fn(async () => true),
  describe: vi.fn(async (id: string) => (id === "inv-404" ? undefined : RUN)),
  history: vi.fn(async () => HISTORY),
};
const litellm: LiteLLMSource = { keys: vi.fn(async () => []), healthy: vi.fn(async () => true) };
const kubernetes: KubernetesSource = { deployments: vi.fn(async () => []), postgresReady: vi.fn(async () => true) };
const app = buildApp({ temporal, litellm, kubernetes });
beforeAll(async () => app.ready());
afterAll(async () => app.close());

describe("GET /api/cases/:id/live", () => {
  it("returns query state, condensed events after the cursor, and classified pending activities", async () => {
    const res = await app.inject("/api/cases/inv-20931/live?after=11");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ status: "RUNNING", runId: "run-1", cursor: 15, workerIdentity: "1@worker-a21c", state: { stage: "gathering_evidence" } });
    expect(body.events.map((e: { id: number }) => e.id)).toEqual([12, 13, 14, 15]);
    expect(body.pending[0]).toMatchObject({ activityType: "gatherEvidence", kind: "failover" });
  });

  it("live returns state null but events and pending when the query throws", async () => {
    vi.mocked(temporal.query).mockRejectedValueOnce(new Error("no worker"));
    const body = (await app.inject("/api/cases/inv-20931/live")).json();
    expect(body.state).toBeNull();
    expect(body.events).toHaveLength(15);
    expect(body.pending).toHaveLength(1);
  });

  it("live rejects queue and unknown workflow ids with 400", async () => {
    expect((await app.inject("/api/cases/exception-queue-123/live")).statusCode).toBe(400);
    expect((await app.inject("/api/cases/..%2Fx/live")).statusCode).toBe(400);
    expect((await app.inject("/api/cases/cve-1/live")).statusCode).toBe(400);
    expect((await app.inject("/api/cases/inv-404/live")).statusCode).toBe(404);
  });

  it("live bypasses the running-case cache", async () => {
    vi.mocked(temporal.query).mockClear();
    await app.inject("/api/cases/inv-20931/live");
    await app.inject("/api/cases/inv-20931/live");
    expect(temporal.query).toHaveBeenCalledTimes(2);
  });

  it("returns one raw event by id", async () => {
    const res = await app.inject("/api/cases/inv-20931/live?raw=12");
    expect(res.json()).toMatchObject({ id: 12, type: "ActivityTaskStarted", attrs: { attempt: 2 } });
  });
});
