# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two evaluators, often in the same room, and the portal has to hold up to both:

- **Evaluating executive.** A Fortune 100 or private equity business leader judging whether AI agents can be trusted with real operational work. They watch or click through a demo, follow one case end to end, and ask what the agent did, why, what it cost, and what happens if they approve.
- **Technical leader.** A CTO, architect or head of platform checking that the claims are real: durable runs, rules that stop an agent, budgets, evals, tool access, audit trail. They drill into the detail the executive skips.

The person acting inside the portal during a demo plays a business reviewer (for example an AP controller deciding an invoice exception). That role is the vehicle for the demonstration, not a separate confirmed audience.

## Product Purpose

Agent Operations is the portal of "Durable Agents on GCP", a public reference architecture for AI agents that finish the job safely and on budget. The portal makes the platform's properties visible on working agents: what each agent did step by step, the evidence and policy behind its recommendation, where a rule stopped it, where a person decided, and what it cost.

Success: an executive can follow an agent's work on one case without help and trusts the decision they are asked to make; a technical leader can verify each claim by drilling into real run data and finds nothing staged.

## Positioning

A working reference, not a mock-up. Every case, step, cost and rule stop on screen comes from a real workflow run against the platform (Temporal for durability, a single model gateway for budgets and routing, deterministic routing rules and a human approval gate before any write). The same screen serves the business story and the technical proof.

## Operating Context

- Used as a reference demo over the next year: shown live to prospects and peers, and read by people who clone the public repository. It is not run against real company systems.
- All data is synthetic, and the portal says so on every page.
- Runs on a local k3d cluster or a disposable GKE environment created and destroyed with Terraform; one public entry point behind Google sign-in (IAP).
- Viewed on laptops and projected or shared screens, including lower-resolution ones; a phone layout exists.
- Agents today: Invoice Resolver (invoice exception resolution with three-way match, AP resolution policy, approval, waits) and Research Analyst (cited research briefs). Further agents are listed as roadmap.

## Capabilities and Constraints

Confirmed functionality:

- Overview: decisions waiting, key figures, business figures from real cases, where cases ended up, agents, rule stops, Agent Health.
- Case queue: Needs Decision and All Cases, with search, sort and paging.
- Case page: decision first, step strip with drill-down, recommendation with cited evidence, policy text for the version the run used, policy-fit verdict, options weighed, audit trail.
- Decisions: approve, send back to the agent with feedback, escalate to a specialist with a note.
- Agent pages with settings, evals, budget; roadmap agent pages.

Constraints:

- The browser does not parse documents or infer business facts; facts come from the API.
- Policy-fit and routing verdicts are deterministic workflow code, not model output.
- Workflow changes must stay replay-safe for in-flight runs.
- One name per status across the portal (for example "Needs Decision", "Cancelled").
- Labels in titles, tabs, headings and buttons use title case.
- Stack is settled by the codebase: React and Vite served by a Fastify API, TypeScript.

Undecided:

- The portal name "Agent Operations" and the agent names are in use but were not confirmed as binding.
- Whether the portal will later be deployed against real client systems.

## Brand Commitments

- **Human approves writes.** Nothing an agent proposes changes a system of record until a person approves it, and the page always states what approving, sending back or escalating will do.
- **No invented figures.** Every number comes from a real run or is labelled as configured. Synthetic data is disclosed on every page.
- **Plain business language.** Labels and explanations are written for finance and operations leaders; technical detail sits behind a drill-down, where it must be exact enough for a technical leader.

## Evidence on Hand

- Live portal with real runs of the invoice and research agents (synthetic ERP, vendor documents and messages).
- Labelled eval set and results for the Invoice Resolver.
- Per-case and per-agent model spend from the gateway.
- AP resolution policy skill, versioned (`agents/general/invoice-exception-resolver/skills/`).
- Architecture brief (`docs/architecture.html`), decision records (`docs/adr/`), portal design record (`docs/adr/0021-agent-portal-ui.md`, `docs/design/agent-portal/`), UI gaps design (`docs/superpowers/specs/2026-11-19-portal-ui-gaps-design.md`).

Absent, and not to be fabricated: customers, testimonials, production deployments, benchmarks against other products, pricing, and savings claims. The manual-processing cost comparison appears only when a value is configured, and is labelled as configured.

## Product Principles

1. **Tell the case as a story.** A reader should be able to follow what was found, what the agent did, why it recommends this, and what happens next, in that order.
2. **Decision first, proof one click away.** Lead with what the person must decide; keep the evidence, policy and trace within one drill-down.
3. **Show where the agent stopped.** Rule stops, conflicts with policy, holds and escalations are the product, not edge cases to hide.
4. **Two readers, one truth.** The business summary and the technical detail describe the same recorded facts; neither is simplified into something untrue.
5. **Say only what the run recorded.** If the data does not exist, show its absence instead of a placeholder.
