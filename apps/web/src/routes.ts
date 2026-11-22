import type { View } from "./Sidebar.js";

export interface Route {
  view: View;
  agent?: string;
  case?: string;
  /** The case's Live Run view (live, or a replay for a finished case). */
  live?: boolean;
  /** Open and scroll to the Agent Health panel on the overview. */
  health?: boolean;
}

/** Routes: #/overview[/health] · #/cases · #/cases/needs · #/agent/<agentId>[/case/<workflowId>[/live]] */
export function parseHash(hash: string): Route {
  const m = /^#\/agent\/([a-z0-9-]+)(?:\/case\/([a-z0-9-]+)(\/live)?)?/.exec(hash);
  if (m) return { view: "agent", agent: m[1], case: m[2], ...(m[3] ? { live: true } : {}) };
  if (hash.startsWith("#/cases/needs")) return { view: "needs" };
  if (hash.startsWith("#/cases")) return { view: "cases" };
  return { view: "overview", health: hash.startsWith("#/overview/health") };
}

/** The query part of the hash ("#/cases?tab=hold&q=alder"): view state that Back and a bookmark keep. */
export function hashQuery(hash = location.hash): URLSearchParams {
  const i = hash.indexOf("?");
  return new URLSearchParams(i < 0 ? "" : hash.slice(i + 1));
}

/** Replace the hash query in place (no history entry, no hashchange), dropping empty values. */
export function setHashQuery(values: Record<string, string | undefined>): void {
  const q = hashQuery();
  for (const [k, v] of Object.entries(values)) {
    if (v) q.set(k, v);
    else q.delete(k);
  }
  const base = location.hash.split("?")[0] || "#/overview";
  const next = q.toString() ? `${base}?${q}` : base;
  if (next !== location.hash) history.replaceState(history.state, "", next);
}

export const caseHash = (agentId: string, workflowId: string) => `#/agent/${agentId}/case/${workflowId}`;
export const liveHash = (agentId: string, workflowId: string) => `${caseHash(agentId, workflowId)}/live`;
