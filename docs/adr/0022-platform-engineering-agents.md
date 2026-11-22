# ADR-0022: Platform engineering agent group

- **Status:** Proposed
- **Date:** 2026-11-22

## Context

[ADR-0019](0019-pattern-agent-portfolio.md) groups agents by industry. Some useful agents have no industry: they work on this project's own platform and engineering process. The scope is being extended to three such areas:

- **Platform engineering:** running the agent fleet.
- **AI capabilities:** improving the agents themselves.
- **Developer experience:** how changes get delivered.

Agent Fleet Ops already belonged in this space, but it sat in `financial-services` as an example. Two new concepts were proposed:

- an agent that measures DORA delivery metrics and recommends improvements;
- an agent that improves eval suites, later widened to improve each agent's performance on its business-case goal.

Fleet Ops already watches eval scores, so the first question was whether to extend it to improve them.

## Decision

Create **`agents/platform-engineering/`** for agents that work on this project's own systems, and put three concepts in it, none scheduled to build:

| Agent | Area | Pattern |
|---|---|---|
| Agent Fleet Ops (moved from `financial-services`) | Platform engineering | Monitor, diagnose, act |
| Agent Improver (new) | AI capabilities | Remediation by pull request |
| Delivery Metrics Advisor (new) | Developer experience | Analysis and explanation |

**Fleet Ops does not take on improvement.** It reports eval scores and writes the model-risk evidence pack. If it could also change the evals or the agents, it could improve its own numbers. Fleet Ops therefore stays read-only and hands quality findings to the Agent Improver.

The Agent Improver has two controls against the same failure in itself:

- **Separate pull requests.** Eval changes and behavior changes never share a pull request.
- **A held-out set.** Every behavior change is scored on cases the Improver can't read.

## Alternatives considered

| Option | Why not (for now) |
|---|---|
| Extend Fleet Ops to improve eval scores | The agent that reports the scores would also control them; widens a read-only agent to write access across every agent |
| An improver limited to evals only | Fixing the tests doesn't fix the agent; the goal is performance on the business-case measures |
| Put the new agents in `agents/technology/` | That folder is for software organisations as an industry; these agents work on this platform and should travel with it |
| Build them now | No CI eval runs, deploy pipeline or incident records yet; the concepts state what each needs first |

## Consequences

- **Positive:**
  - Platform, AI and developer-experience work has a home.
  - The improvement loop is designed with its gaming risks named and controlled.
  - Each agent's pull requests feed the delivery metrics.
- **Negative / risks:**
  - Three more concepts not scheduled to build.
  - The Agent Improver depends on things that don't exist yet: a CI eval job and a held-out case store outside the repository.
  - The Delivery Metrics Advisor relies on synthetic history until this project has a deploy pipeline and incident records.
- **Revisit when:**
  - evals run in CI (ADR-0009), or
  - the keyless deploy workflow lands ([ADR-0018](0018-deployment-gitops-deferred.md)), or
  - a second agent has a full eval suite.
