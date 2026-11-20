// The agents the portal shows (ADR-0021). Built agents have a task queue and workflow types;
// the rest are listed as "Coming soon".

export interface AgentEntry {
  id: string;
  name: string;
  purpose: string;
  pattern: string;
  blurb: string;
  /** Avatar file under the web app's /avatars/. */
  avatar: string;
  built: boolean;
  taskQueue?: string;
  /** The workflow type that is one case, and the workflow id prefix of real (not eval) cases. */
  caseType?: string;
  casePrefix?: string;
  /** Query that returns the case's state. */
  stateQuery?: string;
  /** LiteLLM key alias that carries this agent's budget. */
  keyAlias?: string;
  tools: string[];
  models: string;
  /** Pass rate from the agent's latest eval run, with where it came from. */
  evals?: { rate: string; source: string };
}

export const AGENTS: AgentEntry[] = [
  {
    id: "invoice-exception-resolver",
    name: "Invoice Resolver",
    purpose: "Works invoices the ERP could not match",
    pattern: "Exception resolution",
    blurb: "Gathers evidence for unmatched invoices, proposes a fix, and asks before anything changes what gets paid.",
    avatar: "invoice-exception-resolver.svg",
    built: true,
    taskQueue: "invoice-exception-resolver",
    caseType: "resolveInvoiceException",
    casePrefix: "inv-",
    stateQuery: "caseState",
    keyAlias: "agent-invoice-exception-resolver",
    tools: ["erp-read", "erp-write", "docs", "match-engine"],
    models: "fast · smart",
    evals: { rate: "97.9%", source: "agents/general/invoice-exception-resolver/evals/RESULTS.md" },
  },
  {
    id: "cve-remediator",
    name: "Vulnerability Patcher",
    purpose: "Patches vulnerable dependencies by PR",
    pattern: "Remediation by pull request",
    blurb: "Finds services affected by a new advisory, patches and tests them in a sandbox, and opens a pull request for a person to merge.",
    avatar: "cve-remediator.svg",
    built: false,
    tools: ["github", "osv", "sandbox-runner"],
    models: "fast · smart",
  },
  {
    id: "audit-evidence-collector",
    name: "Audit Collector",
    purpose: "Screens evidence for IT controls",
    pattern: "Evidence screening at scale",
    blurb: "Pulls a control's population, screens every sampled item in parallel, and drafts a workpaper where each finding cites its source.",
    avatar: "audit-evidence-collector.svg",
    built: false,
    tools: ["github", "asset-inventory", "audit-logs"],
    models: "fast · smart",
  },
  {
    id: "finops-cost-sentinel",
    name: "Cost Sentinel",
    purpose: "Explains cloud and GPU spend",
    pattern: "Analysis and explanation",
    blurb: "Every Monday, explains what moved in cloud and GPU spend and why, and proposes a fix as a pull request.",
    avatar: "finops-cost-sentinel.svg",
    built: false,
    tools: ["bigquery", "github"],
    models: "fast · smart",
  },
  {
    id: "incident-commander",
    name: "Incident Commander",
    purpose: "Triages alerts and proposes fixes",
    pattern: "Monitor, diagnose, act",
    blurb: "Picks up an alert, correlates it with deploys, metrics and the runbook, and proposes the fix for the on-call person to approve.",
    avatar: "incident-commander.svg",
    built: false,
    tools: ["kubernetes", "prometheus", "grafana"],
    models: "fast · smart",
  },
  {
    id: "research-summarize",
    name: "Research Analyst",
    purpose: "Writes cited research briefs",
    pattern: "Platform reference agent",
    blurb: "The template agent: researches a question from allow-listed sources and writes a cited brief for review.",
    avatar: "research-summarize.svg",
    built: true,
    taskQueue: "research-summarize",
    caseType: "researchAndSummarize",
    casePrefix: "research-",
    stateQuery: "progress",
    keyAlias: "agent-research-summarize",
    tools: ["wikipedia (HTTP allow-list)"],
    models: "fast · smart",
  },
];

export const agentById = (id: string) => AGENTS.find((a) => a.id === id);
export const agentForWorkflow = (workflowId: string) => AGENTS.find((a) => a.casePrefix && workflowId.startsWith(a.casePrefix));

/** The MCP servers and platform services the portal reports on (Kubernetes object names). */
export const MCP_SERVERS = [
  { name: "mcp-erp-read", kind: "MCP Toolbox · read-only role" },
  { name: "mcp-erp-write", kind: "MCP Toolbox · workflow only" },
  { name: "mcp-docs", kind: "Custom · document store" },
  { name: "mcp-match-engine", kind: "Custom · HPA on CPU" },
];
