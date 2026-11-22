import { useEffect, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { caseHash, hashQuery, liveHash, setHashQuery } from "./routes.js";
import { useTabs } from "./tabs.js";
import { ago, caseGroup, caseTag, cents, costText, GROUP_LABEL, OPEN_GROUPS, plain, titleCase, usd, usePoll, type Agent, type CaseGroup, type CasePage, type CaseSummary } from "./api.js";

type Tab = "all" | "open" | CaseGroup;
type Sort = "age" | "amount" | "cost";
const ORDER: CaseGroup[] = ["needs", "waiting", "hold", "escalated", "running", "resolved", "cancelled", "closed"];
const PAGE = 50;

/** "INV-20267 · price variance" -> ["INV-20267", "Price Variance"]. */
function split(c: CaseSummary): [string, string] {
  if (c.agentId === "research-summarize") return [c.ref || c.workflowId, "Research Brief"];
  const [ref, ...rest] = c.title.split(" · ");
  return rest.length ? [c.ref || ref!, titleCase(rest.join(" · "))] : [c.ref || c.workflowId, c.title];
}

/** What happens next for a case, in plain words: its recorded reason when there is one, else its latest step. */
export const nextStep = (c: CaseSummary) =>
  c.agentId === "research-summarize" && c.needsPerson ? `Approve or send back ${c.detail}` : plain(c.reason && caseGroup(c) !== "resolved" ? c.reason : c.detail);

/** The case history: search, tabs by state, sortable columns, and one readable "what happens next" line per row. */
const SORTS: Sort[] = ["age", "amount", "cost"];

/** Open a row's case on a plain click; a click on a link, or with a modifier key, is left to the browser. */
function openRow(e: MouseEvent<HTMLTableRowElement>, href: string) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if ((e.target as HTMLElement).closest("a, button")) return;
  location.hash = href;
}

/** Arrow keys (or J and K) move between the rows' case links; Enter opens one. */
function moveRow(e: KeyboardEvent<HTMLTableSectionElement>) {
  const down = e.key === "ArrowDown" || e.key === "j";
  const up = e.key === "ArrowUp" || e.key === "k";
  if (!down && !up) return;
  const links = [...e.currentTarget.querySelectorAll<HTMLAnchorElement>("a.row-link")];
  const i = links.indexOf(document.activeElement as HTMLAnchorElement);
  if (i < 0) return;
  e.preventDefault();
  links[Math.max(0, Math.min(links.length - 1, i + (down ? 1 : -1)))]?.focus();
}

