import { useState } from "react";
import { usd, type AnyState } from "./api.js";

type Tab = "timeline" | "calls" | "skills" | "cost" | "guardrails";

/** Timeline, tool calls, skills, cost and guardrails for one case (ADR-0021). */
export function Inspector({ state }: { state: AnyState }) {
  const [tab, setTab] = useState<Tab>("timeline");
  const [call, setCall] = useState(0);
  const calls: AnyState[] = state.toolCalls ?? [];
  const usage: AnyState[] = state.usage ?? [];
  const skills = Object.entries((state.skillVersions ?? {}) as Record<string, string>);
  const guards = guardrails(state);
  const tabs: Array<[Tab, string]> = [
    ["timeline", "Timeline"],
    ["calls", `Tool calls ${calls.length}`],
    ["skills", `Skills ${skills.length}`],
    ["cost", "Cost"],
    ["guardrails", "Guardrails"],
  ];
  const selected = calls[call];

  return (
    <aside className="panel inspector" aria-labelledby="ins-h">
      <h2 id="ins-h" className="panel-title" style={{ padding: "10px 14px 0" }}>
        Inspector
      </h2>
      <div role="tablist" aria-label="Inspector" style={{ display: "flex", flexWrap: "wrap", padding: "0 6px", borderBottom: "1px solid var(--border)" }}>
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`tab tab-small${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="content">
        {tab === "timeline" && (
          <>
            <p className="muted" style={{ margin: "0 0 12px", fontSize: 12 }}>
              From the Temporal history of this run.
            </p>
            <ol className="timeline">
              {(state.timeline ?? []).map((t: AnyState, i: number) => (
                <li key={i}>
                  <div className="rail">
                    <span className={`tdot${t.state === "now" ? " now" : ""}`} />
                    <span className="tline" />
                  </div>
                  <div className="tbody">
                    <div className="tn">{t.name}</div>
                    <div className="td">
                      {new Date(t.at).toLocaleString()} {t.detail ? `· ${t.detail}` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}

        {tab === "calls" &&
          (calls.length === 0 ? (
            <p className="muted">No tool calls yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ border: "1px solid var(--border)", borderRadius: 4, maxHeight: 320, overflow: "auto" }}>
                {calls.map((c, i) => (
                  <button key={i} type="button" className={`call${i === call ? " on" : ""}`} onClick={() => setCall(i)}>
                    <span className="mono" style={{ fontSize: 12, flex: "1 1 auto", minWidth: 0, overflowWrap: "anywhere" }}>
                      {c.ref}
                    </span>
                    <span className="muted" style={{ fontSize: 11 }}>
                      {c.caller}
                    </span>
                    <span className={`tag ${c.outcome === "ok" ? "ok" : c.outcome === "refused" ? "warn" : "idle"}`} style={{ fontSize: 11 }}>
                      {c.outcome}
                    </span>
                    <span className="muted mono" style={{ fontSize: 11 }}>
                      {c.durationMs} ms
                    </span>
                  </button>
                ))}
              </div>
              {selected && (
                <div style={{ border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden" }}>
                  <div className="panel-head" style={{ background: "var(--surface-2)" }}>
                    <span className="mono" style={{ fontSize: 12 }}>
                      {selected.ref}
                    </span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      called by {selected.caller}
                    </span>
                  </div>
                  <pre className="detail">
                    {`args    ${JSON.stringify(selected.args, null, 2)}\noutcome ${selected.outcome}${selected.resultChars != null ? ` · ${selected.resultChars} characters` : ""} · ${selected.durationMs} ms${
                      selected.error ? `\nerror   ${selected.error}` : ""
                    }`}
                  </pre>
                </div>
              )}
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                Arguments are recorded for every call; results are kept as sizes only.
              </p>
            </div>
          ))}

        {tab === "skills" && (
          <div>
            {skills.map(([name, version]) => (
              <div key={name} className="row-line">
                <span className="mono" style={{ fontSize: 12 }}>
                  {name}
                </span>
                <span className="mono muted" style={{ fontSize: 12 }}>
                  v{version}
                </span>
              </div>
            ))}
            <p className="muted" style={{ margin: "10px 0 0", fontSize: 12 }}>
              Recorded on the run, so a later edit to a skill never changes how this case reads.
            </p>
          </div>
        )}

        {tab === "cost" && (
          <div>
            {usage.map((u, i) => (
              <div key={i} className="row-line">
                <span>{u.step}</span>
                <span className="mono muted" style={{ fontSize: 12 }}>
                  {u.model} · {(u.inputTokens ?? 0).toLocaleString()} in / {(u.outputTokens ?? 0).toLocaleString()} out
                </span>
                <span className="mono" style={{ fontSize: 12 }}>
                  {usd(u.costUsd, 4)}
                </span>
              </div>
            ))}
            <div className="row-line" style={{ fontWeight: 600, borderBottom: 0 }}>
              <span>This case</span>
              <span className="mono">{usd(usage.reduce((s, u) => s + (u.costUsd ?? 0), 0), 4)}</span>
            </div>
            <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
              As reported by the LiteLLM gateway, billed to this agent's own key.
            </p>
          </div>
        )}

        {tab === "guardrails" && (
          <div>
            {guards.length === 0 ? (
              <p className="muted">Nothing fired on this case.</p>
            ) : (
              guards.map(([kind, cls, text], i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                  <span className={`tag ${cls}`}>{kind}</span>
                  <span style={{ fontSize: 13, lineHeight: 1.45 }}>{text}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function guardrails(state: AnyState): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = [];
  if (state.invoice && !state.invoice.containsInstructions) out.push(["Passed", "ok", "Invoice text screened for instructions addressed to the system."]);
  if (state.invoice?.containsInstructions) out.push(["Blocked", "warn", `Instructions found in the invoice: ${state.invoice.instructionsSummary || "unspecified"}`]);
  if (state.status === "blocked") out.push(["Blocked", "warn", (state.reasons ?? []).join("; ")]);
  for (const c of state.toolCalls ?? []) if (c.outcome === "refused") out.push(["Allow-list", "idle", `${c.ref} refused (${c.caller}).`]);
  for (const r of state.route?.reasons ?? []) out.push([r === "possible fraud" ? "Fraud" : "Rule", r === "possible fraud" ? "warn" : "info", r]);
  if (state.citationsValid === false) out.push(["Citations", "warn", "The proposal cites evidence that does not exist."]);
  return out;
}
