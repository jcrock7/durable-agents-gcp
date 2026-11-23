import { useState } from "react";
import { cents, postJson, titleCase, usd, usePoll, type Agent, type CaseDetail } from "./api.js";
import { CaseTable } from "./CaseTable.js";
import { CaseView } from "./CaseView.js";
import { DOMAIN } from "./domain/index.js";
import { DOCS, docLink, repoLink } from "./docs.js";
import { Term } from "./Glossary.js";
import { Mark, MarkLegend, SheetHead } from "./sheet.js";
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
  const [tab, setTab] = useState<"open" | "running" | undefined>();
  const tiers = agent.modelTiers?.length ? agent.modelTiers.map((t) => (t.model ? `${t.alias} (${t.model})` : t.alias)).join(" · ") : agent.models;
  const routed = (agent.modelTiers ?? []).map((t) => t.model).filter(Boolean);
  const oneModel = routed.length > 1 && new Set(routed).size === 1;
  const tiersNote = !routed.length
    ? "Gateway aliases; the gateway config sets the model behind each"
    : oneModel
      ? "Gateway aliases, with the model each routes to now. Both tiers route to the same model in this deployment; the gateway config can point them at different ones"
      : "Gateway aliases, with the model each routes to now";
  const { Actions, Empty } = DOMAIN[agent.id] ?? {};
  const evalHref = agent.evals?.source ? repoLink(agent.evals.source) : undefined;

  if (caseId) {
    if (detail.error && !detail.data) return <div className="page"><div className="error">Could not load the case: {detail.error}</div></div>;
    if (!detail.data || detail.data.summary.workflowId !== caseId) return <div className="page"><div className="sheet"><p className="empty">Loading the case…</p></div></div>;
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

  return (
    <main className="page">
      <div className="sheet">
      <SheetHead
        title={<span id="agent-h">{agent.name}</span>}
        prepared={agent.blurb}
        refLine={
          <>
            <span className={`tag ${tagClass}`}>{agent.built && agent.needsPerson ? `${agent.needsPerson} Needs Decision` : tagText}</span>
          </>
        }
        refSub={agent.pattern}
      />
      <div className="sheet-cols">
        <div className="sheet-main">
          <section className="sec" aria-labelledby="agent-figs">
            <h2 id="agent-figs">Figures</h2>
            <table className="ledger">
              <thead>
                <tr>
                  <th>Figure</th>
                  <th className="basis">Basis</th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Runs</td>
                  <td className="basis">Last 24 hours</td>
                  <td className="num">
                    {agent.runs24h ?? "Not recorded"}
                    <Mark k={agent.runs24h == null ? "absent" : "totalled"} />
                  </td>
                </tr>
                <tr>
                  <td>Needs decision</td>
                  <td className="basis">Cases waiting on a person now</td>
                  <td className="num">
                    {agent.built ? agent.needsPerson : "Not built"}
                    <Mark k={agent.built ? "totalled" : "absent"} />
                  </td>
                </tr>
                <tr>
                  <td>
                    <Term term="Eval pass rate">Eval pass rate</Term>
                  </td>
                  <td className="basis">
                    {agent.evals?.passed != null && agent.evals.total != null ? (
                      <a href={evalHref} target="_blank" rel="noreferrer">
                        {agent.evals.passed} of {agent.evals.total} labelled cases ↗
                      </a>
                    ) : (
                      "Latest eval run"
                    )}
                  </td>
                  <td className="num">
                    {agent.evals?.rate ?? "Not run"}
                    <Mark k={agent.evals?.rate ? "recorded" : "absent"} />
                  </td>
                </tr>
                <tr>
                  <td>
                    <Term term="Budget">Budget</Term> spent
                  </td>
                  <td className="basis">
                    {spend?.budgetUsd != null ? `Of ${usd(spend.budgetUsd)} this budget period` : "This budget period"}
                    {spend && spend.spentUsd > 0 && agent.built && !agent.runs24h && !agent.needsPerson && !agent.running ? "; includes runs outside the portal, such as evals" : ""}
                  </td>
                  <td className="num">
                    {spend ? usd(spend.spentUsd) : "Not recorded"}
                    <Mark k={spend ? "rule" : "absent"} />
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>
        <div className="sheet-margin">
          <MarkLegend ruleName="the agent's budget" kinds={["recorded", "totalled", "rule", "absent"]} />
          <details className="settings">
            <summary>Agent Settings</summary>
            <dl>
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
            </dl>
          </details>
        </div>
      </div>

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
          agents={[agent]}
          empty={Empty ? <Empty demoControls={demoControls} /> : undefined}
          action={
            Actions ? (
              <Actions
                agent={agent}
                demoControls={demoControls}
                temporalUiUrl={temporalUiUrl}
                onNav={onNav}
                onRunning={() => {
                  setHashQuery({ tab: "running" });
                  setTab("running");
                }}
              />
            ) : undefined
          }
        />
      )}
      </div>
    </main>
  );
}
