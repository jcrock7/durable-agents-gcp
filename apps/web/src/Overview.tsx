import { useEffect } from "react";
import { ago, caseGroup, cents, duration, GROUP_LABEL, plain, titleCase, usd, type Agent, type CaseGroup, type Mission } from "./api.js";
import { nextStep } from "./CaseTable.js";
import { caseHash } from "./routes.js";

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
  if (!m) return <div className="panel empty">Loading the overview…</div>;

  // Oldest first: the decision closest to its deadline leads.
  const waiting = m.runs.filter((r) => r.needsPerson).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const counts = DIST.map(([g, cls]) => [g, cls, m.runs.filter((r) => caseGroup(r) === g).length] as const).filter(([, , n]) => n > 0);
  const live = agents.filter((a) => a.built);
  const planned = agents.filter((a) => !a.built);
  const pct = m.kpis.budgetUsd ? Math.min(100, (100 * m.kpis.spendUsd) / m.kpis.budgetUsd) : 0;
  const down = m.platform.filter((p) => p.ok === false);
  // A case's reference from the loaded runs; the workflow id is never shown as its name.
  const refOf = (workflowId: string) => m.runs.find((r) => r.workflowId === workflowId)?.ref ?? workflowId.toUpperCase();
  const v = m.value;
  const floor = v?.rateFloor ?? 10;
  const few = v ? v.closed < floor : false;

  return (
    <>
      {waiting.length === 0 ? (
        <div className="notice">
          <span className="tag ok">All Clear</span>
          <span>Nothing is waiting for a decision.</span>
        </div>
      ) : (
        <section className="needs" aria-labelledby="ov-needs">
          <h2 id="ov-needs" className="lab">
            Needs Decision · {waiting.length} {waiting.length === 1 ? "Case" : "Cases"}, Oldest First
          </h2>
          {waiting.slice(0, 3).map((r) => (
            <div key={r.workflowId} className="need">
              <div className="q">
                <span className="lab">Waiting {ago(r.startedAt)}</span>
                <b>
                  {r.agentId === "research-summarize"
                    ? `Research brief: “${r.title}”`
                    : `${r.amountCents ? `${cents(Math.abs(r.amountCents))} ` : ""}${titleCase(r.title.split(" · ").slice(1).join(" · ")) || r.title} on Case ${r.ref}`}
                </b>
                <span className="d">
                  {name(r.agentId)}
                  {r.vendorName ? ` · ${r.vendorName}` : ""}. {r.agentId === "research-summarize" ? "The brief is not final until you approve it" : nextStep(r)}.
                </span>
              </div>
              <a className="btn primary" href={caseHash(r.agentId, r.workflowId)}>
                Review
              </a>
            </div>
          ))}
        </section>
      )}

      {(() => {
        // Rule stops and a person's override are different things: each gets its own list.
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
          <div className="events">
            {grouped(rows).map((g) => {
              const e = g[0]!;
              const cases = g.filter((x) => x.workflowId);
              return (
                <div key={`${e.kind}-${e.agentId}-${e.text}`} className="event">
                  <span className={`tag ${e.kind === "Allow-list" || e.kind === "Budget" ? "idle" : e.kind === "Threshold" ? "info" : e.kind === "Override" ? "warn" : "crit"}`}>{e.kind === "Override" ? "Approved Against Policy" : e.kind}</span>
                  <div>
                    {plain(e.text)}
                  </div>
                  <div className="muted" style={{ fontSize: 14 }}>
                    {name(e.agentId)}
                    {cases.length > 1 ? ` · ${cases.length} cases: ` : cases.length === 1 ? " · " : ""}
                    {cases.slice(0, SHOWN).map((x, i) => (
                      <span key={x.workflowId + i}>
                        {i > 0 && ", "}
                        <a href={caseHash(x.agentId, x.workflowId)} style={{ fontWeight: 500 }}>
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
                </div>
              );
            })}
          </div>
        );
        return (
          <>
            <section className="panel" aria-labelledby="ov-events">
              <div className="panel-head">
                <h2 id="ov-events" className="lab">
                  Where a Rule Stopped an Agent
                </h2>
                <span className="muted" style={{ fontSize: 14 }}>
                  {stops.length ? `${stops.length} in the recent runs: ` : ""}guardrails, fraud flags, the allow-list, approval lines and budgets
                </span>
              </div>
              {stops.length === 0 && <div className="empty">No rule stopped an agent in the recent runs.</div>}
              {list(stops)}
            </section>
            {overrides.length > 0 && (
              <section className="panel" aria-labelledby="ov-overrides">
                <div className="panel-head">
                  <h2 id="ov-overrides" className="lab">
                    Where a Person Overrode the Policy Check
                  </h2>
                  <span className="muted" style={{ fontSize: 14 }}>
                    Approvals given against the policy, each with the reason recorded
                  </span>
                </div>
                {list(overrides)}
              </section>
            )}
          </>
        );
      })()}

      <section aria-label="Key figures" className="kpis">
        <Kpi label="Agents Live" value={`${m.kpis.agentsLive} of ${m.kpis.agentsTotal}`} sub={`${m.kpis.agentsTotal - m.kpis.agentsLive} on the roadmap`} />
        <Kpi label="Waiting on Others" value={m.kpis.waitingOnOthers} sub="Receipts and vendor replies" />
        <Kpi label="Handed to a Specialist" value={m.kpis.stoppedByRule24h} sub="Cases blocked or escalated in the last 24 hours" />
        <div className="panel kpi">
          <span className="lab">Model Spend</span>
          <b>{usd(m.kpis.spendUsd)}</b>
          <span className="s">of {usd(m.kpis.budgetUsd)} this budget period</span>
          <div className="track">
            <div style={{ width: `${pct}%` }} />
          </div>
        </div>
      </section>

      {v && v.cases > 0 && (
        <section aria-labelledby="ov-value" className="kpi-block">
          <h2 id="ov-value" className="lab">
            Invoice Resolver · Last {v.cases} Cases
          </h2>
          {few && (
            <p className="muted" style={{ fontSize: 14 }}>
              {v.closed} closed {v.closed === 1 ? "case" : "cases"} so far. Rates appear from {floor} closed cases; until then these are counts.
            </p>
          )}
          <div className="kpis">
            <Kpi label="Awaiting Decision" value={cents(v.awaitingDecisionCents)} sub="Value of the adjustments waiting on a person" />
            <Kpi label="Invoice Value Processed" value={cents(v.invoiceValueProcessedCents)} sub={`Across ${v.closed} closed ${v.closed === 1 ? "case" : "cases"}`} />
            <Kpi
              label="Closed Without a Person"
              value={v.closedWithoutPersonPct != null ? `${v.closedWithoutPersonPct}%` : `${v.closedWithoutPerson} of ${v.closed}`}
              sub={v.closedWithoutPersonPct != null ? `${v.closedWithoutPerson} of ${v.closed} closed cases` : `Closed ${v.closed === 1 ? "case" : "cases"}; a rate from ${floor}`}
            />
            <Kpi label="Median Time to Proposal" value={v.medianSecondsToProposal == null ? "–" : duration(v.medianSecondsToProposal)} sub={few ? `From the match to a proposal, over ${v.cases} ${v.cases === 1 ? "case" : "cases"}` : "From the match to a proposed resolution"} />
            <Kpi label="Cost per Case" value={usd(v.costPerCaseUsd, 4)} sub="Model spend per case worked" />
            {!few && v.manualCostPerCaseUsd != null && v.costPerCaseUsd != null && (
              <Kpi label="Against Manual Processing" value={`${Math.round(v.manualCostPerCaseUsd / Math.max(v.costPerCaseUsd, 0.0001)).toLocaleString("en-US")}× lower`} sub={`Against ${usd(v.manualCostPerCaseUsd)} a case by hand, as configured`} />
            )}
          </div>
          {v.whyPerson && v.whyPerson.length > 0 && v.closed > v.closedWithoutPerson && (
            <div className="panel card why-person">
              <h3 className="lab">
                Why {v.closed - v.closedWithoutPerson} of {v.closed} Closed {v.closed === 1 ? "Case" : "Cases"} Needed a Person
              </h3>
              <p className="muted">The routing rules decide this, not the model. A case can meet more than one rule.</p>
              <ul className="why-list">
                {v.whyPerson.map((r) => (
                  <li key={r.label} className={r.group === "risk" ? "risk" : r.group === "evidence" ? "evidence" : "policy"}>
                    <span className="lab">{r.group === "risk" ? "Risk" : r.group === "evidence" ? "Evidence" : "Policy"}</span>
                    <span>{r.label}</span>
                    <b>
                      {r.cases} {r.cases === 1 ? "case" : "cases"}
                    </b>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {m.runs.length > 0 && (
        <section className="panel card" aria-labelledby="ov-dist">
          <div className="row">
            <h2 id="ov-dist" className="lab">
              Where the Last {m.runs.length} Cases Ended Up · All Agents
            </h2>
            <a href="#/cases">All Cases ›</a>
          </div>
          <div className="dist" role="img" aria-label={counts.map(([g, , n]) => `${n} ${GROUP_LABEL[g]}`).join(", ")}>
            {counts.map(([g, cls, n]) => (
              <i key={g} className={cls} style={{ flex: n }}>
                {n}
              </i>
            ))}
          </div>
          <div className="legend">
            {counts.map(([g, cls, n]) => (
              <span key={g}>
                <i className={cls} />
                <b>{n}</b> {GROUP_LABEL[g]}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="panel card" aria-labelledby="ov-agents">
        <h2 id="ov-agents" className="lab">
          Agents
        </h2>
        <div className="table-wrap">
          <table className="stacked agents-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Status</th>
                <th className="num opt-col">Runs, Last 24 Hours</th>
                <th className="num">Needs Decision</th>
                <th className="num opt-col">Evals</th>
                <th style={{ minWidth: 150 }}>Budget, This Period</th>
              </tr>
            </thead>
            <tbody>
              {live.map((a) => {
                const [cls, label] = STATUS[a.status];
                const p = a.spend?.budgetUsd ? Math.min(100, (100 * a.spend.spentUsd) / a.spend.budgetUsd) : 0;
                return (
                  <tr
                    key={a.id}
                    className="clickable"
                    onClick={(e) => {
                      if (!(e.target as HTMLElement).closest("a") && !e.metaKey && !e.ctrlKey) location.hash = `#/agent/${a.id}`;
                    }}
                  >
                    <td className="nm">
                      <a href={`#/agent/${a.id}`}>{a.name}</a>
                      <span style={{ display: "block" }}>{a.purpose}</span>
                    </td>
                    <td>
                      <span className={`tag ${cls}`}>{a.needsPerson ? `${a.needsPerson} Needs Decision` : label}</span>
                    </td>
                    <td data-label="Runs, 24 hr" className="num opt-col">{a.runs24h ?? "–"}</td>
                    <td data-label="Needs Decision" className="num">{a.needsPerson}</td>
                    <td data-label="Evals" className="num opt-col">
                      {a.evals?.rate ?? "Not run"}
                      {a.evals?.passed != null && a.evals.total != null && <span className="sub">{a.evals.passed} of {a.evals.total} cases</span>}
                    </td>
                    <td data-label="Budget" className="budget">
                      {a.spend ? `${usd(a.spend.spentUsd)} of ${usd(a.spend.budgetUsd)}` : "–"}
                      <div className={`track${p >= 90 ? " hot" : ""}`}>
                        <div style={{ width: `${p}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {planned.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="muted" style={{ fontSize: 14 }}>
              On the Roadmap
            </span>
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

      <div className="ov-cols">
        <section className="panel" aria-labelledby="ov-health">
          <div className="panel-head">
            <h2 id="ov-health" className="lab">
              Agent Health
            </h2>
            <span className={`tag ${down.length ? "warn" : "ok"}`}>{down.length ? `${down.length} Down` : "All Systems Healthy"}</span>
          </div>
          <details id="agent-health" style={{ padding: "12px 22px 16px" }}>
            <summary style={{ fontWeight: 600 }}>Platform and Connected Systems</summary>
            <dl className="kv" style={{ marginTop: 12 }}>
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
    </>
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

function Kpi({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return (
    <div className="panel kpi">
      <span className="lab">{label}</span>
      <b>{value}</b>
      <span className="s">{sub}</span>
    </div>
  );
}
