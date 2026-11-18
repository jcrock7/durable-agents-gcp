# Business case: Agent Fleet Ops

- **Category:** Platform management
- **Status:** Prototype planned, last to build ([ADR-0017](../../../docs/adr/0017-prototype-agent-portfolio.md))
- **Users:** Platform engineers, site reliability engineers, model risk management, FinOps

## Summary

Once a firm runs more than a handful of AI agents, someone has to watch them: what each one costs, which runs fail or get stuck, whether accuracy is drifting, and whether the evidence regulators expect for every model in use is up to date. The Agent Fleet Ops agent does that watching for the other four agents in this portfolio. It reports on cost, reliability and quality; diagnoses failed runs and replays them from their last checkpoint with approval; proposes infrastructure and budget changes **only as pull requests** for a person to review; and assembles a monthly model-risk evidence pack.

## Business purpose

**The problem**

- Agents fail differently from ordinary software. A run can succeed technically but give worse answers after a model or prompt change. Costs can rise because a loop calls the model more often than expected. A run can wait forever for an approval nobody saw.
- Banks and broker-dealers must manage **model risk**: every model in use has to be inventoried, validated, monitored and documented, following supervisory guidance such as the Federal Reserve's SR 11-7. Generative AI agents fall within that scope, and most firms can't yet produce the monitoring evidence for them.
- Platform teams spend time on repetitive operations work: checking dashboards, reading traces, restarting failed runs, adjusting budgets. Much of it follows a runbook.

**What the agent does**

1. **Daily fleet report:** for each agent, runs, success rate, stuck runs, cost per run against budget, approval wait times and latest eval scores, drawn from Temporal, LiteLLM spend logs, Cloud Monitoring and CI eval results.
2. **Failure triage:** for each failed or stuck run, reads the Temporal history and traces, classifies the cause (model error, tool failure, budget exceeded, bad input, waiting on a person) and recommends an action.
3. **Replay with approval:** for transient failures, proposes resetting the workflow to its last good step; **an engineer approves** before the replay runs.
4. **Drift watch:** runs each agent's eval suite on a schedule and compares results with the last accepted baseline; flags a drop in accuracy or a rise in cost per run.
5. **Change proposals as pull requests:** when a fix needs a configuration change (a budget, a scaling setting, a model alias, a time limit), it opens a pull request with the Terraform or config change and its reasoning. It never applies changes itself.
6. **Monthly model-risk evidence pack:** for each agent, its purpose, models and prompt versions in use, eval results and trends, incidents, overrides by human reviewers and open issues, in a format model risk management can review.

## Value proposition

| Benefit | How it's measured |
|---|---|
| Faster detection and recovery from failures | Mean time to detect and to recover failed or stuck runs |
| Controlled AI spend | Cost per run vs. budget; budget overruns caught before the hard cap |
| Quality regressions caught early | Eval drops detected before users report them |
| Audit-ready model-risk evidence | Hours to prepare monitoring evidence per agent per cycle |
| Less repetitive operations work | Engineer hours spent on routine triage and reporting |
| Changes stay reviewed and reversible | Share of infrastructure changes through pull requests (target: 100%) |

**Illustrative value model** (assumptions to replace with real figures):

| Assumption | Example value |
|---|---|
| Agents in production | 20 |
| Hours to prepare monitoring evidence per agent per quarter today | 16 |
| Share of that preparation the agent automates | 60% |
| **Evidence-preparation hours saved per year** | 20 × 16 × 4 × 60% ≈ **770 hours** |
| Engineer hours per week on routine triage and reporting | 10 |
| Share automated | 50% |
| **Engineer hours saved per year** | 10 × 52 × 50% = **260 hours** |

The value grows with the size of the fleet. The bigger benefit is permission to scale: firms are unlikely to approve more agents for production until monitoring and model-risk evidence exist.

## Cost

| Item | Estimate |
|---|---|
| Daily report and triage | `fast` summaries of metrics and failed-run histories: ≈ **$0.05–0.20 per day**, depending on failures |
| Scheduled eval runs | Each agent's eval suite: ≈ **$0.50–2 per agent per full run**; weekly in the prototype |
| Monthly evidence pack | `smart` write-up per agent: ≈ **$0.10–0.30 per agent per month** |
| Infrastructure | Shared platform cost; reads existing Temporal, LiteLLM and Cloud Monitoring data, so no new data stores |
| Prototype build | ~3 weeks: read-only observability tools, triage classifier, replay workflow with approval, GitHub pull-request tool, evidence-pack template, eval suite with injected faults |
| **Monthly cost for this portfolio (4 agents)** | ~$15–40, mostly scheduled evals |

**Production cost drivers** (not in the prototype): integration with the firm's model inventory, incident management and change-management systems, and model risk management's review of the evidence format.

## Risks

| Risk | Impact | Likelihood |
|---|---|---|
| Agent makes an unreviewed change to production infrastructure | Outage, security gap or cost spike | Low (by design) |
| Replay of a failed run repeats a side effect (e.g., sends a customer message twice) | Duplicate action; customer harm | Low–Medium |
| Misdiagnosed failure leads to the wrong fix | Wasted effort; problem persists | Medium |
| Evidence pack misrepresents an agent's performance (overstates accuracy, omits incidents) | Misleading regulators and model risk management; serious compliance exposure | Low–Medium |
| Agent has broad read access across the platform | Larger blast radius if compromised | Medium |
| Log or trace text contains injected instructions | Agent manipulated into a harmful proposal | Low |
| The monitor itself fails silently | Failures go unnoticed | Low–Medium |

## Controls

| Control | Type | Addresses |
|---|---|---|
| **No write access to infrastructure:** changes only as pull requests, which need human review and pass CI (Terraform plan, secret scan, evals) before merge | Preventive | Unreviewed changes |
| Replays need engineer approval, and every agent's side-effecting activities are idempotent (unique keys, so a repeat does nothing) | Preventive | Duplicate side effects |
| Triage must cite the specific workflow events and trace spans behind its diagnosis | Preventive | Misdiagnosis |
| Evidence-pack numbers are computed by deterministic queries; the model writes only the narrative around them, and every incident in the period must appear | Preventive | Misrepresentation |
| Read-only service account with access limited to Temporal, LiteLLM spend logs, Cloud Monitoring and the repo; no access to agent business data | Preventive | Blast radius |
| Logs and traces treated as data and screened by the injection guardrail | Preventive | Injected instructions |
| Heartbeat: if the daily report doesn't arrive, a Cloud Monitoring alert fires independently of the agent | Detective | Silent monitor failure |
| Eval suite with injected faults (failed tool, budget exhaustion, stuck approval, eval regression) gates changes to this agent | Detective | Regressions |

## Prototype scope and success measures

- **In scope:** monitoring agents 1–4 on this platform; daily report; failure triage; approved replays; scheduled evals with drift detection; pull requests for budget and config changes; monthly evidence pack.
- **Out of scope:** automatic changes of any kind, paging or incident-management integration, and agents outside this platform.
- **Success measures:** correct cause for ≥ 90% of injected faults; zero infrastructure changes outside pull requests (verified by service-account permissions); replays never repeat a side effect in tests; every incident in the period appears in the evidence pack.
