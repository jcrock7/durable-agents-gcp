import { useEffect, useRef, useState } from "react";
import { getJson, type EngineEvent } from "../api.js";
import { allNodes, nodeForActivity, type LiveGraph } from "./graphs.js";
import type { LiveView } from "./reduce.js";
import { offset } from "./format.js";

type Tab = "grouped" | "raw" | "json";

const attrsText = (attrs: Record<string, string | number>) =>
  Object.entries(attrs)
    .map(([k, v]) => `${k}=${v}`)
    .join(" · ");

function Row({ e, start, hl, selected, onPick }: { e: EngineEvent; start: string; hl: boolean; selected: boolean; onPick: () => void }) {
  return (
    <tr className={`${e.kind ? `k-${e.kind}` : ""}${hl ? " hl" : ""}${selected ? " sel" : ""}`} onClick={onPick} data-event={e.id}>
      <td>{e.id}</td>
      <td>{offset(e.at, start)}</td>
      <td className="ty">
                {e.type}
      </td>
      <td className="attr">{attrsText(e.attrs)}</td>
    </tr>
  );
}

/** The raw Temporal history for the run, grouped by step, collapsed to one line by default. */
export function EngineDrawer({
  graph,
  view,
  workflowId,
  open,
  onOpen,
  focus,
  onClearFocus,
  temporalUiUrl,
}: {
  graph: LiveGraph;
  view: LiveView;
  workflowId: string;
  open: boolean;
  onOpen: (o: boolean) => void;
  /** A node whose events are highlighted and scrolled to (from a graph badge). */
  focus?: string;
  onClearFocus: () => void;
  temporalUiUrl?: string;
}) {
  const [tab, setTab] = useState<Tab>("grouped");
  const [picked, setPicked] = useState<number>();
  const [raw, setRaw] = useState<{ id: number; body: string }>();
  const body = useRef<HTMLDivElement>(null);
  const events = view.events;
  const hl = new Set(focus ? (view.nodes[focus]?.eventIds ?? []) : []);
  const retries = Object.values(view.nodes).reduce((s, n) => s + n.retries, 0);
  const failovers = Object.values(view.nodes).reduce((s, n) => s + n.failovers, 0);
  const lastEvent = events.at(-1);

  useEffect(() => {
    if (!open || !focus) return;
    const first = view.nodes[focus]?.eventIds.find((id) => view.events.some((e) => e.id === id && e.kind));
    body.current?.querySelector(`[data-event="${first ?? view.nodes[focus]?.eventIds[0]}"]`)?.scrollIntoView({ block: "center" });
  }, [open, focus, view]);

  useEffect(() => {
    if (tab !== "json" || picked === undefined || raw?.id === picked) return;
    getJson<unknown>(`/api/cases/${workflowId}/live?raw=${picked}`)
      .then((r) => setRaw({ id: picked, body: JSON.stringify(r, null, 2) }))
      .catch(() => setRaw({ id: picked, body: JSON.stringify(events.find((e) => e.id === picked), null, 2) }));
  }, [tab, picked, raw, workflowId, events]);

  if (!open) {
    return (
      <div className="live-drawer closed">
        <button type="button" className="live-dh" onClick={() => onOpen(true)} aria-expanded="false">
          <b>Engine History</b>
          <span className="muted">
            {events.length} events{lastEvent ? ` · last: ${lastEvent.type}${lastEvent.attrs.attempt ? ` attempt=${lastEvent.attrs.attempt}` : ""} · ${offset(lastEvent.at, view.startTime)}` : ""}
          </span>
          {retries > 0 && <span className="live-badge retry">{retries} {retries === 1 ? "Retry" : "Retries"}</span>}
          {failovers > 0 && <span className="live-badge failover">{failovers} {failovers === 1 ? "Failover" : "Failovers"}</span>}
          <span className="live-open">Open</span>
        </button>
      </div>
    );
  }

  // Group by graph node, newest group first; engine-only events (workflow tasks, timers) last.
  const groups = new Map<string, EngineEvent[]>();
  for (const e of events) {
    const key = nodeForActivity(graph, e.activityType)?.id ?? "engine";
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const order = [...allNodes(graph).map((n) => n.id).filter((id) => groups.has(id)).reverse(), ...(groups.has("engine") ? ["engine"] : [])];
  const label = (id: string) => (id === "engine" ? "Workflow tasks and timers" : (allNodes(graph).find((n) => n.id === id)?.label ?? id));
  const pick = (id: number) => setPicked(id);
  const table = (rows: EngineEvent[]) => (
    <table className="mono">
      <thead>
        <tr>
          <th>#</th>
          <th>Time</th>
          <th>Event</th>
          <th>Attributes</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((e) => (
          <Row key={e.id} e={e} start={view.startTime} hl={hl.has(e.id)} selected={picked === e.id} onPick={() => pick(e.id)} />
        ))}
      </tbody>
    </table>
  );

  return (
    <section className="live-drawer" aria-label="Engine history">
      <div className="live-dh">
        <b>Engine History</b>
        <span className="muted">
          Temporal history · {events.length} events{view.running ? " · live" : ""}
        </span>
        <span className="live-tabs" role="tablist">
          {(["grouped", "raw", "json"] as Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {t === "grouped" ? "Grouped" : t === "raw" ? "Raw Events" : "JSON"}
            </button>
          ))}
        </span>
        <span className="grow" />
        {focus && (
          <button type="button" className="live-chip" onClick={onClearFocus}>
            {label(focus)} ×
          </button>
        )}
        {temporalUiUrl && (
          <a className="btn sm" href={`${temporalUiUrl.replace(/\/$/, "")}/namespaces/default/workflows/${workflowId}`} target="_blank" rel="noreferrer">
            Open in Temporal UI ↗
          </a>
        )}
        <button type="button" className="btn sm" onClick={() => onOpen(false)}>
          ▾ Collapse
        </button>
      </div>
      <div className="live-db" ref={body}>
        {view.pending.length > 0 && (
          <div className="live-pending">
            {view.pending.map((p) => (
              <div key={p.activityId} className={p.kind ? `k-${p.kind}` : ""}>
                <span className="mono">
                  — running {p.activityType} · attempt {p.attempt}
                  {p.lastWorkerIdentity ? ` · on ${p.lastWorkerIdentity}` : ""}
                  {p.lastFailure ? ` · last failure: ${p.lastFailure.timeoutType ? `${p.lastFailure.timeoutType} timeout` : p.lastFailure.message}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
        {tab === "grouped" &&
          order.map((id) => (
            <details key={id} open={id === order[0] || id === focus}>
              <summary>
                {label(id)} · {groups.get(id)!.length} events
              </summary>
              {table(groups.get(id)!)}
            </details>
          ))}
        {tab === "raw" && table(events)}
        {tab === "json" &&
          (picked === undefined ? (
            <p className="muted live-empty">Pick an event in Grouped or Raw to see its JSON.</p>
          ) : (
            <pre className="mono live-json">{raw?.id === picked ? raw.body : "Loading…"}</pre>
          ))}
      </div>
    </section>
  );
}
