import { useState, type ReactNode } from "react";
import { ago, caseGroup, caseTag, GROUP_LABEL, OPEN_GROUPS, plain, titleCase, usd, type Agent, type CaseGroup, type CaseSummary } from "./api.js";

type Tab = "open" | CaseGroup;
const ORDER: CaseGroup[] = ["needs", "waiting", "hold", "escalated", "running", "resolved", "cancelled", "closed"];

/** "INV-20267 · price variance" -> ["INV-20267", "Price Variance"]. */
function split(c: CaseSummary): [string, string] {
  const [ref, ...rest] = c.title.split(" · ");
  return rest.length ? [c.ref || ref!, titleCase(rest.join(" · "))] : [c.ref || c.workflowId, c.title];
}

/** The case queue: tabs by state, one readable "what happens next" line per row. */
export function CaseTable(props: { cases: CaseSummary[] | undefined; agents?: Agent[]; initial?: Tab; action?: ReactNode; onOpen: (c: CaseSummary) => void }) {
  const [tab, setTab] = useState<Tab>(props.initial ?? "open");
  const cases = props.cases ?? [];
  const count = (g: CaseGroup) => cases.filter((c) => caseGroup(c) === g).length;
  const rows = cases.filter((c) => (tab === "open" ? OPEN_GROUPS.includes(caseGroup(c)) : caseGroup(c) === tab)).sort((a, b) => ORDER.indexOf(caseGroup(a)) - ORDER.indexOf(caseGroup(b)));
  const tabs: Array<[Tab, string, number]> = [["open", "Open", cases.filter((c) => OPEN_GROUPS.includes(caseGroup(c))).length], ...ORDER.map((g): [Tab, string, number] => [g, GROUP_LABEL[g], count(g)]).filter(([g, , n]) => n > 0 || g === tab)];
  const agentName = (id: string) => props.agents?.find((a) => a.id === id)?.name ?? id;

  return (
    <>
      <div className="row" style={{ alignItems: "center" }}>
        <div role="tablist" aria-label="Cases by state" className="tabs">
          {tabs.map(([id, label, n]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`tab${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>
              {label} <em>{n}</em>
            </button>
          ))}
        </div>
        {props.action}
      </div>
      <div className="panel" style={{ padding: "6px 22px 10px" }}>
        {!props.cases ? (
          <div className="empty">Loading cases…</div>
        ) : rows.length === 0 ? (
          <div className="empty">{tab === "needs" ? "Nothing is waiting for a decision." : "No cases in this view."}</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Case</th>
                  {props.agents && <th>Agent</th>}
                  <th>Type</th>
                  <th>Status</th>
                  <th style={{ minWidth: 260 }}>What Happens Next</th>
                  <th className="num">Age</th>
                  <th className="num">Cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const [cls, label] = caseTag(c);
                  const [ref, kind] = split(c);
                  return (
                    <tr key={c.workflowId} className="clickable" onClick={() => props.onOpen(c)}>
                      <td>
                        <button type="button" className="link-btn" onClick={() => props.onOpen(c)}>
                          {ref}
                        </button>
                      </td>
                      {props.agents && <td>{agentName(c.agentId)}</td>}
                      <td>{kind}</td>
                      <td>
                        <span className={`tag ${cls}`}>{label}</span>
                      </td>
                      <td style={{ color: "var(--text-2)" }}>{plain(c.detail)}</td>
                      <td className="num">{ago(c.startedAt)}</td>
                      <td className="num">{usd(c.costUsd, 4)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
