import { useEffect } from "react";
import { ago, caseGroup, cents, duration, GROUP_LABEL, plain, titleCase, usd, type Agent, type CaseGroup, type Mission } from "./api.js";
import { nextStep } from "./CaseTable.js";
import { caseHash } from "./routes.js";
import { Mark, MarkLegend, SheetHead, type MarkKind } from "./sheet.js";
import { vocab } from "./vocab.js";

const STATUS: Record<Agent["status"], [string, string]> = { active: ["ok", "Active"], needs_review: ["warn", "Needs Decision"], idle: ["idle", "Idle"], coming_soon: ["idle", "Roadmap"] };
const DIST: Array<[CaseGroup, string]> = [
  ["resolved", "c-ok"],
  ["hold", "c-hold"],
  ["escalated", "c-esc"],
  ["waiting", "c-wait"],
  ["running", "c-run"],
  ["needs", "c-need"],
  ["cancelled", "c-can"],
  ["closed", "c-can"],
];

/** Opens the Agent Health panel and brings it into view. */
export function showHealth() {
  const el = document.getElementById("agent-health") as HTMLDetailsElement | null;
  if (!el) return;
  el.open = true;
  // After layout, so the opened panel's height is counted.
  requestAnimationFrame(() => el.closest("section")?.scrollIntoView({ block: "start" }));
}

