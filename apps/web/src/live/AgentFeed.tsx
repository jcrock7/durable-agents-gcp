import type { LiveGraph } from "./graphs.js";
import { allNodes } from "./graphs.js";
import type { LiveView } from "./reduce.js";
import { offset } from "./format.js";

/** The agent explaining itself, one line per step and per tool call, newest at the bottom. */
export function AgentFeed({ graph, view, filter, onFilter }: { graph: LiveGraph; view: LiveView; filter?: string; onFilter: (id?: string) => void }) {
  const items = filter ? view.feed.filter((f) => f.node === filter) : view.feed;
  const last = view.feed.at(-1)?.key;
  const label = allNodes(graph).find((n) => n.id === filter)?.label;
  return (
    <section className="panel live-panel" aria-label="What the agent is doing">
      <div className="live-h">
        <span>What the agent is doing</span>
        {filter ? (
          <button type="button" className="live-chip" onClick={() => onFilter(undefined)}>
            filter: {label} ×
          </button>
        ) : (
          <span />
        )}
      </div>
      {view.legacy && <p className="live-note">Recorded before narration. Showing step details.</p>}
      {items.length === 0 && <p className="muted live-empty">{view.running ? "Waiting for the first step…" : "Nothing recorded for this step."}</p>}
      <ol className="live-feed" aria-live="polite">
        {items.map((f) => (
          <li key={f.key} className={`live-u${view.running && f.key === last ? " now" : ""}${f.pending ? " pending" : ""}`}>
            <span className="mono muted">{offset(f.at, view.startTime)}</span>
            <span className="live-tag">{f.step}</span>
            <div>
              <div className={`say${view.running && f.key === last ? " typing" : ""}`}>{f.say}</div>
              {f.how && <div className="how">{f.how}</div>}
              {f.evidence && (
                <details className="live-ev">
                  <summary>Show evidence</summary>
                  <pre className="mono">{f.evidence}</pre>
                </details>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
