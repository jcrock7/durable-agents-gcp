import { useState } from "react";
import { titleCase, usd, type AnyState } from "./api.js";
import { useTabs } from "./tabs.js";

type Tab = "calls" | "skills" | "cost" | "guardrails";

/** The audit trail for one case: tool calls, skills, cost and guardrails (ADR-0021). The step strip on the case page replaces the old timeline tab. */
export function Inspector({ state, sourcesLabel = "Sources", caseWord = "Case" }: { state: AnyState; sourcesLabel?: string; caseWord?: string }) {
  const [tab, setTab] = useState<Tab>("calls");
  const [call, setCall] = useState(0);
  const calls: AnyState[] = state.toolCalls ?? [];
  const usage: AnyState[] = state.usage ?? [];
  const skills = Object.entries((state.skillVersions ?? {}) as Record<string, string>);
  const guards = guardrails(state, caseWord.toLowerCase(), sourcesLabel.toLowerCase());
  const tabs: Array<[Tab, string]> = [
    ["calls", `Tool Calls ${calls.length}`],
    ["skills", `Skills ${skills.length}`],
    ["cost", "Cost"],
    ["guardrails", "Guardrails"],
  ];
  const selected = calls[call];
  const t = useTabs("audit", tabs.map(([id]) => id), tab, setTab);

  return (
    <div className="content">
      <div {...t.list} aria-label="Audit trail" className="tabs" style={{ marginBottom: 14 }}>
        {tabs.map(([id, label]) => (
          <button key={id} type="button" {...t.tab(id)} className={`tab${tab === id ? " on" : ""}`}>
            {label}
          </button>
        ))}
      </div>
      <div {...t.panel}>
        {tab === "calls" &&
          (calls.length === 0 ? (
            <p className="muted">No tool calls yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ border: "1px solid var(--border)", borderRadius: 4, maxHeight: 320, overflow: "auto" }}>
                {calls.map((c, i) => (
                  <button key={i} type="button" className={`call${i === call ? " on" : ""}`} aria-pressed={i === call} onClick={() => setCall(i)}>
                    <span className="mono" style={{ fontSize: 13, flex: "1 1 auto", minWidth: 0, overflowWrap: "anywhere" }}>
                      {c.ref}
                    </span>
                    <span className="muted" style={{ fontSize: 13 }}>
                      {c.caller}
                    </span>
                    <span className={`tag ${c.outcome === "ok" ? "ok" : c.outcome === "refused" ? "warn" : "idle"}`} style={{ fontSize: 13 }}>
                      {titleCase(c.outcome)}
                    </span>
                    <span className="muted mono" style={{ fontSize: 13 }}>
                      {c.durationMs} ms
                    </span>
                  </button>
                ))}
              </div>
              {selected && (
                <div style={{ border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden" }}>
                  <div className="panel-head" style={{ background: "var(--surface-2)" }}>
                    <span className="mono" style={{ fontSize: 13 }}>
                      {selected.ref}
                    </span>
                    <span className="muted" style={{ fontSize: 13 }}>
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
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                Arguments are recorded for every call; the case keeps only the size of each result. Results the agent used as {sourcesLabel.toLowerCase()} are kept under {sourcesLabel} (cut at a length limit), and what each step returned is in the run’s engine history: Replay Run, then Engine History.
              </p>
            </div>
          ))}

        {tab === "skills" && (
          <div>
            {skills.map(([name, version]) => (
              <div key={name} className="row-line">
                <span className="mono" style={{ fontSize: 13 }}>
                  {name}
                </span>
                <span className="mono muted" style={{ fontSize: 13 }}>
                  v{version}
                </span>
              </div>
            ))}
            <p className="muted" style={{ margin: "10px 0 0", fontSize: 13 }}>
              Recorded on the run, so a later edit to a skill never changes how this case reads.
            </p>
          </div>
        )}

        {tab === "cost" && (
          <div>
            {usage.map((u, i) => (
              <div key={i} className="row-line">
                <span>{u.step}</span>
                <span className="mono muted" style={{ fontSize: 13 }}>
                  {u.model} · {(u.inputTokens ?? 0).toLocaleString()} in / {(u.outputTokens ?? 0).toLocaleString()} out
                </span>
                <span className="mono" style={{ fontSize: 13 }}>
                  {usd(u.costUsd, 4)}
                </span>
              </div>
            ))}
            <div className="row-line" style={{ fontWeight: 600, borderBottom: 0 }}>
              <span>This case</span>
              <span className="mono">{usd(usage.reduce((s, u) => s + (u.costUsd ?? 0), 0), 4)}</span>
            </div>
            <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
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
    </div>
  );
}

function guardrails(state: AnyState, unit: string, sources: string): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = [];
  // The screened document is the agent's own record (a field of its state); the words around it are neutral.
  const summary: string | undefined = state.invoice?.instructionsSummary;
  if (state.invoice && !state.invoice.containsInstructions) out.push(["Passed", "ok", `${titleCase(unit)} text screened for instructions addressed to the system.`]);
  if (state.invoice?.containsInstructions) out.push(["Blocked", "crit", `Instructions found in the ${unit}: ${summary || "unspecified"}`]);
  if (state.status === "blocked") out.push(["Blocked", "crit", (state.reasons ?? []).join("; ")]);
  for (const c of state.toolCalls ?? []) if (c.outcome === "refused") out.push(["Allow-list", "idle", `${c.ref} refused (${c.caller}).`]);
  for (const r of state.route?.reasons ?? []) out.push([r === "possible fraud" ? "Fraud" : "Rule", r === "possible fraud" ? "warn" : "info", r]);
  if (state.citationsValid === false) out.push(["Citations", "warn", `The proposal cites ${sources} that does not exist.`]);
  return out;
}
