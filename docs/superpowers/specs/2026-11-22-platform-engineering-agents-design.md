# Platform engineering agents: design

Short design, agreed in conversation on 2026-11-22. Decision record: [ADR-0022](../../adr/0022-platform-engineering-agents.md).

## Intent

Extend the portfolio beyond industries to **platform engineering, AI capabilities and developer experience**. Add two agent concepts:

- **Delivery Metrics Advisor (DORA).** Gathers delivery metrics on this project's development process and recommends the changes most likely to improve them.
- **Agent Improver.** Improves each agent's performance on the goal set in its business case, by proposing fixes to its evals and its behavior as pull requests.

## Goals, non-goals, anti-goals

- **Goals:**
  - A new `agents/platform-engineering/` group.
  - Agent Fleet Ops moves into the group.
  - Business cases for both new agents in the repo's existing format.
- **Non-goals:** building any of the three now. They are concepts, like the financial-services examples.
- **Anti-goals:**
  - An improver that raises scores by weakening tests or overfitting.
  - DORA numbers that can be gamed, or that are used to rank individuals.

## Approaches

| Approach | Outcome |
|---|---|
| Extend Fleet Ops to improve eval scores | Rejected: the agent that reports the scores would also control them |
| Eval-only improver | Replaced by the agent improver: the goal is the agent's performance, not just the tests |
| New agents in `agents/technology/` | Rejected in favour of a new group |
| **Chosen:** new platform-engineering group with three concepts; Fleet Ops hands quality findings to the Agent Improver | — |

## Decided in conversation

- **New group:** `agents/platform-engineering/`, holding Fleet Ops (moved), the Agent Improver and the DORA agent.
- **Agent Improver scope:** improve each agent's performance on its assigned goal. It may change prompts, skills, model settings and evals.
- **Separate pull requests:** eval changes and behavior changes never share one.

## Builder's calls (made in writing the concepts)

- **Name:** "Delivery Metrics Advisor" for the DORA agent.
- **DORA data:**
  - Real GitHub history where it exists, plus a labelled synthetic history with planted bottlenecks.
  - Recommendations become issues only after a person approves them.
- **Agent Improver:**
  - **Held-out set:** a held-out case set outside the repository, scored by CI.
  - **Weakening label:** a `weakens-eval` label on eval pull requests that weaken a test.
  - **Write scope:** limited to evals, prompts, skills and agent config. Guardrails, budgets and allow-lists are excluded.
- **Prototype target:** the Invoice Exception Resolver, the only agent with a full eval suite.
