import { useCallback, useEffect, useRef, useState } from "react";

export interface Agent {
  id: string;
  name: string;
  purpose: string;
  pattern: string;
  blurb: string;
  avatar: string;
  built: boolean;
  tools: string[];
  models: string;
  evals?: { rate: string; source: string };
  status: "coming_soon" | "needs_review" | "active" | "idle";
  runs24h: number | null;
  needsPerson: number;
  running: number;
  spend: { spentUsd: number; budgetUsd: number | null; resetsAt: string | null } | null;
}

export interface CaseSummary {
  workflowId: string;
  agentId: string;
  ref: string;
  title: string;
  stage: string;
  status: string | null;
  temporalStatus: string;
  needsPerson: boolean;
  startedAt: string;
  closedAt?: string;
  costUsd: number;
  detail: string;
  /** Why the case stands where it does; absent when the detail already says it. */
  reason?: string;
  amountCents?: number;
  vendorName?: string;
}

/** Invoice facts from the API. "derived" marks runs from before the workflow recorded them. */
export interface CaseFacts {
  source: "erp" | "derived";
  vendorName?: string;
  dueDate?: string;
  lines: Array<{ lineNo: number; itemId?: string; description?: string; quantity?: number; uom?: string; unitPriceCents?: number }>;
}

export interface Skill {
  name: string;
  version: string;
  actions: Array<{ action: string; useWhen: string; effect: string }>;
}

export interface CasePage {
  total: number;
  offset: number;
  cases: CaseSummary[];
}

export interface Me {
  user: string;
  source?: "iap" | "local";
  /** Demo controls (sample case, kill worker) are on in this deployment. */
  demoControls?: boolean;
  temporalUiUrl?: string;
}

// Live Run view: GET /api/cases/:id/live (apps/api/src/live.ts).
export interface EngineEvent {
  id: number;
  at: string;
  type: string;
  attrs: Record<string, string | number>;
  activityType?: string;
  kind?: "retry" | "failover" | "timer" | "worker";
}

export interface LiveToolCall {
  id: string;
  ref: string;
  server: string;
  tool: string;
  caller: "workflow" | "activity" | "model";
  args: Record<string, unknown>;
  outcome: "ok" | "error" | "refused";
  durationMs: number;
  at: string;
  replayed?: true;
}

export interface PendingActivity {
  activityId: string;
  activityType: string;
  attempt: number;
  state: string;
  scheduledTime?: string;
  lastStartedTime?: string;
  lastWorkerIdentity?: string;
  lastFailure?: { message: string; timeoutType?: string };
  /** Heartbeat details: { v: 1, note?, calls: LiveToolCall[], results } from the agent's activities. */
  heartbeat?: unknown;
  kind?: "retry" | "failover";
}

export interface LiveState {
  stage?: string;
  invoiceId?: string;
  timeline?: Array<{ name: string; at: string; detail: string; state: "done" | "now" | "error"; narration?: string }>;
  toolCalls?: LiveToolCall[];
  usage?: Array<{ step: string; model: string; inputTokens: number; outputTokens: number; costUsd?: number }>;
  evidence?: Array<{ ref: string; source: string; args?: Record<string, unknown>; excerpt: string }>;
  invoice?: { totalDue?: string; vendorInvoiceNumber?: string };
  facts?: { vendorName?: string };
  match?: { exceptionTypes?: string[] };
  [key: string]: unknown;
}

export interface LiveResponse {
  status: string;
  runId: string;
  startTime: string;
  closeTime?: string;
  workerIdentity?: string;
  state: LiveState | null;
  events: EngineEvent[];
  pending: PendingActivity[];
  cursor: number;
}

// The workflows' caseState / progress query results: shapes owned by the agents.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyState = Record<string, any>;

export interface CaseDetail {
  agentId: string;
  summary: CaseSummary;
  state: AnyState | null;
  facts?: CaseFacts | null;
  /** What each evidence item says, by reference. Written by the API from the recorded tool result. */
  evidence?: Record<string, { title?: string; body: string }>;
}

export interface Mission {
  platform: Array<{ name: string; ok: boolean | null }>;
  kpis: {
    agentsLive: number;
    agentsTotal: number;
    running: number;
    needPerson: number;
    oldestWaitingSince: string | null;
    waitingOnOthers: number;
    stoppedByRule24h: number;
    spendUsd: number;
    budgetUsd: number;
  };
  runs: CaseSummary[];
  events: Array<{ kind: string; agentId: string; workflowId: string; text: string; at: string }>;
  /** Business figures over the cases the overview loaded. Absent on older APIs. */
  value?: {
    cases: number;
    awaitingDecisionCents: number;
    invoiceValueProcessedCents: number;
    closed: number;
    closedWithoutPerson: number;
    medianSecondsToProposal: number | null;
    costPerCaseUsd: number | null;
    manualCostPerCaseUsd: number | null;
  };
  servers: Array<{ name: string; kind: string; ready: number; replicas: number; hpa?: { min: number; max: number; current: number; cpuPercent: number | null } }>;
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

/** Fetch now and every `ms` while mounted; `reload` refetches at once. Keeps the last good value on errors. */
export function usePoll<T>(path: string | null, ms: number): { data: T | undefined; error: string | undefined; reload: () => void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const live = useRef(path);
  live.current = path;
  const load = useCallback(async () => {
    if (!path) return;
    try {
      const value = await getJson<T>(path);
      if (live.current === path) {
        setData(value);
        setError(undefined);
      }
    } catch (e) {
      if (live.current === path) setError(e instanceof Error ? e.message : String(e));
    }
  }, [path]);
  useEffect(() => {
    setData(undefined);
    if (!path) return;
    void load();
    const t = setInterval(() => void load(), ms);
    return () => clearInterval(t);
  }, [path, ms, load]);
  return { data, error, reload: () => void load() };
}

export const usd = (n: number | null | undefined, digits = 2) => (n == null ? "–" : `$${n.toFixed(digits)}`);
export const cents = (c: number | null | undefined) =>
  c == null ? "–" : `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d`;
}