export function CaseTable(props: { agentId?: string; agents?: Agent[]; initial?: Tab; action?: ReactNode; empty?: ReactNode }) {
  // The tab, search and sort live in the hash query, so Back and a bookmark return to the same view.
  const [url] = useState(() => hashQuery());
  const fromUrl = <T extends string>(k: string, ok: readonly T[]): T | undefined => (ok.includes(url.get(k) as T) ? (url.get(k) as T) : undefined);
  const [tab, setTab] = useState<Tab>(() => fromUrl("tab", ["all", "open", ...ORDER] as Tab[]) ?? props.initial ?? "open");
  const [typed, setTyped] = useState(() => url.get("q") ?? "");
  const [q, setQ] = useState(() => (url.get("q") ?? "").trim());
  const [sort, setSort] = useState<Sort>(() => fromUrl("sort", SORTS) ?? "age");
  // The decision queue leads with the case that has waited longest; history leads with the newest.
  const defDir: "asc" | "desc" = props.initial === "needs" ? "asc" : "desc";
  const [dir, setDir] = useState<"asc" | "desc">(() => fromUrl("dir", ["asc", "desc"] as const) ?? defDir);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => {
    const t = setTimeout(() => setQ(typed.trim()), 250);
    return () => clearTimeout(t);
  }, [typed]);
  useEffect(() => {
    setHashQuery({ tab: tab === (props.initial ?? "open") ? undefined : tab, q: q || undefined, sort: sort === "age" ? undefined : sort, dir: dir === defDir ? undefined : dir });
  }, [tab, q, sort, dir, props.initial, defDir]);

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
  const inTab = cases.filter((c) => (tab === "all" ? true : tab === "open" ? OPEN_GROUPS.includes(caseGroup(c)) : caseGroup(c) === tab));
  // By age (the default) the queue leads with what needs a person; an explicit sort is left as the API returned it.
  // Rows follow the order the header names, exactly: no hidden grouping on top of it.
  const rows = inTab;
  const tabs: Array<[Tab, string, number]> = [
    ["open", "Open", cases.filter((c) => OPEN_GROUPS.includes(caseGroup(c))).length],
    ...ORDER.map((g): [Tab, string, number] => [g, GROUP_LABEL[g], count(g)]).filter(([g, , n]) => n > 0 || g === tab),
    ["all", "All", cases.length],
  ];
  const t = useTabs(`cases-${props.agentId ?? "all"}`, tabs.map(([id]) => id), tab, setTab);
  const agentName = (id: string) => props.agents?.find((a) => a.id === id)?.name ?? id;
  const header = (key: Sort, label: string, extra = "") => (
    <th className={`num ${extra}`.trim()} aria-sort={sort === key ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className="sort"
        onClick={() => {
          setDir(sort === key && dir === "desc" ? "asc" : "desc");
          setSort(key);
        }}
      >
        {label}
        {sort === key ? (key === "age" ? (dir === "asc" ? " · Oldest First" : " · Newest First") : dir === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );

  return (
    <>
      <div className="row" style={{ alignItems: "center" }}>
        <div {...t.list} aria-label="Cases by state" className="tabs">
          {tabs.map(([id, label, n]) => (
            <button key={id} type="button" {...t.tab(id)} className={`tab${tab === id ? " on" : ""}`}>
              {label} <em>{n}</em>
            </button>
          ))}
        </div>
        <label htmlFor="case-search" className="sr">
          Search cases
        </label>
        <input id="case-search" type="search" className="search" placeholder={props.agentId === "research-summarize" ? "Search by case" : "Search by case or vendor"} value={typed} onChange={(e) => setTyped(e.target.value)} />
        <label className="sort-pick">
          <span>Sort</span>
          <select
            value={`${sort}:${dir}`}
            onChange={(e) => {
              const [k, d] = e.target.value.split(":") as [Sort, "asc" | "desc"];
              setSort(k);
              setDir(d);
            }}
          >
            <option value="age:asc">Oldest first</option>
            <option value="age:desc">Newest first</option>
            <option value="amount:desc">Largest amount</option>
            <option value="cost:desc">Highest cost</option>
          </select>
        </label>
        {props.action}
      </div>
      {page.error && !shown && <div className="error">Could not load cases: {page.error}</div>}
      <div className="panel case-panel" style={{ padding: "6px 22px 10px" }} {...t.panel}>
        {!shown ? (
          <div className="empty">Loading cases…</div>
        ) : rows.length === 0 ? (
          <div className="empty">{q ? `No cases match “${q}” in this view.` : tab === "needs" ? "Nothing is waiting for a decision." : cases.length === 0 && props.empty ? props.empty : "No cases in this view."}</div>
        ) : (
          <div className="table-wrap">
            <table className="stacked">
              <thead>
                <tr>
                  <th>Case</th>
                  <th>{props.agents ? "Type · Agent" : "Type"}</th>
                  <th>Status</th>
                  <th style={{ minWidth: 240 }}>What Happens Next</th>
                  {header("amount", "Amount")}
                  {header("age", "Age")}
                  {header("cost", "Cost", "opt-col")}
                </tr>
              </thead>
              <tbody onKeyDown={moveRow}>
                {rows.map((c) => {
                  const [cls, label] = caseTag(c);
                  const [ref, kind] = split(c);
                  return (
                    <tr key={c.workflowId} className="clickable" onClick={(e) => openRow(e, caseHash(c.agentId, c.workflowId))}>
                      <td data-label="Case">
                        <a className="row-link" href={caseHash(c.agentId, c.workflowId)}>
                          {c.agentId === "research-summarize" ? c.title : ref}
                        </a>
                        {c.vendorName && <span className="sub">{c.vendorName}</span>}
                        {c.agentId === "research-summarize" && <span className="sub">Case {ref}</span>}
                      </td>
                      <td data-label="Type">
                        {kind}
                        {props.agents && <span className="sub">{agentName(c.agentId)}</span>}
                      </td>
                      <td data-label="Status">
                        <span className={`tag ${cls}`}>{label}</span>
                        {c.overridden && <span className="override-mark">Approved Against Policy</span>}
                        {c.temporalStatus === "RUNNING" && c.agentId === "invoice-exception-resolver" && !c.needsPerson && c.stage !== "waiting" && (
                          <a className="live-mark" href={liveHash(c.agentId, c.workflowId)} onClick={(e) => e.stopPropagation()} title="Watch this case run live">
                            Watch Live
                          </a>
                        )}
                      </td>
                      <td data-label="Next" style={{ color: "var(--text-2)" }}>
                        {nextStep(c)}
                      </td>
                      <td data-label="Amount" className={`num${c.amountCents ? "" : " empty-cell"}`}>
                        {c.amountCents ? cents(Math.abs(c.amountCents)) : "–"}
                      </td>
                      <td data-label="Age" className="num">
                        {ago(c.startedAt)}
                      </td>
                      <td data-label="Cost" className="num opt-col">
                        {costText(c)}
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
            {tab === "all"
              ? `Showing ${cases.length} of ${shown.total} ${q ? "Matching" : "Recent"} Cases`
              : `Showing ${rows.length} of ${cases.length} ${q ? "matching" : "recent"} cases · ${tabs.find(([id]) => id === tab)?.[1] ?? ""}`}
          </span>
          <span className="keys hide-narrow" aria-hidden="true">
            <kbd>↑</kbd> <kbd>↓</kbd> move between cases · <kbd>Enter</kbd> opens one
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
