import { useEffect, useState } from "react";
import { ago, caseTag, postJson, usd, usePoll, type Agent, type CaseDetail, type CaseSummary } from "./api.js";
import { CaseView } from "./CaseView.js";

const STATUS: Record<Agent["status"], [string, string]> = {
  active: ["ok", "Active"],
  needs_review: ["warn", "Needs review"],
  idle: ["idle", "Idle"],
  coming_soon: ["idle", "Coming soon"],
};

/** The agent screen: header strip, case list, selected case and inspector (ADR-0021). */
export function AgentView({ agent, me, caseId, onCase }: { agent: Agent; me: string; caseId: string | null; onCase: (id: string | null) => void }) {
  const cases = usePoll<CaseSummary[]>(agent.built ? `/api/agents/${agent.id}/cases` : null, 4_000);
  const detail = usePoll<CaseDetail>(caseId ? `/api/cases/${caseId}` : null, 3_000);
  const [queueMsg, setQueueMsg] = useState<string>();

  // Open the first case that needs a person (else the newest) when nothing is selected.
  useEffect(() => {
    if (!caseId && cases.data?.length) onCase((cases.data.find((c) => c.needsPerson) ?? cases.data[0]!).workflowId);
  }, [caseId, cases.data, onCase]);

  const [tagClass, tagText] = STATUS[agent.status];
  const spend = agent.spend;
  const pct = spend?.budgetUsd ? Math.min(100, (100 * spend.spentUsd) / spend.budgetUsd) : 0;

  return (
    <>
      <section className="agent-head" aria-labelledby="agent-h">
        <div className="head-row">
          <div className="head-id">
            <img src={`/avatars/${agent.avatar}`} alt="" />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <h1 id="agent-h">{agent.name}</h1>
                <span className={`tag ${tagClass}`}>{tagText}</span>
              </div>
              <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 3 }}>{agent.blurb}</div>
            </div>
          </div>
          <dl className="figures">
            <div>
              <dt>Pattern</dt>
              <dd className="small">{agent.pattern}</dd>
            </div>
            <div>
              <dt>Runs, 24h</dt>
              <dd>{agent.runs24h ?? "–"}</dd>
            </div>
            <div>
              <dt>Need you</dt>
              <dd style={{ color: agent.needsPerson ? "var(--warn)" : undefined }}>{agent.built ? agent.needsPerson : "–"}</dd>
            </div>
            <div>
              <dt>Eval pass rate</dt>
              <dd title={agent.evals?.source}>{agent.evals?.rate ?? "–"}</dd>
            </div>
            <div style={{ minWidth: 160 }}>
              <dt>Budget, 30 days</dt>
              <dd className="small mono">{spend ? `${usd(spend.spentUsd)} / ${usd(spend.budgetUsd)}` : "–"}</dd>
              <div className={`track${pct >= 90 ? " hot" : ""}`}>
                <div style={{ width: `${pct}%` }} />
              </div>
            </div>
          </dl>
        </div>
        <div className="tool-row">
          <span className="lbl">MCP servers</span>
          {agent.tools.map((t) => (
            <span key={t} className="chip mono">
              {t}
            </span>
          ))}
          <span className="lbl" style={{ marginLeft: 10 }}>
            Models
          </span>
          <span className="chip mono">{agent.models}</span>
        </div>
        <div role="tablist" aria-label="Agent sections" className="tabs">
          <button type="button" role="tab" aria-selected="true" className="tab on">
            Cases
          </button>
        </div>
      </section>

      {!agent.built && (
        <div className="notice">
          <span className="tag info">Coming soon</span>
          <span>This agent is designed but not built yet (see ADR-0019). Its cases will appear here once it runs.</span>
        </div>
      )}
      {(cases.error || detail.error) && <div className="error">Could not load: {cases.error ?? detail.error}</div>}

      {agent.built && (
        <main className="work">
          <section className="panel queue" aria-labelledby="queue-h">
            <div className="panel-head">
              <h2 id="queue-h" className="panel-title">
                Cases
              </h2>
              <span className="muted" style={{ fontSize: 12 }}>
                {cases.data ? `${cases.data.length} recent` : "loading"}
              </span>
            </div>
            {agent.id === "invoice-exception-resolver" && (
              <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn"
                  style={{ minHeight: 36, padding: "0 12px", fontSize: 13 }}
                  onClick={() =>
                    void postJson<{ workflowId: string }>(`/api/agents/${agent.id}/queue`, { limit: 10 })
                      .then((r) => setQueueMsg(`Started ${r.workflowId}`))
                      .catch((e: Error) => setQueueMsg(e.message))
                  }
                >
                  Work the next 10 exceptions
                </button>
                {queueMsg && (
                  <span className="muted" style={{ fontSize: 12 }}>
                    {queueMsg}
                  </span>
                )}
              </div>
            )}
            {cases.data?.length === 0 && <div className="empty">No cases yet.</div>}
            {cases.data?.map((c) => {
              const [cls, label] = caseTag(c);
              return (
                <button key={c.workflowId} type="button" className={`case-row${c.workflowId === caseId ? " on" : ""}`} aria-current={c.workflowId === caseId} onClick={() => onCase(c.workflowId)}>
                  <span className="top">
                    <span className="mono" style={{ fontSize: 12, color: "var(--text-2)" }}>
                      {c.workflowId}
                    </span>
                    <span className={`tag ${cls}`}>{label}</span>
                  </span>
                  <span className="t">{c.title}</span>
                  <span className="m">
                    {ago(c.startedAt)} ago · {c.detail}
                  </span>
                </button>
              );
            })}
          </section>

          {detail.data && detail.data.summary.workflowId === caseId ? (
            <CaseView detail={detail.data} me={me} onChanged={() => {
              detail.reload();
              cases.reload();
            }} />
          ) : (
            <section className="case-col">
              <div className="panel empty">{caseId ? "Loading the case…" : "Select a case."}</div>
            </section>
          )}
        </main>
      )}
    </>
  );
}
