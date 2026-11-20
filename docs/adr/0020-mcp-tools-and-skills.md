# ADR-0020: Tools as in-cluster MCP servers; skills as versioned instruction packages

- **Status:** Proposed
- **Date:** 2026-11-18

## Context

The agents in [ADR-0019](0019-pattern-agent-portfolio.md) need tools against many systems: a mock ERP, documents, GitHub, BigQuery, Kubernetes and Prometheus. They also need written judgment: tolerance rules, control tests, rollback criteria. Today the only agent calls Wikipedia through a hand-written client with a host allow-list ([research-summarize](../../agents/general/research-summarize/)). Repeating that pattern for every system means custom glue per agent, credentials spread across the worker, and nothing standard to inspect.

The Model Context Protocol (MCP) standardizes how an agent discovers tools (`tools/list`) and calls them (`tools/call`). Maintained MCP servers already exist for several systems we need: GitHub, Grafana and Kubernetes, plus Google's MCP Toolbox for Databases for Postgres and BigQuery. Agent Skills (a folder with a `SKILL.md` and supporting files) is a common format for packaging instructions and reference material an agent loads when needed.

Requirements:

- **Least privilege.** Each agent sees only the tools it is allowed. Credentials for a system live with its tool server, never in the worker, as with model credentials and LiteLLM ([ADR-0005](0005-llm-gateway-litellm.md)).
- **Model proposes, workflow acts.** Anything that changes a system runs only as an explicit workflow step, after approval where required. It is never a tool the model can call on its own.
- **Auditable.** Every tool call is recorded with its arguments and result.
- **Durable.** Tool calls fit Temporal's model: activities, retries by policy, no repeat after a crash ([ADR-0002](0002-temporal-durable-runtime.md)).
- **Show deployment and scaling on GKE**, not just local scripts.

## Decision

**Tools.** Every external system an agent touches is reached through an **MCP server running in the cluster**. Existing servers are preferred; custom servers are written in TypeScript with the official MCP SDK.

| Rule | How |
|---|---|
| One Deployment per MCP server | Each server has its own Service, ServiceAccount and NetworkPolicy, under `platform/mcp/<server>/`, deployed by the same Kustomize base ([ADR-0016](0016-repository-structure.md)). Streamable HTTP transport, cluster-internal only |
| Credentials live with the server | Each server gets its own Workload Identity or database role, read-only unless the server exists to write. The worker holds no system credentials |
| Allow-list per agent | `agent.config.ts` lists `server:tool` pairs. The MCP client in agent-kit drops everything else from `tools/list` before the model sees it, and refuses unlisted calls. NetworkPolicy lets the worker reach only MCP servers that some agent lists |
| Read tools go to the model; write tools don't | Read-only tools may be offered to the model inside an activity. Tools that change state (post a resolution, open a pull request, send an email) are called by the workflow as their own activity, after a `ReviewGate` when the agent's rules require it |
| Every call is an activity | Model-driven tool loops run inside one activity with a step limit. Each tool call is logged with server, tool, arguments, result size and duration, and traced with OpenTelemetry ([ADR-0008](0008-observability.md)). Workflow-driven calls also appear as their own events in the Temporal history |
| Deterministic work is a tool, not a prompt | Arithmetic on money, tolerance checks, diffs and test runs are tools with exact outputs. The model explains and decides what to do next; it does not compute |
| Scaling fits the workload | Stateless servers scale on CPU with a HorizontalPodAutoscaler. Bursty batch work runs as Kubernetes Jobs. Untrusted code runs in throwaway pods under GKE Sandbox (gVisor) |

**Skills.** A skill is a folder holding `SKILL.md` (front matter `name`, `description`, `version`) plus any reference files. It encodes judgment and procedure, not system access. Skills shared by agents live in `packages/skills/<name>/`; skills used by one agent live in that agent's `skills/` folder.

- **Each step declares its skills** in `agent.config.ts`, and the activity puts them in the prompt. The model doesn't choose skills at runtime. That keeps prompts reproducible and evals stable.
- **Versions are recorded.** Each run's result records the skill names and versions it used, like `PROMPT_VERSION`. A skill change is reviewed like a code change and runs the agent's evals ([ADR-0009](0009-evals-promptfoo.md)).
- **Rule values live in configuration.** Values such as tolerances and thresholds sit in `agent.config.ts`, so a skill reads as policy and a value change stays a one-line diff.

The public document skills (Word, PDF, spreadsheet) run Python scripts in a code-execution sandbox. We adopt the skill format but render documents with deterministic tools instead.

## Alternatives considered

| Option | Why not (for now) |
|---|---|
| Hand-written tool clients per agent (current pattern) | Fine for one public API. Across many systems it spreads credentials into the worker and gives nothing standard to inspect or reuse. Kept for simple public HTTP APIs |
| LiteLLM's MCP gateway (register MCP servers in LiteLLM, per-key tool access) | Attractive, since tool access would sit next to model budgets in one place. Not yet verified on our pinned LiteLLM version. Revisit once agent-kit's allow-list works, as a second enforcement layer |
| Let the model call write tools directly, with a confirmation prompt | Moves the approval boundary into the prompt, where an injected instruction can reach it. Workflow-enforced approval can't be talked around |
| Model selects skills at runtime from a catalog | More flexible, but runs become less reproducible and evals noisier. Revisit if the skill count per agent grows past a handful |
| One shared MCP server exposing every tool | Simpler to deploy, but one identity holds every credential, and scaling can't follow each workload |

## Consequences

- **Positive:**
  - Tool access is standard, inspectable and least-privilege.
  - Existing servers cover most systems.
  - Custom servers show three distinct GKE scaling patterns.
  - Skills make judgment reviewable and versioned, separate from code.
- **Negative / risks:**
  - More Deployments to run, though each is small and many scale to one replica locally.
  - Community MCP servers vary in quality: each is pinned by digest and checked before use.
  - The model-driven tool loop needs its own step limit and timeout inside the activity.
- **Revisit when:** LiteLLM's MCP gateway is verified on our version, or an agent needs a tool that MCP serves poorly, such as large binary transfers.
