import { useEffect, useState, type ReactNode } from "react";
import { ago, caseGroup, caseTag, cents, GROUP_LABEL, OPEN_GROUPS, plain, titleCase, usd, usePoll, type Agent, type CaseGroup, type CasePage, type CaseSummary } from "./api.js";

type Tab = "open" | CaseGroup;
type Sort = "age" | "amount" | "cost";
const ORDER: CaseGroup[] = ["needs", "waiting", "hold", "escalated", "running", "resolved", "cancelled", "closed"];
const PAGE = 50;

/** "INV-20267 · price variance" -> ["INV-20267", "Price Variance"]. */
function split(c: CaseSummary): [string, string] {
  const [ref, ...rest] = c.title.split(" · ");
  return rest.length ? [c.ref || ref!, titleCase(rest.join(" · "))] : [c.ref || c.workflowId, c.title];
}

/** What happens next for a case, in plain words: its recorded reason when there is one, else its latest step. */
export const nextStep = (c: CaseSummary) => plain(c.reason && caseGroup(c) !== "resolved" ? c.reason : c.detail);

/** The case history: search, tabs by state, sortable columns, and one readable "what happens next" line per row. */
export function CaseTable(props: { agentId?: string; agents?: Agent[]; initial?: Tab; action?: ReactNode; onOpen: (c: CaseSummary) => void }) {
  const [tab, setTab] = useState<Tab>(props.initial ?? "open");
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("age");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => {
    const t = setTimeout(() => setQ(typed.trim()), 250);
    return () => clearTimeout(t);
  }, [typed]);

  const params = new URLSearchParams({ sort, dir, limit: String(limit) });
  if (props.agentId) params.set("agent", props.agentId);
  if (q) params.set("q", q);
  const page = usePoll<CasePage>(`/api/cases?${params}`, 5_000);
  // Keep showing the last page while the next query loads, so typing does not blank the table.
  const [shown, setShown] = useState<CasePage>();
  useEffect(() => {
    if (page.data) setShown(page.data);
  }, [page.data]);

  const cases = shown?.cases ?? [];
  const count = (g: CaseGroup) => cases.filter((c) => caseGroup(c) === g).length;
  const inTab = cases.filter((c) => (tab === "open" ? OPEN_GROUPS.includes(caseGroup(c)) : caseGroup(c) === tab));
  // By age (the default) the queue leads with what needs a person; an explicit sort is left as the API returned it.
  const rows = sort === "age" && dir === "desc" ? [...inTab].sort((a, b) => ORDER.indexOf(caseGroup(a)) - ORDER.indexOf(caseGroup(b))) : inTab;
  const tabs: Array<[Tab, string, number]> = [["open", "Open", cases.filter((c) => OPEN_GROUPS.includes(caseGroup(c))).length], ...ORDER.map((g): [Tab, string, number] => [g, GROUP_LABEL[g], count(g)]).filter(([g, , n]) => n > 0 || g === tab)];
  const agentName = (id: string) => props.agents?.find((a) => a.id === id)?.name ?? id;
  const header = (key: Sort, label: string) => (
    <th className="num" aria-sort={sort === key ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className="sort"
        onClick={() => {
          setDir(sort === key && dir === "desc" ? "asc" : "desc");
          setSort(key);
        }}
      >
        {label} {sort === key ? (dir === "asc" ? "↑" : "↓") : ""}
      </button>
    </th>
  );

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
        <label htmlFor="case-search" className="sr">
          Search cases
        </label>
        <input id="case-search" type="search" className="search" placeholder="Search by case or vendor" value={typed} onChange={(e) => setTyped(e.target.value)} />
        {props.action}
      </div>
      {page.error && !shown && <div className="error">Could not load cases: {page.error}</div>}
      <div className="panel" style={{ padding: "6px 22px 10px" }}>
        {!shown ? (
          <div className="empty">Loading cases…</div>
        ) : rows.length === 0 ? (
          <div className="empty">{q ? `No cases match “${q}” in this view.` : tab === "needs" ? "Nothing is waiting for a decision." : "No cases in this view."}</div>
        ) : (
          <div className="table-wrap">
            <table className="stacked">
              <thead>
                <tr>
                  <th>Case</th>
                  {props.agents && <th>Agent</th>}
                  <th>Type</th>
                  <th>Status</th>
                  <th style={{ minWidth: 240 }}>What Happens Next</th>
                  {header("amount", "Amount")}
                  {header("age", "Age")}
                  {header("cost", "Cost")}
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const [cls, label] = caseTag(c);
                  const [ref, kind] = split(c);
                  return (
                    <tr key={c.workflowId} className="clickable" onClick={() => props.onOpen(c)}>
                      <td data-label="Case">
                        <button type="button" className="link-btn" onClick={() => props.onOpen(c)}>
                          {ref}
                        </button>
                        {c.vendorName && <span className="sub">{c.vendorName}</span>}
                      </td>
                      {props.agents && <td data-label="Agent">{agentName(c.agentId)}</td>}
                      <td data-label="Type">{kind}</td>
                      <td data-label="Status">
                        <span className={`tag ${cls}`}>{label}</span>
                      </td>
                      <td data-label="Next" style={{ color: "var(--text-2)" }}>
                        {nextStep(c)}
                      </td>
                      <td data-label="Amount" className="num">
                        {c.amountCents ? cents(Math.abs(c.amountCents)) : "–"}
                      </td>
                      <td data-label="Age" className="num">
                        {ago(c.startedAt)}
                      </td>
                      <td data-label="Cost" className="num">
                        {usd(c.costUsd, 4)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {shown && (
        <div className="row muted" style={{ fontSize: 13.5, alignItems: "center" }}>
          <span>
            Showing {cases.length} of {shown.total} {q ? "Matching" : "Recent"} Cases
          </span>
          {cases.length < shown.total && limit < 200 && (
            <button type="button" className="btn sm" onClick={() => setLimit(Math.min(200, limit + PAGE))}>
              Load More
            </button>
          )}
        </div>
      )}
    </>
  );
}
