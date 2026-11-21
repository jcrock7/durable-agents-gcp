// The Live Run view (docs/superpowers/specs/2026-11-20-live-run-view-design.md): a case's workflow
// graph, the agent's plain-language feed, and the Temporal engine drawer, live or as a replay.
import { useEffect, useState } from "react";
import { postJson } from "../api.js";
import { AgentFeed } from "./AgentFeed.js";
import { EngineDrawer } from "./EngineDrawer.js";
import { clock } from "./format.js";
import { LIVE_GRAPHS } from "./graphs.js";
import { ReplayControls } from "./ReplayControls.js";
import { RunGraph } from "./RunGraph.js";
import { useLive } from "./useLive.js";

export function LiveRun(props: { agentId: string; agentName?: string; workflowId: string; demoControls: boolean; temporalUiUrl?: string; onBack: () => void }) {
  const graph = LIVE_GRAPHS[props.agentId];
  const live = useLive(props.workflowId, graph);
  const [filter, setFilter] = useState<string>();
  const [drawer, setDrawer] = useState(false);
  const [focus, setFocus] = useState<string>();
  const [toast, setToast] = useState<string>();
  const [killing, setKilling] = useState(false);
  /** The worker identity just killed: the button stays off until the step is running somewhere else. */
  const [killed, setKilled] = useState<string>();
  const view = live.view;

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
      ← Back to case
    </button>
  );

  if (!graph) {
    return (
      <div className="live-run">
        {back}
        <div className="panel empty">Live view isn't available for this agent.</div>
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
      setToast(`⚡ Killed ${r.pod}. Temporal will retry the step on another worker.`);
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
  const status =
    live.mode === "replay" ? <span className="live-pill replay">REPLAY</span> : view.running ? <span className="live-pill live">LIVE</span> : <span className="live-pill done">{view.status}</span>;

  return (
    <div className="live-run" role="dialog" aria-label={`Live run ${props.workflowId}`}>
      <div className="live-top">
        {back}
        <span className="muted">{props.agentName}</span>
      </div>
      <header className="panel live-bar">
        <b className="live-ref">{(view.header.ref ?? props.workflowId).toUpperCase()}</b>
        {status}
        <span className="t2">
          {[view.header.vendor, view.header.total].filter(Boolean).join(" · ")}
          {view.header.kind && <span className="tag warn" style={{ marginLeft: 8 }}>{view.header.kind}</span>}
        </span>
        <span className="live-stats">
          <span>
            <b className="mono">{clock(view.elapsedMs)}</b>
            <i>elapsed</i>
          </span>
          <span>
            <b className="mono">${view.costUsd.toFixed(3)}</b>
            <i>LLM cost</i>
          </span>
          <span>
            <b className="mono">{view.toolCalls}</b>
            <i>tool calls</i>
          </span>
        </span>
        <span className="grow" />
        <button type="button" className="btn sm" onClick={() => setDrawer(!drawer)} aria-expanded={drawer}>
          ⚙ Engine · {view.events.length}
        </button>
        {props.demoControls && live.mode === "live" && (
          <button type="button" className="btn sm live-kill" disabled={!canKill} title={canKill ? "Delete the worker pod running this step" : "Only during a model step"} onClick={() => void kill()}>
            ⚡ Kill worker
          </button>
        )}
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
    </div>
  );
}