const SMALL = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);
const UPPER = new Set(["erp", "pdf", "po", "uom", "ap", "id", "mcp", "cve"]);

/** Title case for short labels: "accept_variance" -> "Accept Variance", "read invoice PDF" -> "Read Invoice PDF". */
export function titleCase(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w, i) => {
      const l = w.toLowerCase();
      if (UPPER.has(l)) return l.toUpperCase();
      if (i > 0 && SMALL.has(l)) return l;
      return w === w.toUpperCase() && w.length > 1 && /[A-Z]/.test(w) ? w : l.charAt(0).toUpperCase() + l.slice(1);
    })
    .join(" ");
}

const money = (n: string) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Plain language for workflow text: snake_case and SHOUT_CASE become words, bare amounts get a currency sign. */
export function plain(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/amount (\d+(?:\.\d+)?) is over the (\d+(?:\.\d+)?) approval line/g, (_, a: string, b: string) => `${money(a)} is over the ${money(b)} approval line`)
    .replace(/\b[A-Za-z]+(?:_[A-Za-z]+)+\b/g, (m) => m.replace(/_/g, " ").toLowerCase())
    .replace(/^([a-z])/, (m) => m.toUpperCase());
}

const SERVER: Record<string, string> = { "erp-read": "ERP", "erp-write": "ERP", docs: "Documents", "match-engine": "Match Engine" };

/** "erp-read:get_contract_prices" -> "ERP · Contract Prices". */
export function sourceLabel(ref: string | null | undefined): string {
  const [server = "", tool = ""] = (ref ?? "").split(":");
  const t = titleCase(tool.replace(/^(get|search|read|run|list|post)_/, ""));
  return [SERVER[server] ?? titleCase(server), t].filter(Boolean).join(" · ");
}

export type CaseGroup = "needs" | "waiting" | "hold" | "escalated" | "running" | "resolved" | "cancelled" | "closed";
export const GROUP_LABEL: Record<CaseGroup, string> = {
  needs: "Needs Decision",
  waiting: "Waiting",
  hold: "On Hold",
  escalated: "Escalated",
  running: "Running",
  resolved: "Resolved",
  cancelled: "Cancelled",
  closed: "Closed",
};
/** Groups a person still has to watch. */
export const OPEN_GROUPS: CaseGroup[] = ["needs", "waiting", "hold", "escalated", "running"];

/** Where a case stands, as one of a small set of groups used by tags, tabs and the outcome bar. */
export function caseGroup(c: Pick<CaseSummary, "stage" | "status" | "needsPerson" | "temporalStatus">): CaseGroup {
  if (c.needsPerson) return "needs";
  const s = c.status ?? c.stage;
  switch (s) {
    case "resolved":
    case "done":
    case "approved":
    case "auto_approved":
      return "resolved";
    case "on_hold":
      return "hold";
    case "waiting":
      return "waiting";
    case "escalated":
    case "blocked":
      return "escalated";
    case "terminated":
    case "canceled":
    case "failed":
    case "timed_out":
      return "cancelled";
    case "expired":
    case "rejected_by_reviewer":
    case "rejected":
      return "closed";
    default:
      return "running";
  }
}

const GROUP_TAG: Record<CaseGroup, string> = { needs: "warn", waiting: "info", hold: "idle", escalated: "crit", running: "info", resolved: "ok", cancelled: "idle", closed: "idle" };

/** Status tag class and label for a case. One name per state, in title case. */
export function caseTag(c: Pick<CaseSummary, "stage" | "status" | "needsPerson" | "temporalStatus">): [string, string] {
  const g = caseGroup(c);
  const s = c.status ?? c.stage;
  const label = g === "resolved" && s !== "resolved" ? "Done" : g === "escalated" && s === "blocked" ? "Blocked" : g === "cancelled" && s !== "terminated" && s !== "canceled" ? titleCase(s) : g === "closed" ? titleCase(s) : GROUP_LABEL[g];
  return [GROUP_TAG[g], label];
}

export const shortDate = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? (iso ?? "–") : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};
