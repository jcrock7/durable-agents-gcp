# ADR-0019: Agent portfolio by pattern: five agents built on work we know

- **Status:** Proposed. Supersedes [ADR-0017](0017-prototype-agent-portfolio.md)
- **Date:** 2026-11-18

## Context

[ADR-0017](0017-prototype-agent-portfolio.md) chose five financial-services agents. Two problems surfaced:

- **Domain claims we can't back up.** Each business case rests on industry volumes, handling times and labor rates that this project has no way to validate. A reader who knows the domain will test those claims quickly. Healthcare and manufacturing ideas raised later had the same problem, plus data that is licensed or doesn't exist publicly (payer criteria, plant systems).
- **The industries hide the reusable part.** Grouped by underlying pattern, nine candidate agents across three industries reduce to five shapes. What the platform proves (durable multi-day runs, governed tool calls, deterministic checks next to model judgment, human approval, cost per run) is the same in every industry.

Selection rules:

- **Buildable today.** Only open-source tools, public datasets, synthetic data, and accounts this project already has. No licensed datasets, no GPU quota, no third-party systems we can't run ourselves.
- **Honest scope.** Each agent works in an area where the work and its rules are publicly documented or are engineering work we do ourselves. No invented industry value models.
- **Enterprise-credible.** Governed execution, least-privilege tools, auditable tool calls and visible human approval, shown in the demo, including what happens when a rule blocks the agent.
- **Synthetic data only, assist don't decide.** Unchanged from ADR-0017.

## Decision

Build **one agent per pattern** (five in total). Each agent is a template plus configuration: workflow, prompts, skills, a tool allow-list and limits. Carrying a pattern to another industry means swapping skills and tools, not rewriting the agent.

| # | Pattern | Agent | Folder | What it does | Why it's credible |
|---|---|---|---|---|---|
| 1 | **Exception resolution** (document intake and assembly) | Invoice Exception Resolver | `agents/general/invoice-exception-resolver` | Works the invoices an ERP's three-way match rejects: classifies the mismatch, gathers evidence from documents and email, proposes a resolution, chases the vendor, routes anything over threshold to a person | Three-way match and its exception types are publicly documented and the same in every industry |
| 2 | **Remediation by pull request** | CVE Remediator | `agents/technology/cve-remediator` | Finds a vulnerable dependency, upgrades it, runs the tests in a sandbox, opens a pull request with the evidence | Engineering work we do ourselves |
| 3 | **Evidence screening at scale** | Audit Evidence Collector | `agents/general/audit-evidence-collector` | Collects IT general controls evidence (access reviews, change approvals, deploy records), tests it against written control rules, flags gaps, assembles an audit packet | The controls are IT controls over systems we run; the control vocabulary is public |
| 4 | **Analysis and explanation** | FinOps Cost Sentinel | `agents/technology/finops-cost-sentinel` | Explains cost changes, attributes spend to owners, flags idle compute and GPU spend, proposes rightsizing by pull request behind an approval gate | Our own cloud bill, plus published FOCUS-format sample data for scale |
| 5 | **Monitor, diagnose, act** | Incident Commander | `agents/technology/incident-commander` | Correlates an alert with recent deploys and config changes, maps the blast radius, proposes a rollback a person approves, drafts the timeline and postmortem | Engineering work we do ourselves, on an open-source demo app with injected faults |

**Build order:** 1 → 2 → 3 → 4 → 5.

1. **Invoice Exception Resolver first.** It needs nothing outside this project, exercises nearly every platform feature (deterministic tools, document intake, multi-day waits, approval, injection hidden in a document, cost per case) and becomes the template the other four copy. Design: [its README](../../agents/general/invoice-exception-resolver/README.md).
2. **CVE Remediator** adds the GitHub tools and the sandboxed test runner.
3. **Audit Evidence Collector** reuses the GitHub tools and treats the CVE Remediator's pull requests as change-management evidence.
4. **FinOps Cost Sentinel** adds BigQuery and the billing export.
5. **Incident Commander** needs the most extra infrastructure (an observability stack, a demo app and a fault injector), so it comes last.

### What every demo shows

- **The boundary, not just the happy path.** Each demo deliberately triggers a block: a guardrail rejection, an exhausted budget, a tool outside the allow-list, or an amount over the approval threshold.
- **Inspectable tool calls.** Which server and tool ran, with what arguments and what came back, from the Temporal history and the trace.
- **Tools and skills kept apart.** Tools give access to systems and actions. Skills hold the judgment: the rules for what counts as an acceptable variance or a failed control ([ADR-0020](0020-mcp-tools-and-skills.md)).
- **Simple, defensible measures.** Cycle time, manual touches, exceptions caught, cost per case. No invented dollar figures.

### What happens to the other ideas

- **Financial-services agents (ADR-0017).** Their business cases stay as **example applications** of these patterns, with the unvalidated value models removed. Example: the AML Alert Investigator is pattern 3 with different evidence sources and skills.
- **Healthcare and manufacturing.** Each industry README lists how the five patterns carry over. Nothing is built until a specific need calls for it.
- **Ideas needing resources we don't have** stay out until the resource exists. Examples: GPU visual inspection (needs GPU quota) and payer prior authorization (needs licensed criteria and a mock payer).

Shared controls and cost assumptions are unchanged from ADR-0017.

## Alternatives considered

| Option | Why not (for now) |
|---|---|
| Keep the five financial-services agents (ADR-0017) | Value rests on domain figures this project can't validate |
| Three agents per industry (healthcare, manufacturing, technology) | Several need licensed data, GPU quota or systems we can't run. The domain depth needed is too much to back up honestly |
| Purely generic agents with no concrete scenario | Hard to demo and measure. Each pattern needs one real scenario |
| Contract redlining, M&A diligence, deal-desk agents | All value is in legal, corporate-development or sales judgment we would have to invent |
| Data-catalog steward | Credible, but needs a catalog and lineage stack first. Revisit if data-platform work becomes the focus |
| Legacy modernization planner | Strong idea, but output is a plan that's hard to verify. Natural follow-on to the CVE Remediator, which shares its tools |

## Consequences

- **Positive:**
  - Every agent can be built and demonstrated with what exists today.
  - Claims stay within what can be backed up.
  - One template agent sets the shape for the rest.
  - Industry fit is shown by swapping configuration, which is itself a demo.
- **Negative / risks:**
  - Less industry-specific polish.
  - Three of five agents sit in engineering work, so the business-facing story rests on the invoice and audit agents.
  - ERP vendors ship their own AI assistants for exception handling, so the invoice agent is presented as a governed-agent pattern across systems, not as a product.
- **Revisit when:** The first two agents are built, or a specific need calls for an industry scenario that one of the patterns can't cover.
