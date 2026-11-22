import { useState } from "react";
import type { Agent, Mission } from "./api.js";
import { Chevrons, Flag, List, Logo, Radar } from "./icons.js";

export type View = "overview" | "needs" | "cases" | "agent";

const monogram = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** Primary navigation: overview, the decision queue, all cases, then the agents. Every item is a link, so it opens in a new tab too. */
export function Sidebar(props: {
  agents: Agent[];
  view: View;
  selected: string;
  collapsed: boolean;
  needPerson: number;
  platform?: Mission["platform"];
  onToggle: () => void;
  onNav: (hash: string) => void;
}) {
  const { agents, view, selected, collapsed } = props;
  const [roadmap, setRoadmap] = useState(false);
  const live = agents.filter((a) => a.built);
  const planned = agents.filter((a) => !a.built);
  const down = (props.platform ?? []).filter((p) => p.ok === false);
  const healthTitle = (props.platform ?? []).map((p) => `${p.name}: ${p.ok === null ? "unknown" : p.ok ? "healthy" : "down"}`).join("\n");
  const text = collapsed ? "" : "hide-narrow";
  // The phone layout shows the rail as a strip; these short names sit under its icons there.
  const short = (label: string) => (
    <span className="phone-label" aria-hidden="true">
      {label}
    </span>
  );

  const agentRow = (a: Agent) => (
    <a
      key={a.id}
      href={`#/agent/${a.id}`}
      className={`nav-item${view === "agent" && a.id === selected ? " current" : ""}${a.built ? "" : " soon"}`}
      aria-current={view === "agent" && a.id === selected ? "page" : undefined}
      aria-label={`${a.name}, ${a.built ? a.purpose : "on the roadmap"}${a.needsPerson ? `, ${a.needsPerson} ${a.needsPerson === 1 ? "decision" : "decisions"} waiting` : ""}`}
      title={`${a.name} · ${a.built ? a.purpose : "On the roadmap"}`}
    >
      <span className="monogram" aria-hidden="true">
        {monogram(a.name)}
        <span className={`dot s-${a.status}`} />
      </span>
      {!collapsed && <span className={`grow ${text}`}>{a.name}</span>}
      {short(a.name.split(/\s+/)[0]!)}
      {a.needsPerson > 0 && (
        <span className="nav-count" aria-hidden="true">
          {a.needsPerson}
        </span>
      )}
    </a>
  );

  return (
    <nav aria-label="Primary" className={`sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="side-top">
        {!collapsed && (
          <div className={`brand ${text}`}>
            <Logo />
            Agent Operations
          </div>
        )}
        <button type="button" className="icon-btn" onClick={props.onToggle} aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} title={collapsed ? "Expand navigation" : "Collapse navigation"}>
          <Chevrons flip={collapsed} />
        </button>
      </div>

      <a href="#/overview" className={`nav-item${view === "overview" ? " current" : ""}`} aria-current={view === "overview" ? "page" : undefined} title="Overview">
        <Radar size={18} />
        {!collapsed && <span className={`grow ${text}`}>Overview</span>}
        {short("Overview")}
      </a>
      <a href="#/cases/needs" className={`nav-item${view === "needs" ? " current" : ""}`} aria-current={view === "needs" ? "page" : undefined} title="Needs Decision" aria-label={`Needs Decision${props.needPerson ? `, ${props.needPerson} waiting` : ""}`}>
        <Flag />
        {!collapsed && <span className={`grow ${text}`}>Needs Decision</span>}
        {short("Decide")}
        {props.needPerson > 0 && (
          <span className="nav-count" aria-hidden="true">
            {props.needPerson}
          </span>
        )}
      </a>
      <a href="#/cases" className={`nav-item${view === "cases" ? " current" : ""}`} aria-current={view === "cases" ? "page" : undefined} title="All Cases">
        <List />
        {!collapsed && <span className={`grow ${text}`}>All Cases</span>}
        {short("Cases")}
      </a>

      {!collapsed && <div className={`side-label ${text}`}>Agents</div>}
      {live.map(agentRow)}

      {planned.length > 0 && !collapsed && (
        <button type="button" className={`side-label ${text}`} aria-expanded={roadmap} onClick={() => setRoadmap(!roadmap)}>
          <span>Roadmap</span>
          <span>
            {planned.length} {roadmap ? "–" : "+"}
          </span>
        </button>
      )}
      {(roadmap || planned.some((a) => view === "agent" && a.id === selected)) && planned.map(agentRow)}

      <a
        href="#/overview/health"
        className="side-foot"
        title={healthTitle || "Agent Health"}
        aria-label={`Agent Health${!props.platform ? "" : down.length ? `, ${down.length} down` : ", all healthy"}`}
        onClick={(e) => {
          // The same hash fires no hashchange: reopen the panel directly.
          if (location.hash === "#/overview/health" && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            props.onNav("#/overview/health");
          }
        }}
      >
        <span className={`health-dot ${!props.platform ? "unknown" : down.length ? "down" : "ok"}`} aria-hidden="true" />
        {!collapsed && <span className={text}>Agent Health{down.length ? ` · ${down.length} down` : ""}</span>}
        {short("Health")}
      </a>
    </nav>
  );
}
