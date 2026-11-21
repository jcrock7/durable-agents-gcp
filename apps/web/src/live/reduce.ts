// Turns one /live response into what the Live Run view draws: node states and badges, the agent
// feed, and header figures. Pure, so live polling and replay share it (and tests drive it).
import type { EngineEvent, LiveResponse, LiveToolCall, PendingActivity } from "../api.js";
import { allNodes, nodeForActivity, nodeForTimeline, toolPhrase, type LiveGraph } from "./graphs.js";

export type NodeStatus = "pending" | "now" | "done" | "error" | "skipped";

export interface NodeView {
  status: NodeStatus;
  /** Time spent in the node's activities (running ones count up to now). */
  ms?: number;
  costUsd?: number;
  model?: string;
  tools: number;
  retries: number;
  failovers: number;
  /** Engine events that belong to this node, for the drawer. */
  eventIds: number[];
}

export interface FeedItem {
  key: string;
  at: string;
  /** Graph node id, or "" for case-level entries (Finished, Re-check). */
  node: string;
  /** The step tag shown beside the line. */
  step: string;
  say: string;
  how?: string;
  evidence?: string;
  /** Seen in a heartbeat; the activity hasn't completed yet. */
  pending?: true;
}

export interface LiveView {
  nodes: Record<string, NodeView>;
  feed: FeedItem[];
  events: EngineEvent[];
  status: string;
  running: boolean;
  elapsedMs: number;
  costUsd: number;
  toolCalls: number;
  canKill: boolean;
  /** Recorded before the workflow wrote narration: the feed shows step details instead. */
  legacy: boolean;
  header: { ref?: string; vendor?: string; total?: string; kind?: string; worker?: string };
  pending: Array<PendingActivity & { node: string }>;
  startTime: string;
}

/** Activities that heartbeat (MODEL_ACTIVITIES in apps/api/src/demo.ts). */
export const MODEL_ACTIVITIES = ["readInvoice", "gatherEvidence", "proposeResolution", "draftMessage"];

const ENDS = new Set(["ActivityTaskCompleted", "ActivityTaskFailed", "ActivityTaskTimedOut", "ActivityTaskCanceled"]);

interface Window {
  node: string;
  activity: string;
  start: number;
  end?: number;
}

function windowsOf(g: LiveGraph, events: EngineEvent[]): Window[] {
  const out: Window[] = [];
  for (const e of events) {
    const node = nodeForActivity(g, e.activityType);
    if (!node) continue;
    if (e.type === "ActivityTaskScheduled") out.push({ node: node.id, activity: e.activityType!, start: Date.parse(e.at) });
    else if (ENDS.has(e.type)) {
      const open = [...out].reverse().find((w) => w.activity === e.activityType && w.end === undefined);
      if (open) open.end = Date.parse(e.at);
    }
  }
  return out;
}

function heartbeatCalls(heartbeat: unknown): LiveToolCall[] {
  const calls = (heartbeat as { calls?: unknown } | undefined)?.calls;
  return Array.isArray(calls) ? (calls as LiveToolCall[]).filter((c) => c && typeof c.ref === "string") : [];
}

const sameArgs = (a: unknown, b: unknown) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

