// The agents the portal shows (ADR-0021). Built agents have a task queue and workflow types;
// the rest are listed as "Coming soon".
import { agentConfig as invoiceConfig } from "@agents/invoice-exception-resolver/config";

/**
 * The words an agent's own screens use (docs/design/agent-portal/agent-screen-guidelines.md).
 * Anything left out falls back to the neutral word; screens that list several agents use neutral words only.
 */
export interface Vocabulary {
  /** One unit of work, singular and plural: "Invoice", "Brief", "Incident". */
  case: string;
  cases: string;
  /** What the agent gathered to support its proposal, and one item of it. */
  sources: string;
  source: string;
  /** Prefix of a citation tag: E1, S1, F1. */
  citePrefix: string;
  /** The ruled table of the case's figures. */
  figures: string;
  /** Where a rule stopped the agent or a person overrode one. */
  ruleStops: string;
  /** What the agent proposes. */
  proposal: string;
  /** The approve button when no write-specific label applies. */
  approve: string;
  /** The rule a ◇ mark checks a figure against. */
  ruleName: string;
  /** Who takes an escalated case. */
  specialist: string;
  /** The other party on a case (a vendor, a service owner), when there is one. */
  counterparty: string;
  searchHint: string;
  sendBackHint: string;
  escalateHint: string;
}

/** Which shared blocks an agent's case page shows, in order, in the main column and the margin column. */
export interface Layout {
  case: { main: string[]; margin: string[] };
}

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
  evals?: { rate: string; source: string; passed?: number; total?: number };
  /** The agent's configured clocks, read from its config so the portal never restates them. */
  schedule?: {
    /** Days a proposal waits for a reviewer before the case expires to a specialist. */
    reviewDays: number;
    /** Waiting for a goods receipt: reminder days and the day the case escalates. */
    receipt?: { reminderDays: number[]; escalateDays: number };
  };
  /** The fixed checks that can stop this agent, each enforced in code or at the gateway. */
  guardrails?: string[];
  /** The approval rules, for explaining why a person is needed. */
  approval?: { amountCents: number; alwaysFor: string[] };
  /** This agent's words for the shared components; the rest fall back to neutral words. */
  vocabulary?: Partial<Vocabulary>;
  /** The page recipe for this agent's case page, built from shared blocks only. */
  layout?: Layout;
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
    guardrails: [
      "Invoice text is screened for hidden instructions before the proposal; a hit stops the run",
      "Tools come from an allow-list; ERP writes are made only by the workflow, never by the model",
      "Model calls go through the gateway, which enforces the agent's budget and checks for prompt injection",
    ],
    tools: ["erp-read", "erp-write", "docs", "match-engine"],
    models: "fast · smart",
    evals: { rate: "97.9%", passed: 92, total: 94, source: "agents/general/invoice-exception-resolver/evals/RESULTS.md" },
    schedule: { reviewDays: invoiceConfig.review.days, receipt: { reminderDays: [...invoiceConfig.wait.reminderDays], escalateDays: invoiceConfig.wait.escalateDays } },
    approval: { amountCents: invoiceConfig.approval.amountCents, alwaysFor: [...invoiceConfig.approval.alwaysFor] },
    vocabulary: {
      case: "Invoice", cases: "Invoices", sources: "Evidence", source: "Evidence Item", citePrefix: "E",
      figures: "Schedule A", ruleStops: "Exceptions Noted", proposal: "Proposed Resolution", approve: "Approve and Post to ERP",
      ruleName: "the approval line", specialist: "AP Specialist", counterparty: "Vendor",
      searchHint: "Search by case or vendor",
      sendBackHint: "Tell the agent what to do instead, e.g. ask the vendor for a credit memo",
      escalateHint: "What the specialist should check, e.g. the buyer should confirm this price with the vendor",
    },
    layout: { case: { main: ["figures", "proposal", "sources", "message"], margin: ["legend", "stops", "run", "recheck"] } },
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
    vocabulary: {
      case: "Vulnerability", cases: "Vulnerabilities", sources: "Findings", source: "Finding", citePrefix: "F",
      figures: "Exposure", ruleStops: "Policy Blocks", proposal: "Proposed Patch", approve: "Approve and Open PR",
      ruleName: "the severity threshold", specialist: "Security Engineer", counterparty: "Service Owner",
    },
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
    vocabulary: {
      case: "Incident", cases: "Incidents", sources: "Signals", source: "Signal", citePrefix: "G",
      figures: "Impact", ruleStops: "Guardrail Stops", proposal: "Proposed Fix", approve: "Approve and Run",
      ruleName: "the change window", specialist: "On-call Engineer", counterparty: "Service",
    },
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
    guardrails: [
      "Fetches only from en.wikipedia.org",
      "Model calls go through the gateway, which enforces the agent's budget and checks for prompt injection",
    ],
    tools: ["wikipedia (HTTP allow-list)"],
    models: "fast · smart",
    vocabulary: {
      case: "Brief", cases: "Briefs", sources: "Sources", source: "Source", citePrefix: "S",
      figures: "Coverage", ruleStops: "Held for Review", proposal: "Draft Brief", approve: "Approve Brief",
      ruleName: "the citation rule", searchHint: "Search by case or question",
      sendBackHint: "Tell the agent what to change in the brief",
    },
    layout: { case: { main: ["proposal", "sources"], margin: ["legend", "figures", "run"] } },
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
