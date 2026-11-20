import { useCallback, useEffect, useState } from "react";
import { usePoll, type Agent, type Mission } from "./api.js";
import { AgentView } from "./AgentView.js";
import { CaseTable } from "./CaseTable.js";
import { Overview } from "./Overview.js";
import { Sidebar, type View } from "./Sidebar.js";
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

interface Route {
  view: View;
  agent?: string;
  case?: string;
}

/** Routes: #/overview · #/cases · #/cases/needs · #/agent/<agentId>[/case/<workflowId>] */
function readHash(): Route {
  const m = /^#\/agent\/([a-z0-9-]+)(?:\/case\/([a-z0-9-]+))?/.exec(location.hash);
  if (m) return { view: "agent", agent: m[1], case: m[2] };
  if (location.hash.startsWith("#/cases/needs")) return { view: "needs" };
  if (location.hash.startsWith("#/cases")) return { view: "cases" };
  return { view: "overview" };
}

export function App() {
  const agents = usePoll<Agent[]>("/api/agents", 5_000);
  const [route, setRoute] = useState(readHash);
  const mission = usePoll<Mission>("/api/mission", route.view === "agent" ? 30_000 : 5_000);
  const me = usePoll<{ user: string }>("/api/me", 600_000);
  const [theme, setTheme] = useState(() => store.get("theme") ?? (matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  const [collapsed, setCollapsed] = useState(() => store.get("sidebar") === "collapsed");

  useEffect(() => {
    const onHash = () => {
      setRoute(readHash());
      scrollTo(0, 0);
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  const nav = useCallback((hash: string) => {
    location.hash = hash;
  }, []);

  const list = agents.data ?? [];
  const agent = route.view === "agent" ? list.find((a) => a.id === route.agent) : undefined;
  const onCase = useCallback((id: string | null) => agent && nav(`#/agent/${agent.id}${id ? `/case/${id}` : ""}`), [agent, nav]);
  const user = me.data?.user ?? "…";
  const crumb = (label: string, hash?: string) =>
    hash ? (
      <button type="button" className="link-btn" style={{ fontWeight: 400, color: "inherit" }} onClick={() => nav(hash)}>
        {label}
      </button>
    ) : (
      <b>{label}</b>
    );

  return (
    <div className="app" data-theme={theme}>
      <Sidebar
        agents={list}
        view={route.view}
        selected={agent?.id ?? ""}
        collapsed={collapsed}
        needPerson={list.reduce((s, a) => s + a.needsPerson, 0)}
        platform={mission.data?.platform}
        onToggle={() => {
          store.set("sidebar", collapsed ? "open" : "collapsed");
          setCollapsed(!collapsed);
        }}
        onNav={nav}
      />
      <div className="main">
        <header className="topbar">
          <nav aria-label="Breadcrumb" className="crumbs">
            {route.view === "overview" && crumb("Overview")}
            {route.view === "cases" && crumb("All Cases")}
            {route.view === "needs" && crumb("Needs Decision")}
            {route.view === "agent" && (
              <>
                {crumb("Agents", "#/overview")} <span aria-hidden="true">/</span> {route.case ? crumb(agent?.name ?? "…", `#/agent/${route.agent}`) : crumb(agent?.name ?? "…")}
                {route.case ? (
                  <>
                    {" "}
                    <span aria-hidden="true">/</span> {crumb(route.case.toUpperCase())}
                  </>
                ) : null}
              </>
            )}
          </nav>
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
          <span className="user-chip" title="Profile and settings" aria-label={`Signed in as ${user}`}>
            <Person />
            {user}
          </span>
        </header>

        {agents.error && !agents.data && (
          <div className="error" style={{ margin: "20px 28px 0" }}>
            Cannot reach the portal API: {agents.error}
          </div>
        )}
        {route.view === "overview" && (
          <main className="page">
            <Overview mission={mission.data} agents={list} onNav={nav} />
          </main>
        )}
        {(route.view === "cases" || route.view === "needs") && (
          <main className="page">
            <CaseTable key={route.view} cases={mission.data?.runs} agents={list} initial={route.view === "needs" ? "needs" : "open"} onOpen={(c) => nav(`#/agent/${c.agentId}/case/${c.workflowId}`)} />
            {mission.data && (
              <div className="muted" style={{ fontSize: 13.5 }}>
                {mission.data.runs.length} Recent Cases
              </div>
            )}
          </main>
        )}
        {route.view === "agent" && agent && <AgentView key={agent.id} agent={agent} me={user} caseId={route.case ?? null} onCase={onCase} />}
        {route.view === "agent" && !agent && agents.data && (
          <div className="page">
            <div className="panel empty">No agent called “{route.agent}”.</div>
          </div>
        )}

        <footer className="site-foot">
          <span>This site uses synthetic data.</span>
          <span>Agent Operations</span>
        </footer>
      </div>
    </div>
  );
}