export function reduceLive(g: LiveGraph, res: LiveResponse, now: number): LiveView {
  const running = res.status === "RUNNING";
  const state = res.state;
  const timeline = state?.timeline ?? [];
  const usage = state?.usage ?? [];
  const windows = windowsOf(g, res.events);
  const pendingNodes = new Set(res.pending.map((p) => nodeForActivity(g, p.activityType)?.id).filter(Boolean) as string[]);

  const nodes: Record<string, NodeView> = {};
  for (const n of allNodes(g)) {
    const entries = timeline.filter((e) => nodeForTimeline(g, e.name)?.id === n.id);
    const mine = windows.filter((w) => w.node === n.id);
    const completed = mine.some((w) => w.end !== undefined);
    const open = running && mine.some((w) => w.end === undefined);
    let status: NodeStatus = "pending";
    if (entries.length || completed) status = "done";
    if (entries.some((e) => e.state === "error")) status = "error";
    if (entries.at(-1)?.state === "now" || pendingNodes.has(n.id) || open) status = running ? "now" : "done";
    if (!running && status === "pending") status = "skipped";
    const spent = usage.filter((u) => n.usage?.includes(u.step));
    const nodeEvents = res.events.filter((e) => nodeForActivity(g, e.activityType)?.id === n.id);
    const ms = mine.length ? mine.reduce((sum, w) => sum + ((w.end ?? (running ? now : w.start)) - w.start), 0) : undefined;
    nodes[n.id] = {
      status,
      ...(ms !== undefined ? { ms } : {}),
      ...(spent.length ? { costUsd: spent.reduce((s, u) => s + (u.costUsd ?? 0), 0), model: spent.at(-1)!.model } : {}),
      tools: 0,
      retries: nodeEvents.filter((e) => e.kind === "retry").length + res.pending.filter((p) => p.kind === "retry" && nodeForActivity(g, p.activityType)?.id === n.id).length,
      failovers: nodeEvents.filter((e) => e.kind === "failover").length + res.pending.filter((p) => p.kind === "failover" && nodeForActivity(g, p.activityType)?.id === n.id).length,
      eventIds: nodeEvents.map((e) => e.id),
    };
  }

  // Tool calls: completed ones from the query, in-flight ones from heartbeat details, once each.
  const done = state?.toolCalls ?? [];
  const seen = new Set(done.map((c) => c.id));
  const inflight: Array<{ call: LiveToolCall; node: string }> = [];
  for (const p of res.pending) {
    const node = nodeForActivity(g, p.activityType)?.id ?? "";
    for (const c of heartbeatCalls(p.heartbeat)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      inflight.push({ call: c, node });
    }
  }
  const nodeAt = (iso: string) => {
    const t = Date.parse(iso);
    return [...windows].reverse().find((w) => t >= w.start && (w.end === undefined || t <= w.end))?.node ?? "";
  };
  const allCalls = [...done.map((call) => ({ call, node: nodeAt(call.at), pending: false })), ...inflight.map((x) => ({ ...x, pending: true }))];
  for (const { node } of allCalls) if (nodes[node]) nodes[node]!.tools += 1;

  const label = (id: string, fallback: string) => allNodes(g).find((n) => n.id === id)?.label ?? fallback;
  const usageSeen = new Map<string, number>();
  const feed: FeedItem[] = [];
  timeline.forEach((e, i) => {
    const node = nodeForTimeline(g, e.name);
    let how = e.narration ? e.detail : undefined;
    if (node?.usage) {
      const k = usageSeen.get(node.id) ?? 0;
      const u = usage.filter((x) => node.usage!.includes(x.step))[k];
      if (u) {
        usageSeen.set(node.id, k + 1);
        how = [how, `${u.model} · ${u.inputTokens.toLocaleString()} → ${u.outputTokens.toLocaleString()} tokens${u.costUsd ? ` · $${u.costUsd.toFixed(3)}` : ""}`].filter(Boolean).join(" · ");
      }
    }
    feed.push({ key: `t${i}`, at: e.at, node: node?.id ?? "", step: node?.label ?? e.name.replace(/:.*/, ""), say: e.narration ?? e.detail ?? e.name, ...(how ? { how } : {}) });
  });
  for (const { call, node, pending } of allCalls) {
    if (call.caller !== "model") continue;
    const evidence = state?.evidence?.find((x) => x.source === call.ref && sameArgs(x.args, call.args))?.excerpt;
    const how = [`${call.ref} ${call.durationMs}ms`, call.replayed ? "replayed after failover" : "", call.outcome !== "ok" ? call.outcome : ""].filter(Boolean).join(" · ");
    feed.push({ key: `c${call.id}`, at: call.at, node, step: label(node, "Tool"), say: toolPhrase(call.ref, call.args), how, ...(evidence ? { evidence } : {}), ...(pending ? { pending: true as const } : {}) });
  }
  feed.sort((a, b) => a.at.localeCompare(b.at));

  const end = res.closeTime ? Date.parse(res.closeTime) : now;
  return {
    nodes,
    feed,
    events: res.events,
    status: res.status,
    running,
    elapsedMs: Math.max(0, end - Date.parse(res.startTime)),
    costUsd: usage.reduce((s, u) => s + (u.costUsd ?? 0), 0),
    toolCalls: done.length + inflight.length,
    canKill: running && res.pending.some((p) => MODEL_ACTIVITIES.includes(p.activityType) && p.state === "STARTED"),
    legacy: timeline.length > 0 && !timeline.some((e) => e.narration),
    header: {
      ref: state?.invoiceId,
      vendor: state?.facts?.vendorName,
      total: state?.invoice?.totalDue,
      kind: state?.match?.exceptionTypes?.[0]?.replace(/_/g, " "),
      worker: res.workerIdentity?.split("@").pop(),
    },
    pending: res.pending.map((p) => ({ ...p, node: nodeForActivity(g, p.activityType)?.id ?? "" })),
    startTime: res.startTime,
  };
}

