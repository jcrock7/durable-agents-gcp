import type { Agent, Mission } from "./api.js";
import { Chevrons, Logo, Radar } from "./icons.js";

const DOT: Record<Agent["status"], string> = { active: "#22C55E", needs_review: "#F97316", idle: "#9CA3AF", coming_soon: "#4B5563" };

export function Sidebar(props: {
  agents: Agent[];
  selected: string;
  collapsed: boolean;
  needPerson: number;
  platform?: Mission["platform"];
  onToggle: () => void;
  onSelect: (id: string) => void;
  onMission: () => void;
}) {
  const { agents, selected, collapsed } = props;
  const healthy = props.platform?.every((p) => p.ok !== false);
  return (
    <nav aria-label="Agents" className={`sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="side-top">
        {!collapsed && (
          <div className="brand">
            <Logo />
            Agent Operations
          </div>
        )}
        <button type="button" className="icon-btn" onClick={props.onToggle} aria-label={collapsed ? "Expand agent list" : "Collapse agent list"} title={collapsed ? "Expand agent list" : "Collapse agent list"}>
          <Chevrons flip={collapsed} />
        </button>
      </div>

      <button type="button" className="command-btn" onClick={props.onMission} aria-label="Open Mission Control" title="Mission Control">
        <Radar />
        {!collapsed && (
          <>
            <span style={{ flex: "1 1 auto", textAlign: "left" }}>Mission Control</span>
            {props.needPerson > 0 && <span className="command-badge">{props.needPerson} need you</span>}
          </>
        )}
      </button>

      {!collapsed && (
        <div className="side-label">
          <span>Agents</span>
          <span>{agents.length}</span>
        </div>
      )}
      <div className="agent-list">
        {agents.map((a) => {
          const soon = a.status === "coming_soon";
          return (
            <button
              key={a.id}
              type="button"
              className={`agent-row${a.id === selected ? " current" : ""}${soon ? " soon" : ""}`}
              aria-current={a.id === selected ? "page" : undefined}
              aria-label={`${a.name}, ${soon ? "coming soon" : a.purpose}${a.needsPerson ? `, ${a.needsPerson} need you` : ""}`}
              title={`${a.name} · ${soon ? "Coming soon" : a.purpose}`}
              onClick={() => props.onSelect(a.id)}
            >
              <span className="avatar-wrap">
                <img src={`/avatars/${a.avatar}`} alt="" />
                <span className="dot" style={{ background: DOT[a.status] }} />
                {a.needsPerson > 0 && <span className="badge">{a.needsPerson}</span>}
              </span>
              {!collapsed && (
                <span className="agent-text">
                  <span className="n">{a.name}</span>
                  <span className="p">{soon ? "Coming soon" : a.purpose}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="side-foot">
        {collapsed ? (
          <div title={healthy ? "Platform healthy" : "Platform degraded"} style={{ display: "flex", justifyContent: "center" }}>
            <span className="health-dot" style={{ width: 10, height: 10, background: healthy ? "#22C55E" : "#F97316" }} />
          </div>
        ) : (
          (props.platform ?? []).map((p) => (
            <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="health-dot" style={{ background: p.ok === null ? "#9CA3AF" : p.ok ? "#22C55E" : "#F97316" }} />
              {p.name} {p.ok === null ? "unknown" : p.ok ? "healthy" : "down"}
            </div>
          ))
        )}
      </div>
    </nav>
  );
}
