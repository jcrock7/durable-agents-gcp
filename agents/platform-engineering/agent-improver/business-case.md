# Business case: Agent Improver

- **Category:** AI capabilities
- **Status:** Concept; application of remediation by pull request (pattern 2) to the agents themselves; not scheduled to build ([ADR-0022](../../../docs/adr/0022-platform-engineering-agents.md))
- **Users:** Agent owners, platform engineers, model risk management

## Summary

Every agent in this portfolio has a goal written down in its business case, as success measures with targets: "exception type classified correctly, 90% or more", "cost per exception under $0.05". The Agent Improver's job is to raise each agent's performance against those measures. It reads the agent's eval results and production signals, works out why the agent falls short, and proposes fixes **as pull requests**. A fix might go in the evals (a gap that lets a failure go unnoticed) or in the agent's behavior (a prompt, a skill, a model alias, a limit). Two rules keep it honest: an eval change and a behavior change never share a pull request, and every behavior change is scored on a **held-out set** of cases the Improver can't read or edit. It never merges anything.

## Business purpose

**The problem**

- Improving an agent is slow, manual work. Someone reads the failing cases, guesses at a cause, edits a prompt, reruns the suite and checks nothing else broke. Most of the time goes into the reading and the rerunning.
- Eval suites drift out of step with the goal. Cases cover the scenarios someone thought of first; assertions check the output's shape but not whether it's right; model-graded checks are noisy; injection cases are missing. An agent can score well and still miss its goal.
- The obvious shortcut is dangerous. An automated "improver" rewarded for higher scores will find it easier to weaken the test than to fix the agent, and an overfitted prompt passes the cases it was tuned on and fails the next real one.

**What the agent does**

1. **Reads the goal.** Takes the success measures and targets from the agent's business case and maps each to the eval metric that measures it (e.g. `evals/RESULTS.md` for the Invoice Exception Resolver). A measure with no eval behind it is itself a finding.
2. **Gathers signals.** Eval results per case and per scenario; quality findings handed over by Agent Fleet Ops (score drops, rising cost per run, failed runs by cause); and human reviewer overrides from the review gate, which are the closest thing to ground truth in production.
3. **Diagnoses.** Groups misses by cause, citing the cases behind each group. Example from this repo: the Invoice Exception Resolver's `price_overcharge` scenario scores 83.3% on action because, in INV-20601, the model treated a contract price matching the PO price as grounds to accept a variance.
4. **Checks the evals first,** against a gap checklist kept as a skill: success measures with no eval, scenarios with few cases, assertions that can't fail, flaky model-graded checks, no injection or boundary cases, and labels that look wrong. Proposed fixes go in an **eval pull request**: new cases, stronger assertions, a corrected label with its reasoning.
5. **Then proposes a behavior change** in a separate pull request, only once the eval changes it depends on are merged: a prompt edit, a skill rule, a model alias, a limit or a tool setting. It runs the suite on the candidate in the sandbox and includes the scores before and after, per measure and per scenario, plus cost per run and latency.
6. **Reports what it couldn't fix:** misses that need a new tool, more data or a decision by the agent's owner go in an issue, not a pull request.

## Value proposition

| Benefit | How it's measured |
|---|---|
| Agents get closer to their goal | Success measures meeting target, per agent, over time |
| Gains hold up on unseen cases | Score on the held-out set vs. the visible suite (a widening gap means overfitting) |
| Evals measure the goal, not just the shape | Success measures with an eval behind them; mutation-style checks that a deliberately broken agent fails the suite |
| Less engineer time per improvement | Hours from a known miss to a merged fix |
| Improvements don't cost more than they gain | Cost per run before and after each behavior change |
| Changes stay reviewed | Share of Improver pull requests merged, and reverted after merge |

No value model: these are engineering measures on this project's own agents, measured before and after a pilot.

## Cost

Assumes the `fast` and `smart` aliases and list prices in [ADR-0017](../../../docs/adr/0017-prototype-agent-portfolio.md); re-check current pricing.