/**
 * One live poll merged into the last: engine events are appended after the cursor, and a poll whose
 * query failed (state null, as while a killed worker's cases move) keeps the last known state.
 */
export function mergeLive(prev: LiveResponse | undefined, next: LiveResponse): LiveResponse {
  return { ...next, events: [...(prev?.events ?? []), ...next.events], state: next.state ?? prev?.state ?? null };
}

export interface ReplayFrame {
  /** Playback time (ms from the start), with long waits compressed. */
  at: number;
  /** Real time of this frame (epoch ms), for elapsed figures. */
  real: number;
  res: LiveResponse;
  /** Set when the gap before this frame was compressed. */
  waited?: { realMs: number; what: string };
}

/** Gaps longer than this play as WAIT_BEAT. */
export const LONG_WAIT_MS = 10_000;
export const WAIT_BEAT_MS = 2_000;

function waitingFor(name: string | undefined): string {
  if (!name) return "the next step";
  if (name === "Waiting for approval") return "review";
  if (name === "Waiting for receipt" || name.startsWith("Reminder")) return "a goods receipt";
  return "the next step";
}

/** A finished run as successive frames, each the response as it would have looked at that moment. */
export function replayFrames(res: LiveResponse): ReplayFrame[] {
  const start = Date.parse(res.startTime);
  const end = res.closeTime ? Date.parse(res.closeTime) : undefined;
  const timeline = res.state?.timeline ?? [];
  const calls = res.state?.toolCalls ?? [];
  const times = new Set<number>([start]);
  for (const e of timeline) times.add(Date.parse(e.at));
  for (const e of res.events) times.add(Date.parse(e.at));
  for (const c of calls) times.add(Date.parse(c.at));
  if (end !== undefined) times.add(end);
  const sorted = [...times].filter((t) => !Number.isNaN(t) && t >= start).sort((a, b) => a - b);
  const last = sorted.at(-1)!;

  const frames: ReplayFrame[] = [];
  let playback = 0;
  sorted.forEach((t, i) => {
    let waited: ReplayFrame["waited"];
    if (i > 0) {
      const gap = t - sorted[i - 1]!;
      if (gap > LONG_WAIT_MS) {
        playback += WAIT_BEAT_MS;
        waited = { realMs: gap, what: waitingFor(timeline.filter((e) => Date.parse(e.at) <= sorted[i - 1]!).at(-1)?.name) };
      } else playback += gap;
    }
    const upTo = <T extends { at: string }>(xs: T[]) => xs.filter((x) => Date.parse(x.at) <= t);
    const shownTimeline = upTo(timeline);
    const reached = new Set(shownTimeline.map((e) => e.name));
    const final = t === last;
    frames.push({
      at: playback,
      real: t,
      ...(waited ? { waited } : {}),
      res: {
        ...res,
        status: final ? res.status : "RUNNING",
        closeTime: final ? res.closeTime : undefined,
        events: upTo(res.events),
        pending: [],
        state: res.state
          ? {
              ...res.state,
              timeline: shownTimeline.map((e, k) => (k === shownTimeline.length - 1 && !final ? e : { ...e, state: e.state === "now" ? "done" : e.state })),
              toolCalls: upTo(calls),
              // Usage has no timestamp: show it once its step's timeline entry has appeared.
              usage: (res.state.usage ?? []).filter((u) => reached.size > 0 && usageReached(u.step, reached)),
            }
          : null,
      },
    });
  });
  return frames;
}

const USAGE_STEP: Record<string, string[]> = {
  "read invoice": ["Read invoice PDF"],
  "gather evidence": ["Gather evidence"],
  propose: ["Propose resolution"],
  "revise proposal": ["Revise proposal"],
  "draft message": ["Message queued"],
};
const usageReached = (step: string, reached: Set<string>) => (USAGE_STEP[step] ?? []).some((name) => reached.has(name));
