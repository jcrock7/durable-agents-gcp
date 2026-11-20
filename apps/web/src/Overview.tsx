import { ago, caseGroup, cents, GROUP_LABEL, plain, titleCase, usd, type Agent, type CaseGroup, type Mission } from "./api.js";
import { nextStep } from "./CaseTable.js";

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

/** The landing page (was the Mission Control overlay): decisions first, outcomes as one bar, then agents and platform. */
export function Overview(props: { mission?: Mission; agents: Agent[]; onNav: (hash: string) => void }) {
  const { mission: m, agents } = props;
  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  if (!m) return <div className="panel empty">Loading the overview…</div>;

  const waiting = m.runs.filter((r) => r.needsPerson);
  const counts = DIST.map(([g, cls]) => [g, cls, m.runs.filter((r) => caseGroup(r) === g).length] as const).filter(([, , n]) => n > 0);
  const live = agents.filter((a) => a.built);
  const planned = agents.filter((a) => !a.built);
  const pct = m.kpis.budgetUsd ? Math.min(100, (100 * m.kpis.spendUsd) / m.kpis.budgetUsd) : 0;
  const down = m.platform.filter((p) => p.ok === false);

  return (
    <>
      {waiting.length === 0 ? (
        <div className="notice">
          <span className="tag ok">All Clear</span>
          <span>Nothing is waiting for a decision.</span>
        </div>
      ) : (
        waiting.slice(0, 3).map((r) => (
          <div key={r.workflowId} className="need">
            <div className="q">
              <span className="lab">
                {waiting.length} {waiting.length === 1 ? "decision" : "decisions"} waiting · this one for {ago(r.startedAt)}
              </span>
              <b>
                {r.amountCents ? `${cents(Math.abs(r.amountCents))} ` : ""}
                {titleCase(r.title.split(" · ").slice(1).join(" · ")) || r.title} on {r.ref}
              </b>
              <span className="d">
                {name(r.agentId)}{r.vendorName ? ` · ${r.vendorName}` : ""}. {nextStep(r)}.
              </span>
            </div>
            <button type="button" className="btn primary" onClick={() => props.onNav(`#/agent/${r.agentId}/case/${r.workflowId}`)}>
              Review
            </button>
          </div>
        ))
      )}

      <section aria-label="Key figures" className="kpis">
        <Kpi label="Agents Live" value={`${m.kpis.agentsLive} of ${m.kpis.agentsTotal}`} sub={`${m.kpis.agentsTotal - m.kpis.agentsLive} on the roadmap`} />
        <Kpi label="Waiting on Others" value={m.kpis.waitingOnOthers} sub="Receipts and vendor replies" />
        <Kpi label="Stopped by a Rule" value={m.kpis.stoppedByRule24h} sub="Blocked or escalated, 24h" />
        <div className="panel kpi">
          <span className="lab">Model Spend</span>
          <b>{usd(m.kpis.spendUsd)}</b>
          <span className="s">of {usd(m.kpis.budgetUsd)} this period</span>
          <div className="track">
            <div style={{ width: `${pct}%` }} />
          </div>
        </div>
      </section>

      {m.value && m.value.cases > 0 && (
        <section aria-labelledby="ov-value" className="kpi-block">
          <h2 id="ov-value" className="lab">
            Invoice Resolver · Last {m.value.cases} Cases
          </h2>
          <div className="kpis">
            <Kpi label="Awaiting Decision" value={cents(m.value.awaitingDecisionCents)} sub="Value of the adjustments waiting on a person" />
            <Kpi label="Invoice Value Processed" value={cents(m.value.invoiceValueProcessedCents)} sub={`Across ${m.value.closed} closed cases`} />
            <Kpi label="Closed Without a Person" value={m.value.closed ? `${Math.round((100 * m.value.closedWithoutPerson) / m.value.closed)}%` : "–"} sub={`${m.value.closedWithoutPerson} of ${m.value.closed} closed cases`} />
            <Kpi label="Median Time to Proposal" value={m.value.medianSecondsToProposal == null ? "–" : `${Math.round(m.value.medianSecondsToProposal)}s`} sub="From the match to a proposed resolution" />
            <Kpi label="Cost per Case" value={usd(m.value.costPerCaseUsd, 4)} sub="Model spend per case worked" />
            {m.value.manualCostPerCaseUsd != null && m.value.costPerCaseUsd != null && (
              <Kpi label="Against Manual Processing" value={`${Math.round(m.value.manualCostPerCaseUsd / Math.max(m.value.costPerCaseUsd, 0.0001)).toLocaleString("en-US")}× lower`} sub={`Against ${usd(m.value.manualCostPerCaseUsd)} a case by hand, as configured`} />
            )}
          </div>
        </section>
      )}

      {m.runs.length > 0 && (
        <section className="panel card" aria-labelledby="ov-dist">
          <div className="row">
            <h2 id="ov-dist" className="lab">
              Where the Last {m.runs.length} Cases Ended Up
            </h2>
            <button type="button" className="link-btn" onClick={() => props.onNav("#/cases")}>
              All Cases ›
            </button>
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
          <table style={{ minWidth: 680 }}>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Status</th>
                <th className="num">Runs, 24h</th>
                <th className="num">Needs Decision</th>
                <th className="num">Evals</th>
                <th style={{ minWidth: 150 }}>Budget, 30 Days</th>
              </tr>
            </thead>
            <tbody>
              {live.map((a) => {
                const [cls, label] = STATUS[a.status];
                const p = a.spend?.budgetUsd ? Math.min(100, (100 * a.spend.spentUsd) / a.spend.budgetUsd) : 0;
                return (
                  <tr key={a.id} className="clickable" onClick={() => props.onNav(`#/agent/${a.id}`)}>
                    <td className="nm">
                      <button type="button" className="link-btn" onClick={() => props.onNav(`#/agent/${a.id}`)}>
                        {a.name}
                      </button>
                      <span style={{ display: "block" }}>{a.purpose}</span>
                    </td>
                    <td>
                      <span className={`tag ${cls}`}>{a.needsPerson ? `${a.needsPerson} Needs Decision` : label}</span>
                    </td>
                    <td className="num">{a.runs24h ?? "–"}</td>
                    <td className="num">{a.needsPerson}</td>
                    <td className="num">{a.evals?.rate ?? "Not run"}</td>
                    <td>
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
              On the roadmap
            </span>
            <div className="road">
              {planned.map((a) => (
                <button key={a.id} type="button" title={a.purpose} onClick={() => props.onNav(`#/agent/${a.id}`)}>
                  {a.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="ov-cols">
        <section className="panel" aria-labelledby="ov-events">
          <div className="panel-head">
            <h2 id="ov-events" className="lab">
              Stopped by a Rule
            </h2>
            <span className="muted" style={{ fontSize: 13.5 }}>
              Where a rule stopped an agent
            </span>
          </div>
          {m.events.length === 0 && <div className="empty">None in the recent runs.</div>}
          {m.events.map((e, i) => (
            <div key={i} className="event">
              <span className={`tag ${e.kind === "Allow-list" || e.kind === "Budget" ? "idle" : e.kind === "Threshold" ? "info" : "warn"}`}>{e.kind}</span>
              <div>{plain(e.text)}</div>
              <div className="muted" style={{ fontSize: 13.5 }}>
                {name(e.agentId)}
                {e.workflowId ? (
                  <>
                    {" · "}
                    <button type="button" className="link-btn" style={{ fontWeight: 500 }} onClick={() => props.onNav(`#/agent/${e.agentId}/case/${e.workflowId}`)}>
                      {e.workflowId.toUpperCase()}
                    </button>
                  </>
                ) : null}
                {" · "}
                {ago(e.at)} ago
              </div>
            </div>
          ))}
        </section>

        <section className="panel" aria-labelledby="ov-health">
          <div className="panel-head">
            <h2 id="ov-health" className="lab">
              Agent Health
            </h2>
            <span className={`tag ${down.length ? "warn" : "ok"}`}>{down.length ? `${down.length} Down` : "All Systems Healthy"}</span>
          </div>
          <details style={{ padding: "12px 22px 16px" }}>
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
