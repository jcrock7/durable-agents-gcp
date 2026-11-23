import type { Layout, Vocabulary } from "./vocab.js";
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
  /** The model behind each gateway alias, when the gateway reports it. */
  modelTiers?: Array<{ alias: string; model: string | null }>;
  evals?: { rate: string; source: string; passed?: number; total?: number };
  /** The agent's configured clocks (from its config, via the API). */
  schedule?: { reviewDays: number; receipt?: { reminderDays: number[]; escalateDays: number } };
  approval?: { amountCents: number; alwaysFor: string[] };
  guardrails?: string[];
  /** This agent's words and case-page recipe, from the agent registry. */
  vocabulary?: Partial<Vocabulary>;
  layout?: Layout;
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
  /** False when the run recorded no model usage: show "not recorded", not $0. */
  costRecorded?: boolean;
  /** A person approved this against the policy check. */
  overridden?: boolean;
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
  /** What was decided, read by the API from the run's timeline. */
  decision?: DecisionRecord | null;
  /** Each ERP write and what allowed it: a person or a named rule. */
  writes?: WriteRecord[];
  /** The approval line the amount went over, when that rule fired. */
  threshold?: { amountCents: number; lineCents: number } | null;
  /** Why the case needed a person, in plain language, from the recorded route. */
  personReasons?: PersonReason[];
  /** While a proposal waits: when it expires, and what happens then. */
  deadline?: { expiresAt: string; onExpiry: string } | null;
  /** A research draft's coverage: cited, uncited and unrelated sources, and each point's sources. */
  research?: { question?: string; points: number; sources: number; cited: number[]; uncited: number[]; unrelated: number[]; pointSources: number[][] } | null;
}

export interface PersonReason {
  kind: string;
  group: "policy" | "risk" | "evidence";
  label: string;
  /** The rule as the workflow recorded it. */
  rule?: string;
}

export interface DecisionRecord {
  reviewer?: string;
  approvedAt?: string;
  approvalReason?: string;
  escalatedAt?: string;
  escalationNote?: string;
  postedAt?: string;
  sentBack: number;
  /** A person approved a proposal the policy check said does not fit. */
  againstPolicy?: boolean;
}

export interface WriteRecord {
  ref: string;
  label: string;
  at: string;
  by: "person" | "rule";
  who?: string;
  why: string;
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
    /** Below this many closed cases the API gives no rate, only counts. */
    rateFloor?: number;
    closedWithoutPersonPct?: number | null;
    /** Why the other closed cases needed a person: cases per reason. */
    whyPerson?: Array<PersonReason & { cases: number }>;
    medianSecondsToProposal: number | null;
    costPerCaseUsd: number | null;
    manualCostPerCaseUsd: number | null;
  };
  servers: Array<{ name: string; kind: string; ready: number; replicas: number; hpa?: { min: number; max: number; current: number; cpuPercent: number | null } }>;
}

/** A failed request in words a reviewer can act on; the API's own message when it sent one. */
export function requestError(status: number, apiMessage?: string): string {
  if (apiMessage) return apiMessage.charAt(0).toUpperCase() + apiMessage.slice(1);
  if (status === 401) return "Your sign-in has expired. Reload the page to sign in again";
  if (status === 403) return "This request was refused";
  if (status === 404) return "Not found. It may have been removed";
  if (status >= 500) return `The portal API is not responding (HTTP ${status}). It is retried automatically`;
  return `The request failed (HTTP ${status})`;
}

async function failure(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error(requestError(res.status, typeof body.error === "string" ? body.error : undefined));
}

export async function getJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { headers: { accept: "application/json" } });
  } catch {
    throw new Error("The portal cannot be reached. Check the connection; it is retried automatically");
  }
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("The portal cannot be reached. Nothing was sent; try again");
  }
  if (!res.ok) throw await failure(res);
  return (await res.json().catch(() => ({}))) as T;
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

/** Model cost, or "Not recorded" for runs that kept none. */
export const costText = (c: { costUsd: number; costRecorded?: boolean }, digits = 4) => (c.costRecorded === false ? "Not recorded" : usd(c.costUsd, digits));

