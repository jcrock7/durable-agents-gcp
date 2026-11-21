import type { LiveGraph, GraphNode } from "./graphs.js";
import type { LiveView, NodeView } from "./reduce.js";
import { secs } from "./format.js";

function Node({ n, v, selected, onSelect, onBadge }: { n: GraphNode; v: NodeView; selected: boolean; onSelect: () => void; onBadge: () => void }) {
  const meta = [v.ms !== undefined ? secs(v.ms) : undefined, v.model ?? n.hint, v.costUsd ? `$${v.costUsd.toFixed(3)}` : undefined, v.tools ? `${v.tools} tool${v.tools === 1 ? "" : "s"}` : undefined]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className={`live-node ${v.status}${n.gate ? " gate" : ""}${selected ? " sel" : ""}`}>
      {(v.retries > 0 || v.failovers > 0) && (
        <span className="live-badges">
          {v.retries > 0 && (
            <button type="button" className="live-badge retry" onClick={onBadge} title="Show these retries in the engine history">
              ↻ {v.retries} retr{v.retries === 1 ? "y" : "ies"}
            </button>
          )}
          {v.failovers > 0 && (
            <button type="button" className="live-badge failover" onClick={onBadge} title="Show the failover in the engine history">
              ⚡ failover
            </button>
          )}
        </span>
      )}
      <button type="button" className="live-node-btn" onClick={onSelect} aria-pressed={selected}>
        <span className="nt">
          {v.status === "done" && "✓ "}
          {v.status === "now" && <span className="live-pulse" aria-hidden="true" />}
          {n.gate && v.status !== "done" && "⏸ "}
          {n.label}
        </span>
        <span className="nm">{meta || " "}</span>
      </button>
    </div>
  );
}

/** The workflow as a line of nodes that light up as the run moves through them, plus its side branch. */
export function RunGraph({ graph, view, filter, onFilter, onBadge }: { graph: LiveGraph; view: LiveView; filter?: string; onFilter: (id?: string) => void; onBadge: (id: string) => void }) {
  const branch = graph.branch;
  const bv = branch ? view.nodes[branch.node.id] : undefined;
  return (
    <section className="panel live-panel" aria-label="Workflow">
      <div className="live-h">
        <span>Workflow</span>
        <span>{view.header.worker ? `worker ${view.header.worker}` : ""}</span>
      </div>
      <div className="live-graph">
        {graph.nodes.map((n, i) => (
          <div key={n.id} className="live-step">
            {i > 0 && <span className={`live-edge ${view.nodes[n.id]!.status === "pending" || view.nodes[n.id]!.status === "skipped" ? "" : "done"}`} aria-hidden="true" />}
            <Node n={n} v={view.nodes[n.id]!} selected={filter === n.id} onSelect={() => onFilter(filter === n.id ? undefined : n.id)} onBadge={() => onBadge(n.id)} />
          </div>
        ))}
      </div>
      {branch && bv && (
        <div className={`live-branch ${bv.status === "pending" || bv.status === "skipped" ? "untaken" : ""}`}>
          <span className="muted">↳ {branch.label}:</span>
          <Node n={branch.node} v={bv} selected={filter === branch.node.id} onSelect={() => onFilter(filter === branch.node.id ? undefined : branch.node.id)} onBadge={() => onBadge(branch.node.id)} />
          {bv.status === "skipped" && <span className="muted">not taken</span>}
        </div>
      )}
    </section>
  );
}
