import { useCallback, useEffect, useRef, useState } from "react";
import { usePoll, type Agent, type Me, type Mission } from "./api.js";
import { AgentView } from "./AgentView.js";
import { CaseTable } from "./CaseTable.js";
import { Overview, showHealth } from "./Overview.js";
import { LiveRun } from "./live/LiveRun.js";
import { caseHash, parseHash, type Route } from "./routes.js";
import { Sidebar } from "./Sidebar.js";
import { DOCS } from "./docs.js";
import { Person } from "./icons.js";
import { Glossary } from "./Glossary.js";

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

const readHash = (): Route => parseHash(location.hash);

type ThemeChoice = "light" | "dark" | "system";
const THEMES: Array<[ThemeChoice, string]> = [
  ["light", "Light"],
  ["dark", "Dark"],
  ["system", "System"],
];
const systemDark = () => matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

export function App() {
  const agents = usePoll<Agent[]>("/api/agents", 5_000);
  const [route, setRoute] = useState(readHash);
  const mission = usePoll<Mission>("/api/mission", route.view === "overview" ? 5_000 : 30_000);
  const me = usePoll<Me>("/api/me", 600_000);
  const [choice, setChoice] = useState<ThemeChoice>(() => (store.get("theme") as ThemeChoice | null) ?? "system");
  const [dark, setDark] = useState(systemDark);
  const [collapsed, setCollapsed] = useState(() => store.get("sidebar") === "collapsed");
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The open case's reference (INV-…), reported by the case page; the workflow id is never shown as its name.
  const [caseRef, setCaseRef] = useState<{ workflowId: string; ref: string }>();
  const onCaseRef = useCallback((workflowId: string, ref: string) => setCaseRef({ workflowId, ref }), []);

  useEffect(() => {
    const onHash = () => {
      const next = readHash();
      setRoute(next);
      if (!next.health) scrollTo(0, 0);
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    const mq = matchMedia?.("(prefers-color-scheme: dark)");
    const on = () => setDark(mq.matches);
    mq?.addEventListener("change", on);
    return () => mq?.removeEventListener("change", on);
  }, []);
  useEffect(() => {
    if (!menu) return;
    // Opening moves focus into the panel; Escape closes it and returns focus to the button.
    panelRef.current?.querySelector<HTMLElement>("button, a")?.focus();
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key !== "Escape") return;
        setMenu(false);
        chipRef.current?.focus();
      } else if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    addEventListener("mousedown", close);
    addEventListener("keydown", close);
    return () => {
      removeEventListener("mousedown", close);
      removeEventListener("keydown", close);
    };
  }, [menu]);
  const nav = useCallback((hash: string) => {
    // Same hash fires no hashchange, so a second click on Agent Health reopens the panel directly.
    if (hash === "#/overview/health" && location.hash === hash) showHealth();
    location.hash = hash;
  }, []);

  const openRef = route.case && caseRef?.workflowId === route.case ? caseRef.ref : undefined;
  const pageName =
    route.view === "overview" ? "Overview" : route.view === "cases" ? "All Cases" : route.view === "needs" ? "Needs Decision" : route.case ? (openRef ? `Case ${openRef}` : "Case") : ((agents.data ?? []).find((a) => a.id === route.agent)?.name ?? "Agent");
  useEffect(() => {
    document.title = `${pageName} · Agent Operations`;
  }, [pageName]);

  const theme = choice === "system" ? (dark ? "dark" : "light") : choice;
  const list = agents.data ?? [];
  const agent = route.view === "agent" ? list.find((a) => a.id === route.agent) : undefined;
  const onCase = useCallback((id: string | null) => agent && nav(`#/agent/${agent.id}${id ? `/case/${id}` : ""}`), [agent, nav]);
  const user = me.data?.user ?? "…";
  // Links, not buttons: a crumb opens in a new tab like any link.
  const crumb = (label: string, hash?: string) =>
    hash ? (
      <a className="crumb" href={hash}>
        {label}
      </a>
    ) : (
      <b aria-current="page">{label}</b>
    );
  const live = route.view === "agent" && Boolean(route.case && route.live);

  return (
    <div className="app" data-theme={theme}>
      <Sidebar
        agents={list}
        view={route.view}
        selected={agent?.id ?? ""}
        collapsed={collapsed || live}
        needPerson={list.reduce((s, a) => s + a.needsPerson, 0)}
        platform={mission.data?.platform}
        onToggle={() => {
          store.set("sidebar", collapsed ? "open" : "collapsed");
          setCollapsed(!collapsed);
        }}
        onNav={nav}
      />
      <div className="main">
        <a
          className="skip"
          href="#content"
          onClick={(e) => {
            // The router uses the hash, so move focus without changing it.
            e.preventDefault();
            document.getElementById("content")?.focus();
          }}
        >
          Skip to Main Content
        </a>
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
                    <span aria-hidden="true">/</span> {crumb(openRef ? `Case ${openRef}` : "Case")}
                  </>
                ) : null}
              </>
            )}
          </nav>
          <div className="menu-wrap" ref={menuRef}>
            <button ref={chipRef} type="button" className="user-chip" aria-expanded={menu} aria-controls="user-panel" aria-label={`Signed in as ${user}. Profile and settings`} onClick={() => setMenu(!menu)}>
              <Person />
              <span className="user-name">{user}</span>
            </button>
            {menu && (
              <div className="menu" id="user-panel" ref={panelRef} role="group" aria-label="Profile and settings">
                <div className="menu-id">
                  <span className="lab">Signed In As</span>
                  <b>{user}</b>
                  <span className="muted">{me.data?.source === "iap" ? "Through your organisation’s sign-in" : "Local development identity"}</span>
                </div>
                <div className="menu-sec">
                  <span className="lab">Theme</span>
                  <div className="seg" role="radiogroup" aria-label="Theme">
                    {THEMES.map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={choice === id}
                        className={choice === id ? "on" : ""}
                        onClick={() => {
                          store.set("theme", id);
                          setChoice(id);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {me.data?.source === "iap" && (
                  <a className="menu-link" href="/_gcp_iap/clear_login_cookie">
                    Sign Out
                  </a>
                )}
              </div>
            )}
          </div>
        </header>

        {agents.error && !agents.data && (
          <div className="error" style={{ margin: "20px 28px 0" }}>
            {agents.error}
          </div>
        )}
        <div id="content" tabIndex={-1} className="content">
        {route.view === "overview" && (
          <main className="page">
            <h1 className="sr">Overview</h1>
            <Overview mission={mission.data} agents={list} health={route.health ?? false} onNav={nav} />
          </main>
        )}
        {(route.view === "cases" || route.view === "needs") && (
          <main className="page">
            <h1 className="sr">{pageName}</h1>
            <CaseTable key={route.view} agents={list} initial={route.view === "needs" ? "needs" : "open"} />
          </main>
        )}
        {route.view === "agent" && agent && (
          <AgentView key={agent.id} agent={agent} me={user} demoControls={me.data?.demoControls ?? false} temporalUiUrl={me.data?.temporalUiUrl} caseId={route.case ?? null} onCase={onCase} onNav={nav} onCaseRef={onCaseRef} />
        )}
        {route.view === "agent" && !agent && agents.data && (
          <div className="page">
            <div className="panel empty">No agent called “{route.agent}”.</div>
          </div>
        )}

        {route.view === "agent" && route.case && route.live && (
          <LiveRun
            key={route.case}
            agentId={route.agent!}
            agentName={agent?.name}
            schedule={agent?.schedule}
            workflowId={route.case}
            demoControls={me.data?.demoControls ?? false}
            temporalUiUrl={me.data?.temporalUiUrl}
            onBack={() => nav(caseHash(route.agent!, route.case!))}
          />
        )}

        </div>
        <footer className="site-foot">
          <span>This site uses synthetic data.</span>
          <span className="foot-links">
            <a href={DOCS.architecture} target="_blank" rel="noreferrer">
              Architecture Brief ↗
            </a>
            <a href={DOCS.adrs} target="_blank" rel="noreferrer">
              Decision Records ↗
            </a>
            <Glossary />
            <span>Agent Operations</span>
          </span>
        </footer>
      </div>
    </div>
  );
}
