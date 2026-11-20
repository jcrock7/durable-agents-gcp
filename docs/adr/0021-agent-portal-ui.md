# ADR-0021: Agent portal UI: per-agent case workspace, Mission Control overlay, collapsible agent sidebar

- **Status:** Accepted
- **Date:** 2026-11-19

## Context

The application roadmap item "API + review UI" ([ADR-0013](0013-consolidated-workloads.md): the API serves the UI) needs a design before it is built. The portal has to show, for each agent in [ADR-0019](0019-pattern-agent-portfolio.md), the things the platform exists to demonstrate: durable runs that survive restarts and wait days without holding a worker, human approval before anything changes a system, rules that stop an agent (guardrails, allow-lists, budgets, thresholds), cost per case and per agent, which MCP tools and skill versions were used ([ADR-0020](0020-mcp-tools-and-skills.md)), and servers scaling on GKE.

Common patterns in agent operations consoles, from vendor and practitioner write-ups rather than independent research: separate surfaces for observing, deciding and intervening; runs grouped by status that drill into a step-by-step trace; an approval inbox where only high-risk items interrupt; inspectable tool calls; and showing where the agent stopped, not only the happy path.

Three directions were mocked: a fleet dashboard (observe first), an approval inbox (decide first) and a case workspace (work product first).

## Decision

One portal with three parts. The full specification, theme tokens and avatar files are in [`docs/design/agent-portal/`](../design/agent-portal/).

| Part | What it is |
|---|---|
| **Agent sidebar** | Collapsible left rail listing every agent with its avatar, short name, purpose, a status dot and a count of cases that need a person. Collapsed, it shows avatars only. Agents not yet built are listed as **Coming soon** |
| **Agent screen** | The case workspace, per agent: an agent header (pattern, runs, eval pass rate, budget, MCP servers, models), the agent's case list, and the selected case: proposal with cited evidence, the approval rule that applies, actions, and a box to steer the case. An inspector shows the Temporal timeline, tool calls with arguments and results, skill versions, cost per step and guardrail events |
| **Mission Control** | A large overlay opened from the sidebar: platform health first, then key figures, all agents, runs by status, boundary events (where a rule stopped an agent) and MCP server replicas |

Visual language: dense, flat enterprise styling (IBM Plex Sans and Mono, 4px corners, thin borders, squared status tags, tables over cards), one blue accent, and light and dark themes from a single token set. Each agent has a gummy-blob avatar in its own color, holding a prop that shows its job, so agents are distinguishable without relying on color alone.

## Alternatives considered

| Option | Why not (for now) |
|---|---|
| Fleet dashboard as the home page | Good for operators, but it hides the work product. Kept as the Mission Control overlay |
| Approval inbox as the home page | Good for approvers, but it shows one decision at a time and little of how the agent got there. Approvals stay on the agent screen and the "need you" counts |
| Chat-first interface | Hides durable state, approvals and tool calls behind a transcript; the agents here are workflows, not chat sessions |
| People photos or illustrated people as avatars | Implies real people; the agents are software. Robot avatars were tried and read as cold |

## Consequences

- **Positive:** Every platform feature has a fixed place to appear, so each agent's demo shows the same things in the same spots. Adding an agent means adding a sidebar entry and its data, not a new screen.
- **Negative / risks:** The design has only been drawn as mocks with sample data; real data may not fill every panel (for example, agents with no approvals). The mocks have not had a usability test or an accessibility audit.
- **Revisit when:** the first agent is wired to the real API, or once the portal has been used with real runs.

## Amendment, 2026-11-20: decision-first layout

The portal was used with real runs and reviewed for executive and finance audiences (the "revisit when" above). The review found that the layout served the people who built the agent: the approval sat below the evidence, the overview was an overlay that could not be linked, and system identifiers were the headlines. The design that replaces it is in [`docs/superpowers/specs/2026-11-19-portal-ui-gaps-design.md`](../superpowers/specs/2026-11-19-portal-ui-gaps-design.md).

What changed from the decision above:

| Part | Now |
|---|---|
| **Navigation** | Overview, Needs Decision and All Cases, then the live agents and a collapsed Roadmap group. Agents are shown by monogram; the gummy-blob avatars are no longer used in the portal. The footer is a single "Agent Health" line |
| **Overview** | A page (`#/overview`) and the landing route, replacing the Mission Control overlay: pending decisions first, key figures, business figures computed from case data, an outcome bar, agents and roadmap, then rule stops and platform health |
| **Case history** | A full-width table per agent and across agents (`#/cases`): tabs by state, search by case or vendor, sortable amount, age and cost, and one "What Happens Next" line per row with the recorded reason |
| **Case page** | A page of its own (`#/agent/<id>/case/<id>`). The title is the question. Below it: a labelled facts strip, a clickable step strip, the variance drawn to scale, the recommendation with a deterministic policy-fit verdict, the options weighed and the policy version the run used, evidence as readable cards with the agent's relevance notes, the rules that sent it to a person, and a pinned decision bar that states what approving, sending back and escalating do. Raw tool output is in an audit trail |
| **Visual language** | 15px body text and 24 to 34px for the question and headline numbers; Plex Mono only for citation tags and the audit trail; title-case labels; one name per status |

Rules that came with it: the browser does not parse documents or infer business facts (the API supplies vendor, due date and line items); the policy-fit verdict is plain workflow code over the match engine's findings, never the model; every figure on the overview is a sum or a median over real cases.
