import { useState } from "react";
import { postJson, usd, usePoll, type Agent, type CaseDetail } from "./api.js";
import { CaseTable } from "./CaseTable.js";
import { CaseView } from "./CaseView.js";

const STATUS: Record<Agent["status"], [string, string]> = {
  active: ["ok", "Active"],
  needs_review: ["warn", "Needs Decision"],
  idle: ["idle", "Idle"],
  coming_soon: ["idle", "Roadmap"],
};

/** One agent: its header and case queue, or the selected case as a full page (ADR-0021). */
export function AgentView({ agent, me, caseId, onCase }: { agent: Agent; me: string; caseId: string | null; onCase: (id: string | null) => void }) {
  const detail = usePoll<CaseDetail>(caseId ? `/api/cases/${caseId}` : null, 3_000);
  const [queueMsg, setQueueMsg] = useState<string>();

  if (caseId) {
    if (detail.error && !detail.data) return <div className="page"><div className="error">Could not load the case: {detail.error}</div></div>;
    if (!detail.data || detail.data.summary.workflowId !== caseId) return <div className="page"><div className="panel empty">Loading the case…</div></div>;
    return (
      <CaseView
        detail={detail.data}
        agent={agent}
        me={me}
        onBack={() => onCase(null)}
        onChanged={() => detail.reload()}
      />
    );
  }

  const [tagClass, tagText] = STATUS[agent.status];
  const spend = agent.spend;
  const pct = spend?.budgetUsd ? Math.min(100, (100 * spend.spentUsd) / spend.budgetUsd) : 0;

  return (
    <main className="page">
      <section className="agent-head" aria-labelledby="agent-h">
        <div className="head-id">
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <h1 id="agent-h">{agent.name}</h1>
            <span className={`tag ${tagClass}`}>{tagText}</span>
          </div>
          <p>{agent.blurb}</p>
          <details className="settings">
            <summary>Agent Settings</summary>
            <dl>
              <dt>Pattern</dt>
              <dd>{agent.pattern}</dd>
              <dt>Connected systems</dt>
              <dd>{agent.tools.join(", ") || "–"}</dd>
              <dt>Model tiers</dt>
              <dd>{agent.models}</dd>
              {agent.evals?.source && (
                <>
                  <dt>Eval results</dt>
                  <dd>{agent.evals.source}</dd>
                </>
              )}
            </dl>
          </details>
        </div>
        <dl className="figures">
          <div>
            <dt>Runs, 24h</dt>
            <dd>{agent.runs24h ?? "–"}</dd>
          </div>
          <div>
            <dt>Needs Decision</dt>
            <dd style={{ color: agent.needsPerson ? "var(--warn)" : undefined }}>{agent.built ? agent.needsPerson : "–"}</dd>
          </div>
          <div>
            <dt>Eval Pass Rate</dt>
            <dd>{agent.evals?.rate ?? "–"}</dd>
          </div>
          <div style={{ minWidth: 170 }}>
            <dt>Budget, 30 Days</dt>
            <dd className="small">{spend ? `${usd(spend.spentUsd)} of ${usd(spend.budgetUsd)}` : "–"}</dd>
            <div className={`track${pct >= 90 ? " hot" : ""}`}>
              <div style={{ width: `${pct}%` }} />
            </div>
          </div>
        </dl>
      </section>

      {!agent.built && (
        <>
          <div className="notice">
            <span className="tag info">Roadmap</span>
            <span>This agent is designed but not built yet. Its cases will appear here once it runs.</span>
          </div>
          <div className="ov-cols">
            <section className="panel card">
              <h2 className="lab">What It Will Do</h2>
              <p className="rec">{agent.blurb}</p>
            </section>
            <section className="panel card">
              <h2 className="lab">How It Will Work</h2>
              <dl className="kv">
                <dt>Pattern</dt>
                <dd>{agent.pattern}</dd>
                <dt>Systems it will connect to</dt>
                <dd>{agent.tools.join(", ") || "–"}</dd>
                <dt>Model tiers</dt>
                <dd>{agent.models}</dd>
                <dt>Design record</dt>
                <dd>ADR-0019, pattern agent portfolio</dd>
              </dl>
            </section>
          </div>
        </>
      )}

      {agent.built && (
        <CaseTable
          agentId={agent.id}
          onOpen={(c) => onCase(c.workflowId)}
          action={
            agent.id === "invoice-exception-resolver" ? (
              <span style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {queueMsg && (
                  <span className="muted" style={{ fontSize: 13.5 }}>
                    {queueMsg}
                  </span>
                )}
                <button
                  type="button"
                  className="btn sm"
                  onClick={() =>
                    void postJson<{ workflowId: string }>(`/api/agents/${agent.id}/queue`, { limit: 10 })
                      .then((r) => setQueueMsg(`Started ${r.workflowId}`))
                      .catch((e: Error) => setQueueMsg(e.message))
                  }
                >
                  Work the Next 10 Exceptions
                </button>
              </span>
            ) : undefined
          }
        />
      )}
    </main>
  );
}