/** The landing page (was the Mission Control overlay): decisions first, outcomes as one bar, then agents and platform. */
export function Overview(props: { mission?: Mission; agents: Agent[]; health?: boolean; onNav: (hash: string) => void }) {
  const { mission: m, agents } = props;
  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const loaded = Boolean(m);
  useEffect(() => {
    if (props.health && loaded) showHealth();
  }, [props.health, loaded]);
  if (!m) return <div className="sheet"><p className="empty">Loading the overview…</p></div>;

  // Oldest first: the decision closest to its deadline leads.
  const waiting = m.runs.filter((r) => r.needsPerson).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const counts = DIST.map(([g, cls]) => [g, cls, m.runs.filter((r) => caseGroup(r) === g).length] as const).filter(([, , n]) => n > 0);
  const live = agents.filter((a) => a.built);
  const planned = agents.filter((a) => !a.built);
  const down = m.platform.filter((p) => p.ok === false);
  // A case's reference from the loaded runs; the workflow id is never shown as its name.
  const refOf = (workflowId: string) => m.runs.find((r) => r.workflowId === workflowId)?.ref ?? workflowId.toUpperCase();
  const v = m.value;
  const floor = v?.rateFloor ?? 10;
  const few = v ? v.closed < floor : false;

  // Neutral Portal Rule: this screen lists every agent's work, so it uses neutral words only (vocab() with no agent).
  const n = vocab();
  const stops = m.events.filter((e) => e.kind !== "Override");
  const overrides = m.events.filter((e) => e.kind === "Override");
  // The same rule stopping the same agent the same way reads as one entry with its cases, newest first.
  type Event = (typeof m.events)[number];
  const grouped = (rows: Event[]) => {
    const groups = new Map<string, Event[]>();
    for (const e of [...rows].sort((a, b) => b.at.localeCompare(a.at))) {
      const key = `${e.kind}\u0000${e.agentId}\u0000${e.text}`;
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
    return [...groups.values()];
  };
  const SHOWN = 4;
  const list = (rows: Event[]) => (
    <ul className="stops">
      {grouped(rows).map((g) => {
        const e = g[0]!;
        const cases = g.filter((x) => x.workflowId);
        // Stop-red only where a rule stopped the agent outright; thresholds, budgets, the allow-list and overrides are notes.
        const tone = e.kind === "Allow-list" || e.kind === "Budget" || e.kind === "Threshold" || e.kind === "Override" ? "note" : "crit";
        return (
          <li key={`${e.kind}-${e.agentId}-${e.text}`} className={tone}>
            <div>
              <b>{e.kind === "Override" ? "Approved against policy." : `${e.kind}.`}</b> {plain(e.text)}
            </div>
            <div className="stop-meta">
              {name(e.agentId)}
              {cases.length > 1 ? ` · ${cases.length} cases: ` : cases.length === 1 ? " · " : ""}
              {cases.slice(0, SHOWN).map((x, i) => (
                <span key={x.workflowId + i}>
                  {i > 0 && ", "}
                  <a href={caseHash(x.agentId, x.workflowId)}>
                    {cases.length === 1 ? "Case " : ""}
                    {refOf(x.workflowId)}
                  </a>
                </span>
              ))}
              {cases.length > SHOWN && ` and ${cases.length - SHOWN} more`}
              {" · "}
              {g.length > 1 ? "latest " : ""}
              {ago(e.at)} ago
            </div>
          </li>
        );
      })}
    </ul>
  );
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const valueAgent = agents.find((a) => a.built && a.approval) ?? live[0];

  return (
    <div className="sheet">
      <SheetHead
        title={`Agent Operations, ${today}`}
        prepared="Prepared by the runs · decided by you · every figure is recorded by a run, or marked absent"
        refLine={`${m.runs.length} recent ${m.runs.length === 1 ? "case" : "cases"}`}
        refSub={`${live.length} ${live.length === 1 ? "agent" : "agents"} live · ${planned.length} on the roadmap`}
      />
      <div className="sheet-cols">
        <div className="sheet-main">
          <section className="sec" aria-labelledby="ov-needs">
            <h2 id="ov-needs">
              Decisions Waiting on You
              <span className="sec-sub">{waiting.length ? `${waiting.length}, oldest first · nothing is written until you decide` : "none"}</span>
            </h2>
            {waiting.length === 0 ? (
              <p className="all-clear">Nothing is waiting for a decision.</p>
            ) : (
              <ul className="dq">
                {waiting.slice(0, 5).map((r) => (
                  <li key={r.workflowId}>
                    <span className="dq-mark" aria-hidden="true" />
                    <div className="dq-what">
                      <b>{r.agentId === "research-summarize" || !r.amountCents ? `“${r.title}”` : <>{titleCase(r.title.split(" · ").slice(1).join(" · ")) || r.title} <span className="nowrap">· Case {r.ref}</span></>}</b>
                      <span>
                        {name(r.agentId)}
                        {r.vendorName ? ` · ${r.vendorName}` : ""} · waiting {ago(r.startedAt)} · {r.agentId === "research-summarize" ? "the brief is not final until you approve it" : nextStep(r)}
                      </span>
                    </div>
                    <span className="dq-amt">
                      {r.amountCents ? (
                        <>
                          {cents(Math.abs(r.amountCents))}
                          <Mark k="recorded" />
                        </>
                      ) : null}
                    </span>
                    <a className="btn primary" href={caseHash(r.agentId, r.workflowId)}>
                      Review<span className="sr"> Case {r.ref}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {waiting.length > 5 && (
              <a className="more" href="#/needs">
                All {waiting.length} decisions ›
              </a>
            )}
          </section>

          <section className="sec" aria-labelledby="ov-figs">
            <h2 id="ov-figs">
              {n.figures} <span className="sec-sub">all agents</span>
            </h2>
            <table className="ledger">
              <thead>
                <tr>
                  <th>Figure</th>
                  <th className="basis">Basis</th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                <Fig label="Agents live" basis={`${m.kpis.agentsTotal - m.kpis.agentsLive} on the roadmap`} value={`${m.kpis.agentsLive} of ${m.kpis.agentsTotal}`} mark="recorded" />
                <Fig label="Waiting on others" basis="Replies and documents the agents are waiting for" value={m.kpis.waitingOnOthers} mark="totalled" />
                <Fig label="Handed to a specialist" basis="Blocked or escalated in the last 24 hours" value={m.kpis.stoppedByRule24h} mark="totalled" />
                <Fig label="Model spend" basis={`of ${usd(m.kpis.budgetUsd)} this budget period`} value={usd(m.kpis.spendUsd)} mark="rule" />
              </tbody>
            </table>
          </section>

          {v && v.cases > 0 && (
            <section className="sec" aria-labelledby="ov-value">
              <h2 id="ov-value">
                {valueAgent?.name ?? "Agent"} · Last {v.cases} {v.cases === 1 ? "Case" : "Cases"}
                <span className="sec-sub">{few ? `counts until ${floor} cases close` : `${v.closed} closed`}</span>
              </h2>
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Figure</th>
                    <th className="basis">Basis</th>
                    <th className="num">Value</th>
                  </tr>
                </thead>
                <tbody>
                  <Fig label="Awaiting decision" basis="Value waiting on a person" value={cents(v.awaitingDecisionCents)} mark="totalled" />
                  <Fig label="Value processed" basis={`Across ${v.closed} closed ${v.closed === 1 ? "case" : "cases"}`} value={cents(v.invoiceValueProcessedCents)} mark="totalled" />
                  <Fig
                    label="Closed without a person"
                    basis={v.closedWithoutPersonPct != null ? `${v.closedWithoutPerson} of ${v.closed} closed cases` : `Closed ${v.closed === 1 ? "case" : "cases"}; a rate from ${floor}`}
                    value={v.closedWithoutPersonPct != null ? `${v.closedWithoutPersonPct}%` : `${v.closedWithoutPerson} of ${v.closed}`}
                    mark="totalled"
                  />
                  <Fig label="Median time to proposal" basis={`From the first step to a proposal, over ${v.cases} ${v.cases === 1 ? "case" : "cases"}`} value={v.medianSecondsToProposal == null ? "Not recorded" : duration(v.medianSecondsToProposal)} mark={v.medianSecondsToProposal == null ? "absent" : "recorded"} />
                  {!few && v.manualCostPerCaseUsd != null && v.costPerCaseUsd != null && (
                    <Fig label="Against manual processing" basis={`Against ${usd(v.manualCostPerCaseUsd)} a case by hand, as configured`} value={`${Math.round(v.manualCostPerCaseUsd / Math.max(v.costPerCaseUsd, 0.0001)).toLocaleString("en-US")}× lower`} mark="rule" />
                  )}
                  <Fig label="Model cost per case" basis="Gateway charges per case worked" value={v.costPerCaseUsd == null ? "Not recorded" : usd(v.costPerCaseUsd, 4)} mark={v.costPerCaseUsd == null ? "absent" : "totalled"} />
                </tbody>
              </table>
              {v.whyPerson && v.whyPerson.length > 0 && v.closed > v.closedWithoutPerson && (
                <div className="why-person">
                  <h3>
                    Why {v.closed - v.closedWithoutPerson} of {v.closed} Closed {v.closed === 1 ? "Case" : "Cases"} Needed a Person
                  </h3>
                  <p className="muted">The routing rules decide this, not the model. A case can meet more than one rule.</p>
                  <ul className="why-list">
                    {v.whyPerson.map((r) => (
                      <li key={r.label} className={r.group === "risk" ? "risk" : r.group === "evidence" ? "evidence" : "policy"}>
                        <span className="why-group">{r.group === "risk" ? "Risk" : r.group === "evidence" ? n.sources : "Policy"}</span>
                        <span>{r.label}</span>
                        <b>
                          {r.cases} {r.cases === 1 ? "case" : "cases"}
                          <Mark k="totalled" />
                        </b>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          <section className="sec" aria-labelledby="ov-events">
            <h2 id="ov-events">
              {n.ruleStops}
              <span className="sec-sub">where a rule stopped an agent: guardrails, fraud flags, the allow-list, approval lines and budgets</span>
            </h2>
            {stops.length === 0 ? <p className="all-clear">No rule stopped an agent in the recent runs.</p> : list(stops)}
          </section>
          {overrides.length > 0 && (
            <section className="sec" aria-labelledby="ov-overrides">
              <h2 id="ov-overrides">
                Overrides <span className="sec-sub">approvals given against the policy, each with the reason recorded</span>
              </h2>
              {list(overrides)}
            </section>
          )}

          {m.runs.length > 0 && (
            <section className="sec" aria-labelledby="ov-dist">
              <h2 id="ov-dist">
                Where the Last {m.runs.length} Cases Ended Up
                <span className="sec-sub">
                  all agents · <a href="#/cases">All Cases ›</a>
                </span>
              </h2>
              <table className="ledger outcomes">
                <tbody>
                  {counts.map(([g, cls, c]) => (
                    <tr key={g}>
                      <td>
                        <i className={`sq ${cls}`} aria-hidden="true" />
                        {GROUP_LABEL[g]}
                      </td>
                      <td className="num">
                        {c}
                        <Mark k="totalled" />
                      </td>
                    </tr>
                  ))}
                  <tr className="sum">
                    <td>All recent cases</td>
                    <td className="num">
                      {m.runs.length}
                      <Mark k="totalled" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>
          )}
        </div>

        <div className="sheet-margin">
          <MarkLegend ruleName="a configured rule: an approval line, a budget or a configured rate" />

          <section className="sec" aria-labelledby="ov-agents">
            <h2 id="ov-agents">Agents</h2>
            <ul className="agent-rows">
              {live.map((a) => {
                const [, label] = STATUS[a.status];
                const p = a.spend?.budgetUsd ? Math.min(100, (100 * a.spend.spentUsd) / a.spend.budgetUsd) : 0;
                return (
                  <li key={a.id}>
                    <div>
                      <a className="row-link" href={`#/agent/${a.id}`}>
                        {a.name}
                      </a>
                      <span className="agent-state">
                        {" "}
                        · {a.needsPerson ? `${a.needsPerson} waiting` : label.toLowerCase()} · evals {a.evals?.rate ?? "not run"}
                        <Mark k={a.evals?.rate ? "recorded" : "absent"} />
                      </span>
                    </div>
                    <span className="agent-purpose">{a.purpose}</span>
                    <div className={`track${p >= 90 ? " hot" : ""}`}>
                      <div style={{ width: `${p}%` }} />
                    </div>
                    <span className="agent-budget">
                      {a.spend ? `${usd(a.spend.spentUsd)} of ${usd(a.spend.budgetUsd)} budget` : "No budget recorded"}
                      <Mark k={a.spend ? "rule" : "absent"} />
                      {a.runs24h != null && ` · ${a.runs24h} ${a.runs24h === 1 ? "run" : "runs"} in 24 hours`}
                    </span>
                  </li>
                );
              })}
            </ul>
            {planned.length > 0 && (
              <div className="road-block">
                <span className="muted">On the Roadmap</span>
                <div className="road">
                  {planned.map((a) => (
                    <a key={a.id} title={a.purpose} href={`#/agent/${a.id}`}>
                      {a.name}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="sec" aria-labelledby="ov-health">
            <h2 id="ov-health">
              Agent Health <span className="sec-sub">{down.length ? `${down.length} down` : "all systems healthy"}</span>
            </h2>
            <details id="agent-health">
              <summary>Platform and Connected Systems</summary>
              <dl className="kv">
                {m.platform.map((p) => (
                  <Row key={p.name} k={p.name} v={p.ok === null ? "Unknown" : p.ok ? "Healthy" : "Down"} />
                ))}
                {m.servers.map((s) => (
                  <Row key={s.name} k={`${s.name} (${s.kind})`} v={s.hpa ? `${s.ready} ready, scales ${s.hpa.min}–${s.hpa.max}${s.hpa.cpuPercent != null ? `, CPU ${s.hpa.cpuPercent}%` : ""}` : `${s.ready} of ${s.replicas} ready`} />
                ))}
              </dl>
            </details>
          </section>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}

/** One ruled figure row: what it is, what it covers, the value and its mark. The last row of a table is double-ruled. */
function Fig({ label, basis, value, mark, sum }: { label: string; basis: string; value: string | number; mark: MarkKind; sum?: boolean }) {
  return (
    <tr className={sum ? "sum" : undefined}>
      <td>{label}</td>
      <td className="basis">{basis}</td>
      <td className="num">
        {value}
        <Mark k={mark} />
      </td>
    </tr>
  );
}
