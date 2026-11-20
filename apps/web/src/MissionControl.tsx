import { useEffect, useRef } from "react";
import { ago, caseTag, usd, type Agent, type Mission } from "./api.js";
import { Close, Radar } from "./icons.js";

/** The fleet overlay (ADR-0021): platform health, key figures, agents, runs, boundary events, MCP servers. */
export function MissionControl(props: { mission?: Mission; agents: Agent[]; onClose: () => void; onOpen: (agentId: string, workflowId?: string) => void }) {
  const { mission: m, agents } = props;
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  const avatar = (id: string) => agents.find((a) => a.id === id)?.avatar ?? "research-summarize.svg";
  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? id;

  return (
    <div className="scrim">
      <div role="dialog" aria-modal="true" aria-labelledby="mc-h" className="dialog" onKeyDown={(e) => e.key === "Escape" && props.onClose()}>
        <div className="dialog-head">
          <span style={{ color: "var(--accent)" }}>
            <Radar size={22} />
          </span>
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <h2 id="mc-h" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
              Mission Control
            </h2>
            <div className="muted" style={{ fontSize: 12 }}>
              Live from Temporal, LiteLLM and the cluster · refreshes every 5 seconds
            </div>
          </div>
          <button ref={closeRef} type="button" className="top-btn" onClick={props.onClose} aria-label="Close Mission Control">
            <Close />
          </button>
        </div>

        {!m ? (
          <div className="empty">Loading…</div>
        ) : (
          <div className="dialog-body">
            <section aria-labelledby="mc-plat" className="panel strip">
              <h3 id="mc-plat" className="panel-title">
                Platform
              </h3>
              {m.platform.map((p) => (
                <span key={p.name} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                  {p.name} <span className={`tag ${p.ok === null ? "idle" : p.ok ? "ok" : "warn"}`}>{p.ok === null ? "Unknown" : p.ok ? "Healthy" : "Down"}</span>
                </span>
              ))}
            </section>

            <section aria-label="Key figures" className="panel kpis">
              <Kpi label="Agents live" value={`${m.kpis.agentsLive} of ${m.kpis.agentsTotal}`} sub={`${m.kpis.agentsTotal - m.kpis.agentsLive} coming soon`} />
              <Kpi label="Need a person" value={m.kpis.needPerson} sub={m.kpis.oldestWaitingSince ? `Oldest started ${ago(m.kpis.oldestWaitingSince)} ago` : "None waiting"} warn={m.kpis.needPerson > 0} />
              <Kpi label="Waiting on others" value={m.kpis.waitingOnOthers} sub="Receipts and replies" />
              <Kpi label="Stopped by a rule, 24h" value={m.kpis.stoppedByRule24h} sub="Blocked or escalated" />
              <Kpi label="Spend this period" value={usd(m.kpis.spendUsd)} sub={`of ${usd(m.kpis.budgetUsd)} across live agent keys`} />
            </section>

            <div className="mc-cols">
              <div className="mc-main">
                <section className="panel" aria-labelledby="mc-agents">
                  <div className="panel-head">
                    <h3 id="mc-agents" className="panel-title">
                      Agents
                    </h3>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ minWidth: 720 }}>
                      <thead>
                        <tr>
                          <th>Agent</th>
                          <th>Status</th>
                          <th style={{ textAlign: "right" }}>Runs, 24h</th>
                          <th style={{ textAlign: "right" }}>Need you</th>
                          <th style={{ textAlign: "right" }}>Evals</th>
                          <th>Budget</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {agents.map((a) => (
                          <tr key={a.id}>
                            <td>
                              <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                                <img src={`/avatars/${a.avatar}`} alt="" style={{ width: 28, height: 28, borderRadius: "50%" }} />
                                <span>
                                  <span style={{ display: "block", fontWeight: 600 }}>{a.name}</span>
                                  <span className="muted" style={{ display: "block", fontSize: 12 }}>
                                    {a.purpose}
                                  </span>
                                </span>
                              </span>
                            </td>
                            <td>
                              <span className={`tag ${a.status === "needs_review" ? "warn" : a.status === "active" ? "ok" : "idle"}`}>{a.status === "coming_soon" ? "Coming soon" : a.status.replace("_", " ")}</span>
                            </td>
                            <td style={{ textAlign: "right" }}>{a.runs24h ?? "–"}</td>
                            <td style={{ textAlign: "right" }}>{a.built ? a.needsPerson : "–"}</td>
                            <td style={{ textAlign: "right" }}>{a.evals?.rate ?? "–"}</td>
                            <td className="mono" style={{ fontSize: 12 }}>
                              {a.spend ? `${usd(a.spend.spentUsd)} / ${usd(a.spend.budgetUsd)}` : "Not built yet"}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <button type="button" className="btn" style={{ minHeight: 36, padding: "0 12px", fontSize: 13 }} onClick={() => props.onOpen(a.id)}>
                                Open
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="panel" aria-labelledby="mc-runs">
                  <div className="panel-head">
                    <h3 id="mc-runs" className="panel-title">
                      Recent runs
                    </h3>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ minWidth: 720 }}>
                      <thead>
                        <tr>
                          <th>Run</th>
                          <th>Agent</th>
                          <th>Status</th>
                          <th>Latest step</th>
                          <th>Age</th>
                          <th style={{ textAlign: "right" }}>Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {m.runs.map((r) => {
                          const [cls, label] = caseTag(r);
                          return (
                            <tr key={r.workflowId}>
                              <td className="mono" style={{ fontSize: 12 }}>
                                <button type="button" className="link-btn mono" onClick={() => props.onOpen(r.agentId, r.workflowId)}>
                                  {r.workflowId}
                                </button>
                              </td>
                              <td>
                                <span style={{ display: "flex", gap: 8, alignItems: "center", whiteSpace: "nowrap" }}>
                                  <img src={`/avatars/${avatar(r.agentId)}`} alt="" style={{ width: 20, height: 20, borderRadius: "50%" }} />
                                  {name(r.agentId)}
                                </span>
                              </td>
                              <td>
                                <span className={`tag ${cls}`}>{label}</span>
                              </td>
                              <td style={{ fontSize: 12 }}>{r.detail}</td>
                              <td className="muted" style={{ fontSize: 12 }}>
                                {ago(r.startedAt)}
                              </td>
                              <td className="mono" style={{ textAlign: "right", fontSize: 12 }}>
                                {usd(r.costUsd, 4)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>

              <aside className="mc-side">
                <section className="panel" aria-labelledby="mc-events">
                  <div className="panel-head">
                    <h3 id="mc-events" className="panel-title">
                      Boundary events
                    </h3>
                    <span className="muted" style={{ fontSize: 12 }}>
                      Where a rule stopped an agent
                    </span>
                  </div>
                  {m.events.length === 0 && <div className="empty">None in the recent runs.</div>}
                  {m.events.map((e, i) => (
                    <div key={i} className="event">
                      <img src={`/avatars/${avatar(e.agentId)}`} alt="" />
                      <div style={{ minWidth: 0 }}>
                        <span className={`tag ${e.kind === "Allow-list" || e.kind === "Budget" ? "idle" : e.kind === "Threshold" ? "info" : "warn"}`}>{e.kind}</span>
                        <div style={{ fontSize: 13, marginTop: 4 }}>{e.text}</div>
                        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                          {name(e.agentId)}
                          {e.workflowId ? ` · ${e.workflowId}` : ""} · {ago(e.at)} ago
                        </div>
                      </div>
                    </div>
                  ))}
                </section>

                <section className="panel" aria-labelledby="mc-servers">
                  <div className="panel-head">
                    <h3 id="mc-servers" className="panel-title">
                      MCP servers
                    </h3>
                    <span className="muted" style={{ fontSize: 12 }}>
                      Ready replicas and autoscaling
                    </span>
                  </div>
                  {m.servers.map((s) => (
                    <div key={s.name} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: "2px 8px", padding: "8px 14px", borderBottom: "1px solid var(--border)" }}>
                      <div className="mono" style={{ fontSize: 13 }}>
                        {s.name}
                      </div>
                      <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
                        {s.hpa ? `${s.ready} (${s.hpa.min}–${s.hpa.max})` : `${s.ready} / ${s.replicas}`}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {s.kind}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {s.hpa?.cpuPercent != null ? `CPU ${s.hpa.cpuPercent}% of request` : ""}
                      </div>
                    </div>
                  ))}
                </section>
              </aside>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, warn }: { label: string; value: string | number; sub: string; warn?: boolean }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12 }}>
        {label}
      </div>
      <div className="v" style={warn ? { color: "var(--warn)" } : undefined}>
        {value}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
        {sub}
      </div>
    </div>
  );
}