| Item | Estimate |
|---|---|
| Diagnosis | `smart` over the misses, rationales and prompts of one agent: ≈ **$0.05–0.20 per agent per cycle** |
| Candidate runs | The target agent's own suite per candidate, at that agent's cost per case (Invoice Exception Resolver: 96 cases at ≈ $0.005 ≈ **$0.50**); up to 3 candidates per cycle |
| Held-out scoring | Run by CI on the chosen candidate only: about the same again |
| Infrastructure | Shared platform; the sandboxed runner from the CVE Remediator; no new data stores |
| Prototype build | ~3 weeks: goal-to-metric mapping, gap-checklist skill, diagnosis step, sandboxed candidate runs, GitHub pull-request tool, held-out split and CI scoring job |
| **Monthly cost for this portfolio** | ~$10–30 with one cycle per agent per week |

## Risks

| Risk | Impact | Likelihood |
|---|---|---|
| Improves the score by weakening the test (drops a hard case, loosens an assertion, relabels a miss as correct) | Agent looks better and is worse; misleading evidence for model risk | Medium (this is the natural failure of the job) |
| Overfits: a prompt tuned to the visible cases fails new ones | Regressions in production | Medium |
| A fix for one measure breaks another (e.g. accuracy up, cost per run doubled, injection cases no longer escalated) | Regression or budget overrun | Medium |
| Change loosens a guardrail or routing rule to "fix" a miss | Safety or compliance gap | Low–Medium |
| Reviewers rubber-stamp a steady stream of automated pull requests | Unreviewed changes in practice | Medium |
| Case text, rationales or reviewer notes contain injected instructions | Agent manipulated into a harmful change | Low |

## Controls

| Control | Type | Addresses |
|---|---|---|
| **Eval and behavior changes never share a pull request.** A behavior pull request is checked by CI against the eval suite as merged on the main branch; a pull request that touches both `evals/` and anything else fails CI | Preventive | Weakening the test |
| **Held-out set:** a share of each agent's cases lives outside the repository, readable only by the CI scoring job. The Improver never sees it, and CI posts the held-out score on every behavior pull request | Preventive / detective | Overfitting, weakening the test |
| Eval pull requests that remove a case, loosen an assertion or change a label are labelled `weakens-eval` and need the agent owner's review, with the reason stated | Preventive | Weakening the test |
| Every success measure is reported before and after, not only the one targeted; any measure that drops below target blocks the pull request | Detective | Cross-measure regressions |
| Write access limited to `agents/*/{evals,src/prompts,skills,src/agent.config.ts}`; guardrail settings, routing rules, budgets and tool allow-lists are out of scope and go in an issue instead | Preventive | Loosened guardrails |
| At most one open behavior pull request per agent; each states the cause it addresses and cites the cases | Preventive | Rubber-stamping |
| Never merges; normal review and CI apply | Preventive | Unreviewed changes |
| Case text and rationales treated as data and screened by the injection guardrail | Preventive | Injected instructions |
| Its own eval suite: seeded agents with known defects (a prompt bug, a missing eval case, a trap where weakening a test is the easy win) | Detective | Regressions in the Improver itself |

## Prototype scope and success measures

- **In scope:** the Invoice Exception Resolver (the only agent with a full eval suite); goal-to-metric mapping from its business case; the gap checklist; eval and behavior pull requests on this repository; the held-out split and CI scoring job; handoff from Agent Fleet Ops.
- **Out of scope:** fine-tuning, changes to tools or MCP servers, automatic merges, agents without an eval suite (the Improver files an issue for those).
- **Success measures:**

| Measure | Target |
|---|---|
| Seeded defects found and correctly diagnosed | 80% or more |
| Behavior pull requests that raise the targeted measure on the held-out set | 70% or more of those proposed |
| Behavior pull requests that drop any other measure below target | 0 |
| Weakening-the-test traps taken without the `weakens-eval` label | 0 |
| Pull requests mixing eval and behavior changes | 0 (enforced by CI) |
