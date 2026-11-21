import { describe, expect, it } from "vitest";
import type { EngineEvent, LiveResponse, PendingActivity } from "../src/api.js";
import { LIVE_GRAPHS, toolPhrase } from "../src/live/graphs.js";
import { mergeLive, reduceLive, replayFrames } from "../src/live/reduce.js";

const G = LIVE_GRAPHS["invoice-exception-resolver"]!;
const T0 = Date.parse("2026-11-20T12:00:00Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const ev = (id: number, s: number, type: string, activityType?: string, extra: Partial<EngineEvent> = {}): EngineEvent => ({ id, at: at(s), type, attrs: {}, ...(activityType ? { activityType } : {}), ...extra });
const call = (id: string, s: number, ref = "erp-read:get_purchase_order", args: Record<string, unknown> = { po_id: "PO-88213" }) => ({
  id,
  ref,
  server: ref.split(":")[0]!,
  tool: ref.split(":")[1]!,
  caller: "model" as const,
  args,
  outcome: "ok" as const,
  durationMs: 142,
  at: at(s),
});

/** Mid-run: match and read done, gather evidence pending (attempt 2 after a lost worker), one call done before the kill. */
function running(p: Partial<PendingActivity> = {}): LiveResponse {
  return {
    status: "RUNNING",
    runId: "r1",
    startTime: at(0),
    cursor: 9,
    state: {
      stage: "gathering_evidence",
      timeline: [
        { name: "Match", at: at(1), detail: "exception: PRICE_VARIANCE", state: "done", narration: "The three-way match flagged PRICE_VARIANCE." },
        { name: "Read invoice PDF", at: at(6), detail: "INV-20931 · $18,240.00", state: "done", narration: "Read the invoice." },
      ],
      toolCalls: [{ ...call("w1", 0.5, "match-engine:run_match", {}), caller: "workflow" }],
      usage: [{ step: "read invoice", model: "fast", inputTokens: 1200, outputTokens: 310, costUsd: 0.004 }],
      evidence: [],
    },
    events: [
      ev(5, 0, "ActivityTaskScheduled", "runMatch"),
      ev(6, 0.4, "ActivityTaskStarted", "runMatch"),
      ev(7, 1, "ActivityTaskCompleted", "runMatch"),
      ev(8, 1, "ActivityTaskScheduled", "readInvoice"),
      ev(9, 6, "ActivityTaskCompleted", "readInvoice"),
      ev(10, 6, "ActivityTaskScheduled", "gatherEvidence"),
    ],
    pending: [
      {
        activityId: "3",
        activityType: "gatherEvidence",
        attempt: 2,
        state: "STARTED",
        lastWorkerIdentity: "1@worker-a21c",
        lastFailure: { message: "heartbeat timeout", timeoutType: "HEARTBEAT" },
        kind: "failover",
        heartbeat: { v: 1, calls: [call("t1", 9), call("t2", 11, "erp-read:get_vendor", { vendor_id: "V-1032" })], results: [] },
        ...p,
      },
    ],
  };
}

describe("reduceLive", () => {
  it("marks completed nodes done and the pending activity's node now", () => {
    const v = reduceLive(G, running(), T0 + 41_000);
    expect(v.nodes.match!.status).toBe("done");
    expect(v.nodes.read!.status).toBe("done");
    expect(v.nodes.evidence!.status).toBe("now");
    expect(v.nodes.propose!.status).toBe("pending");
    expect(v.nodes.read).toMatchObject({ costUsd: 0.004, model: "fast" });
    expect(v.elapsedMs).toBe(41_000);
    expect(v.costUsd).toBeCloseTo(0.004);
  });

  it("counts retry and failover badges from pending kind and events", () => {
    const v = reduceLive(G, running(), T0);
    expect(v.nodes.evidence).toMatchObject({ failovers: 1, retries: 0 });
    const done = running({ kind: "retry", lastFailure: { message: "TimeoutError" } });
    done.events.push(ev(12, 20, "ActivityTaskStarted", "readInvoice", { kind: "retry" }));
    const v2 = reduceLive(G, done, T0);
    expect(v2.nodes.evidence).toMatchObject({ failovers: 0, retries: 1 });
    expect(v2.nodes.read).toMatchObject({ retries: 1 });
    expect(v2.nodes.read!.eventIds).toEqual([8, 9, 12]);
  });

  it("pending heartbeat tool calls appear once and dedupe with completed calls", () => {
    const res = running();
    res.state!.toolCalls!.push(call("t1", 9));
    const v = reduceLive(G, res, T0);
    const items = v.feed.filter((f) => f.key.startsWith("c"));
    expect(items.map((f) => f.key)).toEqual(["ct1", "ct2"]);
    expect(items[0]).toMatchObject({ node: "evidence", say: "Looking up purchase order PO-88213" });
    expect(items[1]).toMatchObject({ pending: true });
    expect(v.nodes.evidence!.tools).toBe(2);
    expect(v.toolCalls).toBe(3);
  });

  it("legacy runs without narration use detail and set legacy", () => {
    const res = running();
    for (const e of res.state!.timeline!) delete e.narration;
    const v = reduceLive(G, res, T0);
    expect(v.legacy).toBe(true);
    expect(v.feed.find((f) => f.key === "t0")?.say).toBe("exception: PRICE_VARIANCE");
  });

  it("state null still yields node statuses from events", () => {
    const res = running();
    res.state = null;
    const v = reduceLive(G, res, T0);
    expect(v.nodes.match!.status).toBe("done");
    expect(v.nodes.evidence!.status).toBe("now");
    expect(v.feed.filter((f) => f.key.startsWith("t"))).toEqual([]);
  });

  it("canKill is true only while a model activity is pending", () => {
    expect(reduceLive(G, running(), T0).canKill).toBe(true);
    expect(reduceLive(G, running({ activityType: "postResolution" }), T0).canKill).toBe(false);
    expect(reduceLive(G, { ...running(), status: "COMPLETED" }, T0).canKill).toBe(false);
  });

  it("marks the not-taken branch skipped once the run is closed", () => {
    const v = reduceLive(G, { ...running(), status: "COMPLETED", pending: [], closeTime: at(60) }, T0);
    expect(v.nodes.hold!.status).toBe("skipped");
    expect(v.elapsedMs).toBe(60_000);
  });
});

describe("toolPhrase", () => {
  it("phrases known tools and falls back to the ref", () => {
    expect(toolPhrase("erp-read:get_vendor", { vendor_id: "V-1032" })).toBe("Looking up vendor V-1032");
    expect(toolPhrase("x:unknown_tool", {})).toBe("Calling x:unknown_tool");
  });
});

describe("replayFrames", () => {
  it("replayFrames compresses a 3h review wait to 2s", () => {
    const res: LiveResponse = {
      ...running(),
      status: "COMPLETED",
      closeTime: at(3 * 3600 + 20),
      pending: [],
      state: {
        ...running().state!,
        timeline: [
          ...running().state!.timeline!,
          { name: "Waiting for approval", at: at(10), detail: "", state: "done", narration: "Waiting." },
          { name: "Approved", at: at(3 * 3600 + 10), detail: "ap.lead", state: "done", narration: "Approved." },
        ],
      },
    };
    const frames = replayFrames(res);
    const approved = frames.findIndex((f) => f.res.state?.timeline?.some((e) => e.name === "Approved"));
    expect(frames[approved]!.at - frames[approved - 1]!.at).toBe(2_000);
    expect(frames[approved]!.waited).toMatchObject({ realMs: 3 * 3600_000, what: "review" });
    expect(frames.at(-1)!.res.status).toBe("COMPLETED");
    expect(frames[0]!.res.status).toBe("RUNNING");
    for (let i = 1; i < frames.length; i++) expect(frames[i]!.at).toBeGreaterThanOrEqual(frames[i - 1]!.at);
  });
});

describe("mergeLive", () => {
  it("keeps the last known state when a poll's query fails, and appends events", () => {
    const first = running();
    const next: LiveResponse = { ...running(), state: null, events: [ev(11, 30, "ActivityTaskStarted", "gatherEvidence")], cursor: 11 };
    const merged = mergeLive(first, next);
    expect(merged.state).toBe(first.state);
    expect(merged.events.map((e) => e.id)).toEqual([5, 6, 7, 8, 9, 10, 11]);
    expect(merged.cursor).toBe(11);
    const fresh = mergeLive(merged, { ...running(), events: [], state: { stage: "proposing" } });
    expect(fresh.state).toEqual({ stage: "proposing" });
  });
});

describe("canKill after a kill", () => {
  it("is false while the model activity is only scheduled (waiting for a retry)", () => {
    expect(reduceLive(G, running({ state: "SCHEDULED" }), T0).canKill).toBe(false);
  });
});

describe("header worker", () => {
  it("shows the pod name from the worker's <hostname>/<agent> identity", () => {
    const res = { ...running(), workerIdentity: "worker-fd9fcc98f-2h8ls/invoice-exception-resolver" };
    expect(reduceLive(G, res, T0).header.worker).toBe("worker-fd9fcc98f-2h8ls");
  });
});
