// The Live Run view (docs/superpowers/specs/2026-11-20-live-run-view-design.md): a case's workflow
// graph, the agent's plain-language feed, and the Temporal engine drawer, live or as a replay.
import { useEffect, useMemo, useRef, useState } from "react";
import { postJson, titleCase } from "../api.js";
import { AgentFeed } from "./AgentFeed.js";
import { EngineDrawer } from "./EngineDrawer.js";
import { clock } from "./format.js";
import type { Agent } from "../api.js";
import { LIVE_GRAPHS, allNodes, withSchedule } from "./graphs.js";
import { ReplayControls } from "./ReplayControls.js";
import { RunGraph } from "./RunGraph.js";
import { useLive } from "./useLive.js";
import { Term } from "../Glossary.js";

export function LiveRun(props: { agentId: string; agentName?: string; schedule?: Agent["schedule"]; workflowId: string; demoControls: boolean; temporalUiUrl?: string; onBack: () => void }) {
  const graph = useMemo(() => withSchedule(LIVE_GRAPHS[props.agentId], props.schedule), [props.agentId, props.schedule]);
  const live = useLive(props.workflowId, graph);
  const [filter, setFilter] = useState<string>();
  const [drawer, setDrawer] = useState(false);
  const [focus, setFocus] = useState<string>();
  const [toast, setToast] = useState<string>();
  const [killing, setKilling] = useState(false);
  /** The worker identity just killed: the button stays off until the step is running somewhere else. */
  const [killed, setKilled] = useState<string>();
  const view = live.view;
  const root = useRef<HTMLDivElement>(null);

  // The view covers the page beside the collapsed rail, so it takes focus when it opens and gives it back when it closes.
  const before = useRef<Element | null>(null);
  const loaded = Boolean(view);
  useEffect(() => {
    before.current ??= document.activeElement;
    root.current?.focus();
  }, [loaded]);
  useEffect(
    () => () => {
      if (before.current instanceof HTMLElement) before.current.focus();
    },
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (drawer) setDrawer(false);
      else props.onBack();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [drawer, props]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 6_000);
    return () => clearTimeout(t);
  }, [toast]);

  const back = (
    <button type="button" className="link-btn" onClick={props.onBack}>
      ‹ Back to Case
    </button>
  );

  if (!graph) {
    return (
      <div className="live-run">
        {back}
        <div className="panel empty">The live view is not available for this agent.</div>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="live-run">
        {back}
        <div className={live.error ? "error" : "panel empty"}>{live.error ? `Could not load the run: ${live.error}` : "Loading the run…"}</div>
      </div>
    );
  }

  const runningOn = view.pending.find((p) => p.state === "STARTED")?.lastWorkerIdentity;
  const canKill = view.canKill && !killing && (killed === undefined || runningOn !== killed);
  const kill = async () => {
    setKilling(true);
    setKilled(runningOn);
    try {
      const r = await postJson<{ pod: string }>("/api/demo/kill-worker", { workflowId: props.workflowId });
      setToast(`Killed worker ${r.pod}. Temporal will retry the step on another worker.`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setKilling(false);
    }
  };
  const badge = (id: string) => {
    setFocus(id);
    setDrawer(true);
  };
  // A run parked at a gate is not doing anything: say what it is waiting for instead of "Live".
  const parked = view.running && view.pending.length === 0 ? allNodes(graph).find((n) => n.gate && view.nodes[n.id]?.status === "now") : undefined;
  const status =
    live.mode === "replay" ? (
      <span className="tag info">Replay</span>
    ) : parked ? (
      <span className="tag warn">Paused · Waiting at the {titleCase(parked.label)}</span>
    ) : view.running ? (
      <span className="tag info live-now">Live</span>
    ) : (
      <span className="tag idle">{titleCase(view.status.toLowerCase())}</span>
    );

  return (
    <main className="live-run" aria-label={`Run View for Case ${(view.header.ref ?? props.workflowId).toUpperCase()}`} tabIndex={-1} ref={root}>
      <div className="live-top">
        {back}
        <span className="muted">{props.agentName}</span>
      </div>
      <header className="panel live-bar">
        <h1 className="live-ref">Case {(view.header.ref ?? props.workflowId).toUpperCase()}</h1>
        {status}
        <span className="t2">
          {[view.header.vendor, view.header.total].filter(Boolean).join(" · ")}
          {view.header.kind && <span className="tag idle" style={{ marginLeft: 8 }}>{titleCase(view.header.kind)}</span>}
        </span>
        <span className="live-stats">
          <span>
            <b>{clock(view.elapsedMs)}</b>
            <i>{live.mode === "replay" ? "Real Run Time" : "Elapsed"}</i>
          </span>
          <span>
            <b>${view.costUsd.toFixed(4)}</b>
            <i>Model Cost</i>
          </span>
          <span>
            <b>{view.toolCalls}</b>
            <i>Tool Calls</i>
          </span>
        </span>
        <span className="live-actions">
          {props.demoControls && live.mode === "live" && !parked && (
            <span className="live-demo">
              <span className="lab">Demo Control</span>
              <button type="button" className="btn sm live-kill" disabled={!canKill} title={canKill ? "Delete the worker pod running this step" : "Available only while a model step is running"} onClick={() => void kill()}>
                Kill Worker
              </button>
            </span>
          )}
        </span>
      </header>
      {toast && (
        <div className="live-toast" role="status">
          {toast}
        </div>
      )}
      {live.mode === "replay" && <ReplayControls live={live} />}
      {live.error && <div className="error">Connection trouble, retrying: {live.error}</div>}
      <RunGraph graph={graph} view={view} filter={filter} onFilter={setFilter} onBadge={badge} />
      <AgentFeed graph={graph} view={view} filter={filter} onFilter={setFilter} />
      <EngineDrawer
        graph={graph}
        view={view}
        workflowId={props.workflowId}
        open={drawer}
        onOpen={(o) => {
          setDrawer(o);
          if (!o) setFocus(undefined);
        }}
        focus={focus}
        onClearFocus={() => setFocus(undefined)}
        temporalUiUrl={props.temporalUiUrl}
      />
      <p className="live-foot">
        This site uses synthetic data. New to the run view? <Term term="Engine history">Glossary: engine history, workers and replay</Term>.
      </p>
    </main>
  );
}
