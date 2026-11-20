import { useState } from "react";
import type { Agent, Mission } from "./api.js";
import { Chevrons, Flag, List, Logo, Radar } from "./icons.js";

const DOT: Record<Agent["status"], string> = { active: "#22C55E", needs_review: "#E39A1B", idle: "#9CA3AF", coming_soon: "#4B5563" };

export type View = "overview" | "needs" | "cases" | "agent";

const monogram = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** Primary navigation: overview, the decision queue, all cases, then the agents. */
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

  const agentRow = (a: Agent) => (
    <button
      key={a.id}
      type="button"
      className={`nav-item${view === "agent" && a.id === selected ? " current" : ""}${a.built ? "" : " soon"}`}
      aria-current={view === "agent" && a.id === selected ? "page" : undefined}
      aria-label={`${a.name}, ${a.built ? a.purpose : "on the roadmap"}${a.needsPerson ? `, ${a.needsPerson} need a decision` : ""}`}
      title={`${a.name} · ${a.built ? a.purpose : "On the roadmap"}`}
      onClick={() => props.onNav(`#/agent/${a.id}`)}
    >
      <span className="monogram" aria-hidden="true">
        {monogram(a.name)}
        <span className="dot" style={{ background: DOT[a.status] }} />
      </span>
      {!collapsed && <span className={`grow ${text}`}>{a.name}</span>}
      {!collapsed && a.needsPerson > 0 && <span className={`nav-count ${text}`}>{a.needsPerson}</span>}
    </button>
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

      <button type="button" className={`nav-item${view === "overview" ? " current" : ""}`} aria-current={view === "overview" ? "page" : undefined} title="Overview" onClick={() => props.onNav("#/overview")}>
        <Radar size={18} />
        {!collapsed && <span className={`grow ${text}`}>Overview</span>}
      </button>
      <button type="button" className={`nav-item${view === "needs" ? " current" : ""}`} aria-current={view === "needs" ? "page" : undefined} title="Needs Decision" onClick={() => props.onNav("#/cases/needs")}>
        <Flag />
        {!collapsed && <span className={`grow ${text}`}>Needs Decision</span>}
        {!collapsed && props.needPerson > 0 && <span className={`nav-count ${text}`}>{props.needPerson}</span>}
      </button>
      <button type="button" className={`nav-item${view === "cases" ? " current" : ""}`} aria-current={view === "cases" ? "page" : undefined} title="All Cases" onClick={() => props.onNav("#/cases")}>
        <List />
        {!collapsed && <span className={`grow ${text}`}>All Cases</span>}
      </button>

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

      <button type="button" className="side-foot" title={healthTitle || "Agent Health"} onClick={() => props.onNav("#/overview")}>
        <span className="health-dot" style={{ background: !props.platform ? "#9CA3AF" : down.length ? "#F97316" : "#22C55E" }} />
        {!collapsed && <span className={text}>Agent Health{down.length ? ` · ${down.length} down` : ""}</span>}
      </button>
    </nav>
  );
}
