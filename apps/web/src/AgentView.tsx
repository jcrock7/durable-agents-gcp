import { useState } from "react";
import { cents, postJson, titleCase, usd, usePoll, type Agent, type CaseDetail } from "./api.js";
import { CaseTable } from "./CaseTable.js";
import { CaseView } from "./CaseView.js";
import { DOCS, docLink, repoLink } from "./docs.js";
import { Term } from "./Glossary.js";
import { caseHash, liveHash, setHashQuery } from "./routes.js";

const STATUS: Record<Agent["status"], [string, string]> = {
  active: ["ok", "Active"],
  needs_review: ["warn", "Needs Decision"],
  idle: ["idle", "Idle"],
  coming_soon: ["idle", "Roadmap"],
};

/** One agent: its header and case queue, or the selected case as a full page (ADR-0021). */
export function AgentView({
  agent,
  me,
  demoControls,
  caseId,
  temporalUiUrl,
  onCase,
  onNav,
  onCaseRef,
}: {
  agent: Agent;
  me: string;
  demoControls: boolean;
  caseId: string | null;
  temporalUiUrl?: string;
  onCase: (id: string | null) => void;
  onNav: (hash: string) => void;
  /** The open case's reference (INV-…), for the breadcrumb and page title. */
  onCaseRef?: (workflowId: string, ref: string) => void;
}) {
  const detail = usePoll<CaseDetail>(caseId ? `/api/cases/${caseId}` : null, 3_000);
  const [queueMsg, setQueueMsg] = useState<{ text: string; workflowId?: string; error?: boolean }>();
  const [tab, setTab] = useState<"open" | "running" | undefined>();
  const tiers = agent.modelTiers?.length ? agent.modelTiers.map((t) => (t.model ? `${t.alias} (${t.model})` : t.alias)).join(" · ") : agent.models;
  const routed = (agent.modelTiers ?? []).map((t) => t.model).filter(Boolean);
  const oneModel = routed.length > 1 && new Set(routed).size === 1;
  const tiersNote = !routed.length
    ? "Gateway aliases; the gateway config sets the model behind each"
    : oneModel
      ? "Gateway aliases, with the model each routes to now. Both tiers route to the same model in this deployment; the gateway config can point them at different ones"
      : "Gateway aliases, with the model each routes to now";
  const evalHref = agent.evals?.source ? repoLink(agent.evals.source) : undefined;
  const [question, setQuestion] = useState("");
  const [briefBusy, setBriefBusy] = useState(false);

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
        onNav={onNav}
        onRef={onCaseRef}
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
              <dt>
                <Term term="Model tiers">Model tiers</Term>
              </dt>
              <dd>
                {tiers}
                <span className="muted" style={{ display: "block" }}>
                  {tiersNote}.
                </span>
              </dd>
              {agent.approval && (
                <>
                  <dt>
                    <Term term="Approval line">Approval line</Term>
                  </dt>
                  <dd>
                    A person approves any write over {cents(agent.approval.amountCents)}, and always for {agent.approval.alwaysFor.map((a) => titleCase(a)).join(", ")}.
                  </dd>
                </>
              )}
              {spend?.budgetUsd != null && (
                <>
                  <dt>
                    <Term term="Budget">Budget</Term>
                  </dt>
                  <dd>{usd(spend.budgetUsd)} per budget period at the model gateway; calls beyond it are refused.</dd>
                </>
              )}
              {agent.guardrails && agent.guardrails.length > 0 && (
                <>
                  <dt>
                    <Term term="Guardrail">Guardrails</Term>
                  </dt>
                  <dd>
                    {agent.guardrails.map((g) => (
                      <span key={g} style={{ display: "block" }}>
                        {g}.
                      </span>
                    ))}
                  </dd>
                </>
              )}
              {agent.evals?.source && (
                <>
                  <dt>Eval results</dt>
                  <dd>
                    <a href={evalHref} target="_blank" rel="noreferrer">
                      {agent.evals.passed != null && agent.evals.total != null ? `${agent.evals.passed} of ${agent.evals.total} labelled cases · ` : ""}Eval Results ↗
                    </a>
                  </dd>
                </>
              )}
            </dl>
          </details>
        </div>
        <dl className="figures">
          <div>
            <dt>Runs, Last 24 Hours</dt>
            <dd>{agent.runs24h ?? "–"}</dd>
          </div>
          <div>
            <dt>Needs Decision</dt>
            <dd style={{ color: agent.needsPerson ? "var(--warn)" : undefined }}>{agent.built ? agent.needsPerson : "–"}</dd>
          </div>
          <div>
            <dt>
              <Term term="Eval pass rate">Eval Pass Rate</Term>
            </dt>
            <dd>
              {agent.evals?.rate ? (
                <a className="fig-link" href={evalHref} target="_blank" rel="noreferrer" title="Open the eval results">
                  {agent.evals.rate}
                </a>
              ) : agent.built ? (
                <span className="fig-none">Not run yet</span>
              ) : (
                "–"
              )}
            </dd>
            {agent.evals?.passed != null && agent.evals.total != null && (
              <span className="fig-sub">
                {agent.evals.passed} of {agent.evals.total} cases
              </span>
            )}
          </div>
          <div style={{ minWidth: 170 }}>
            <dt>
              <Term term="Budget">Budget</Term>, This Period
            </dt>
            <dd className="small">{spend ? `${usd(spend.spentUsd)} of ${usd(spend.budgetUsd)}` : "–"}</dd>
            {spend && spend.spentUsd > 0 && agent.built && !agent.runs24h && !agent.needsPerson && !agent.running && <span className="fig-sub">Includes runs outside the portal, such as evals</span>}
            <div className={`track${pct >= 90 ? " hot" : ""}`}>
              <div style={{ width: `${pct}%` }} />
            </div>
          </div>
        </dl>
      </section>

      {!agent.built && (
        <>
          <div className="notice">
            <span className="tag idle">Roadmap</span>
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
                <dd>{tiers}</dd>
                <dt>Design record</dt>
                <dd>
                  <a href={docLink("adr/0019-pattern-agent-portfolio.md")} target="_blank" rel="noreferrer">
                    ADR-0019, Pattern Agent Portfolio ↗
                  </a>
                </dd>
              </dl>
            </section>
          </div>
        </>
      )}

      {agent.built && (
        <CaseTable
          key={tab ?? "default"}
          agentId={agent.id}
          initial={tab}
          empty={
            agent.id === "research-summarize" ? (
              <>
                No research cases yet.{" "}
                {demoControls ? "Start one with Start a Research Brief above." : <>Start one from the command line with <code className="mono">temporal workflow start --type researchAndSummarize</code>.</>} The{" "}
                <a href={`${DOCS.repo}/tree/main/agents/general/research-summarize#readme`} target="_blank" rel="noreferrer">
                  agent’s README ↗
                </a>{" "}
                explains what a brief contains.
              </>
            ) : undefined
          }
          action={
            agent.id === "invoice-exception-resolver" ? (
              <span style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {queueMsg && (
                  <span className={queueMsg.error ? "form-error inline" : "muted"} role={queueMsg.error ? "alert" : "status"} style={{ fontSize: 14 }}>
                    {queueMsg.text}
                    {queueMsg.workflowId && temporalUiUrl && (
                      <>
                        {" "}
                        <a href={`${temporalUiUrl.replace(/\/$/, "")}/namespaces/default/workflows/${queueMsg.workflowId}`} target="_blank" rel="noreferrer">
                          Open the Queue Run in Temporal ↗
                        </a>
                      </>
                    )}
                  </span>
                )}
                <button
                  type="button"
                  className="btn sm"
                  onClick={() =>
                    void postJson<{ workflowId: string }>(`/api/agents/${agent.id}/queue`, { limit: 10 })
                      .then((r) => {
                        setQueueMsg({ text: "Started the queue run. Its cases appear under Running as each one starts.", workflowId: r.workflowId });
                        setHashQuery({ tab: "running" });
                        setTab("running");
                      })
                      .catch((e: Error) => setQueueMsg({ text: `The queue run did not start: ${e.message}.`, error: true }))
                  }
                >
                  Work the Next 10 Exceptions
                </button>
                {demoControls && (
                  <button
                    type="button"
                    className="btn sm"
                    title="Clone the demo price-variance invoice and watch the agent work it live"
                    onClick={() =>
                      void postJson<{ workflowId: string }>("/api/demo/sample-case", {})
                        .then((r) => onNav(liveHash(agent.id, r.workflowId)))
                        .catch((e: Error) => setQueueMsg({ text: `The sample case did not start: ${e.message}.`, error: true }))
                    }
                  >
                    ▶ Run a Sample Invoice
                  </button>
                )}
              </span>
            ) : agent.id === "research-summarize" && demoControls ? (
              <form
                className="brief-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (briefBusy || question.trim().length < 10) return;
                  setBriefBusy(true);
                  setQueueMsg(undefined);
                  postJson<{ workflowId: string }>("/api/demo/research-brief", { question: question.trim() })
                    .then((r) => onNav(caseHash(agent.id, r.workflowId)))
                    .catch((err: Error) => setQueueMsg({ text: `The brief did not start: ${err.message}.`, error: true }))
                    .finally(() => setBriefBusy(false));
                }}
              >
                <label htmlFor="brief-q" className="sr">
                  Research question
                </label>
                <input id="brief-q" type="text" className="search" value={question} minLength={10} maxLength={500} placeholder="A question, e.g. How do durable workflows survive a crash?" onChange={(e) => setQuestion(e.target.value)} />
                <button type="submit" className="btn sm primary" disabled={briefBusy || question.trim().length < 10} aria-describedby="brief-hint">
                  {briefBusy ? "Starting…" : "Start a Research Brief"}
                </button>
                <span id="brief-hint" className={queueMsg?.error ? "form-error inline" : "muted"} role={queueMsg?.error ? "alert" : undefined} style={{ fontSize: 13.5 }}>
                  {queueMsg?.error ? queueMsg.text : question.trim().length < 10 ? "Ask a full question, at least 10 characters." : "The agent researches it and brings a cited brief back for your approval."}
                </span>
              </form>
            ) : undefined
          }
        />
      )}
    </main>
  );
}
