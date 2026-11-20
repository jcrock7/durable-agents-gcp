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
}

// The workflows' caseState / progress query results: shapes owned by the agents.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyState = Record<string, any>;

export interface CaseDetail {
  agentId: string;
  summary: CaseSummary;
  state: AnyState | null;
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

/** Status tag class and label for a case. */
export function caseTag(c: Pick<CaseSummary, "stage" | "status" | "needsPerson" | "temporalStatus">): [string, string] {
  if (c.needsPerson) return ["warn", "Needs you"];
  const s = c.status ?? c.stage;
  switch (s) {
    case "resolved":
    case "done":
    case "approved":
    case "auto_approved":
      return ["ok", s === "resolved" ? "Resolved" : "Done"];
    case "on_hold":
      return ["info", "On hold"];
    case "waiting":
      return ["info", "Waiting"];
    case "escalated":
      return ["warn", "Escalated"];
    case "blocked":
      return ["warn", "Blocked"];
    case "expired":
    case "rejected_by_reviewer":
    case "rejected":
      return ["idle", s.replace(/_/g, " ")];
    case "terminated":
    case "canceled":
    case "failed":
    case "timed_out":
      return ["idle", s.replace(/_/g, " ")];
    default:
      return ["ok", "Running"];
  }
}
