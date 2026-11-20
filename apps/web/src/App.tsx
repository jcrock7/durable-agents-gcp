import { useCallback, useEffect, useState } from "react";
import { usePoll, type Agent, type Mission } from "./api.js";
import { AgentView } from "./AgentView.js";
import { MissionControl } from "./MissionControl.js";
import { Sidebar } from "./Sidebar.js";
import { Moon, Person, Sun } from "./icons.js";

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode: keep it in memory only */
    }
  },
};

/** Route: #/agent/<agentId>[/case/<workflowId>] */
function readHash(): { agent?: string; case?: string } {
  const m = /^#\/agent\/([a-z0-9-]+)(?:\/case\/([a-z0-9-]+))?/.exec(location.hash);
  return m ? { agent: m[1], case: m[2] } : {};
}

export function App() {
  const agents = usePoll<Agent[]>("/api/agents", 5_000);
  const [missionOpen, setMissionOpen] = useState(false);
  const mission = usePoll<Mission>("/api/mission", missionOpen ? 5_000 : 30_000);
  const me = usePoll<{ user: string }>("/api/me", 600_000);
  const [theme, setTheme] = useState(() => store.get("theme") ?? (matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  const [collapsed, setCollapsed] = useState(() => store.get("sidebar") === "collapsed");
  const [route, setRoute] = useState(readHash);

  useEffect(() => {
    const onHash = () => setRoute(readHash());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  const go = useCallback((agent: string, workflowId?: string | null) => {
    location.hash = `#/agent/${agent}${workflowId ? `/case/${workflowId}` : ""}`;
  }, []);

  const list = agents.data ?? [];
  const agent = list.find((a) => a.id === route.agent) ?? list.find((a) => a.built) ?? list[0];
  const onCase = useCallback((id: string | null) => agent && go(agent.id, id), [agent, go]);

  return (
    <div className="app" data-theme={theme}>
      <Sidebar
        agents={list}
        selected={agent?.id ?? ""}
        collapsed={collapsed}
        needPerson={list.reduce((s, a) => s + a.needsPerson, 0)}
        platform={mission.data?.platform}
        onToggle={() => {
          store.set("sidebar", collapsed ? "open" : "collapsed");
          setCollapsed(!collapsed);
        }}
        onSelect={(id) => go(id)}
        onMission={() => setMissionOpen(true)}
      />
      <div className="main">
        <header className="topbar">
          <nav aria-label="Breadcrumb" className="crumbs">
            Agents <span aria-hidden="true">/</span> {agent?.name ?? "…"}
            {route.case ? (
              <>
                {" "}
                <span aria-hidden="true">/</span> <span className="mono" style={{ color: "var(--text)" }}>{route.case}</span>
              </>
            ) : null}
          </nav>
          <span className="chip mono">synthetic data</span>
          <button
            type="button"
            className="top-btn"
            onClick={() => {
              const next = theme === "dark" ? "light" : "dark";
              store.set("theme", next);
              setTheme(next);
            }}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </button>
          <span className="user" title={me.data?.user ?? ""} aria-label={`Signed in as ${me.data?.user ?? "unknown"}`}>
            <Person />
          </span>
        </header>
        {agents.error && !agents.data && <div className="error">Cannot reach the portal API: {agents.error}</div>}
        {agent && <AgentView key={agent.id} agent={agent} me={me.data?.user ?? "unknown"} caseId={route.agent === agent.id ? (route.case ?? null) : null} onCase={onCase} />}
      </div>
      {missionOpen && (
        <MissionControl
          mission={mission.data}
          agents={list}
          onClose={() => setMissionOpen(false)}
          onOpen={(agentId, workflowId) => {
            setMissionOpen(false);
            go(agentId, workflowId);
          }}
        />
      )}
    </div>
  );
}