export const usd = (n: number | null | undefined, digits = 2) => (n == null ? "–" : `$${n.toFixed(digits)}`);
export const cents = (c: number | null | undefined) =>
  c == null ? "–" : `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Time left until `iso`: "5d 3h", "4h 12m", "8m"; "now" once it has passed. */
/** Time left until `iso`, in the same format as ago(): "5 days 3 hr", "4 hr 12 min", "8 min"; "now" once it has passed. */
export function until(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const s = Math.round((Date.parse(iso) - now) / 1000);
  if (s <= 0) return "now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) {
    // Round to whole minutes first, so 2 h 59 min 40 sec reads "3 hr 0 min", never "2 hr 60 min".
    const min = Math.round(s / 60);
    return `${Math.floor(min / 60)} hr ${min % 60} min`;
  }
  const d = Math.floor(s / 86400);
  return `${d} ${d === 1 ? "day" : "days"} ${Math.floor((s % 86400) / 3600)} hr`;
}

/** A length of time in the same words as ago(): "45 sec", "3 min", "1 hr 12 min". */
export function duration(seconds: number): string {
  return ago(new Date(0).toISOString(), Math.max(0, seconds) * 1000);
}

/** Elapsed time in one format everywhere: "45 sec", "6 min", "3 hr 54 min", "2 days". */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} sec`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) {
    // Round to whole minutes first, so 2 h 59 min 40 sec reads "3 hr 0 min", never "2 hr 60 min".
    const min = Math.round(s / 60);
    return `${Math.floor(min / 60)} hr ${min % 60} min`;
  }
  const d = Math.floor(s / 86400);
  return `${d} ${d === 1 ? "day" : "days"}`;
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
    // "$1284.00" gets its thousands separator, like every other amount.
    .replace(/\$(\d{4,9}\.\d{2})\b/g, (_, n: string) => money(n))
    // A bare two-decimal amount ("accept_variance · 1284.00") is money in workflow text.
    .replace(/(^|[\s·(])(-?\d{1,9}\.\d{2})(?=$|[\s·),;]|\.(?!\d))/g, (_, pre: string, n: string) => `${pre}${money(n)}`)
    .replace(/\b[A-Za-z]+(?:_[A-Za-z]+)+\b/g, (m) => m.replace(/_/g, " ").toLowerCase())
    // Capitalise the first word, but never an identifier such as a username ("local-user", "ap.lead").
    .replace(/^([a-z])(\S*)/, (m, first: string, rest: string) => (/[-.@_\d]/.test(rest) ? m : first.toUpperCase() + rest));
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

const ENDED = new Set(["FAILED", "TERMINATED", "TIMED_OUT", "CANCELED"]);

/** Where a case stands, as one of a small set of groups used by tags, tabs and the outcome bar. */
export function caseGroup(c: Pick<CaseSummary, "stage" | "status" | "needsPerson" | "temporalStatus">): CaseGroup {
  if (c.needsPerson) return "needs";
  // A run the engine ended (failed, terminated, timed out) never counts as resolved, whatever its last stage said.
  if (ENDED.has(c.temporalStatus)) return "cancelled";
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

const GROUP_TAG: Record<CaseGroup, string> = { needs: "warn", waiting: "idle", hold: "idle", escalated: "crit", running: "info", resolved: "ok", cancelled: "idle", closed: "idle" };

/** Status tag class and label for a case. One name per state, in title case. */
export function caseTag(c: Pick<CaseSummary, "stage" | "status" | "needsPerson" | "temporalStatus">): [string, string] {
  const g = caseGroup(c);
  const s = c.status ?? c.stage;
  if (c.temporalStatus === "FAILED" || c.temporalStatus === "TIMED_OUT") return [GROUP_TAG[g], titleCase(c.temporalStatus.toLowerCase())];
  const label = g === "resolved" && s !== "resolved" ? "Done" : g === "escalated" && s === "blocked" ? "Blocked" : g === "cancelled" && s !== "terminated" && s !== "canceled" ? titleCase(s) : g === "closed" ? titleCase(s) : GROUP_LABEL[g];
  return [GROUP_TAG[g], label];
}

/** The one date-and-time format: "21 Nov 2026, 14:05". Times of day alone use clock() ("14:05:09"). */
export const dateTime = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return iso ?? "–";
  const d = new Date(t);
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
};

export const shortDate = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? (iso ?? "–") : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};
