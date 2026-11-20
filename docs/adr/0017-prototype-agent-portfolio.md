# ADR-0017: Prototype agent portfolio — five financial-services agents

- **Status:** Superseded by [ADR-0019](0019-pattern-agent-portfolio.md). The five agents remain as example applications of its patterns; the shared controls and cost assumptions below still apply
- **Date:** 2026-11-18

## Context

The platform exists to show that AI agents can finish real work **safely and on budget**. A generic chatbot doesn't test that. The agents we prototype should exercise what the platform is built for: long-running work that survives failures ([ADR-0002](0002-temporal-durable-runtime.md)), human approval of risky steps ([ADR-0012](0012-guardrails-lightweight.md)), governed and budgeted model calls ([ADR-0005](0005-llm-gateway-litellm.md)), and evals that gate changes ([ADR-0009](0009-evals-promptfoo.md)).

Retail brokerage, retirement services and banking are a good domain for this. The work is document-heavy and exception-driven, it often runs for days or weeks, and it is regulated, so auditability and human control are requirements, not extras.

Constraints:

- **Synthetic data only.** No real customer, account or transaction data ever enters this repo or the platform. Each agent ships a generator for its own fake data.
- **Assist, don't decide.** Any agent output that affects a customer, a regulatory filing or production infrastructure is reviewed and approved by a person.
- **Fit the platform's cost envelope:** cents per agent run, within each agent's LiteLLM budget key.

## Decision

Prototype five agents: three that solve operational business problems, one for data analytics and one for platform management. Each has its own folder under `agents/financial-services/` ([ADR-0016](0016-repository-structure.md)) and a business case covering its purpose, value proposition, cost, risks and controls.

| # | Agent | Category | What it does | Platform features it proves | Business case |
|---|---|---|---|---|---|
| 1 | `transfer-exception-resolver` | Business | Diagnoses rejected brokerage account transfers, drafts the fix and customer outreach, waits for documents, resubmits | Multi-day waits, signals, retries, approval gates | [business case](../../agents/financial-services/transfer-exception-resolver/business-case.md) |
| 2 | `aml-alert-investigator` | Business | Gathers evidence for anti-money-laundering alerts, scores risk, drafts a cited case narrative for an analyst | Grounded output with citations, audit trail, no autonomous decisions | [business case](../../agents/financial-services/aml-alert-investigator/business-case.md) |
| 3 | `rollover-concierge` | Business | Runs the multi-week 401(k)-to-IRA rollover process: forms, tracking, reminders, tax-deadline checks | Durable timers over weeks, stateful outreach, service-vs-advice boundary | [business case](../../agents/financial-services/rollover-concierge/business-case.md) |
| 4 | `metric-variance-analyst` | Data analytics | Answers "why did this metric move?" through a governed metric layer in BigQuery, with charts and the SQL it ran | Governed text-to-SQL, query cost caps, multi-step analysis plans | [business case](../../agents/financial-services/metric-variance-analyst/business-case.md) |
| 5 | `agent-fleet-ops` | Platform management | Monitors agents 1–4 for cost, failures and accuracy drift; replays failed runs; proposes Terraform fixes by pull request; writes model-risk evidence | Observability, evals, FinOps, infrastructure as code, change control | [business case](../../agents/financial-services/agent-fleet-ops/business-case.md) |

**Build order:** 2 → 4 → 1 → 3 → 5. Agent 2 exercises grounding, citations and audit most directly, so it shapes `packages/agent-kit`. Agent 5 comes last because it needs a fleet to manage.

### Shared controls (every agent)

These come from the platform, so each business case only lists controls specific to its own agent.

| Control | Where it lives |
|---|---|
| Sign-in required for every user (Google identity) | GKE Gateway + IAP ([ADR-0010](0010-edge-access-iap.md)) |
| No cloud credentials in agent code | Workload Identity; only LiteLLM can call Vertex AI ([ADR-0004](0004-vertex-ai-models.md)) |
| Per-agent spend limit and cost logging | LiteLLM budget key per agent ([ADR-0005](0005-llm-gateway-litellm.md)) |
| Prompt-injection screening and model safety filters | LiteLLM guardrail + Vertex AI safety settings ([ADR-0012](0012-guardrails-lightweight.md)) |
| Tool allow-list; risky tools pause for human approval | `agent.config.ts` + Temporal approval signal ([agents/README.md](../../agents/README.md)) |
| Every step recorded and replayable | Temporal event history; outputs and approvals stored in Postgres ([ADR-0007](0007-postgres-pgvector.md)) |
| End-to-end traces for each run | OpenTelemetry → Cloud Trace ([ADR-0008](0008-observability.md)) |
| Eval suite must pass before merge | promptfoo in CI ([ADR-0009](0009-evals-promptfoo.md)) |
| Project-wide spend ceiling | Cost guardrails ([ADR-0015](0015-cost-guardrails.md)) |

### Cost assumptions used in the business cases

- **Model aliases:** `fast` is a Flash-class Gemini model and `smart` a Pro-class model, both on Vertex AI.
- **Assumed list prices per million tokens:** `fast` about $0.30 input and $2.50 output; `smart` about $1.25 input and $10 output. Re-check against current Vertex AI pricing before relying on any figure.
- **Infrastructure:** about $0.08–0.15 per hour while the cluster is up, shared by all agents (see the [README](../../README.md#cost)).
- **Value figures:** volumes, handling times and labor rates are **illustrative assumptions** that show how the value is calculated. A real business case would replace them with the operating unit's own numbers.

## Alternatives considered

| Option | Why not (for now) |
|---|---|
| One general-purpose assistant (chat over documents) | Doesn't exercise durability, approvals or multi-day workflows; hard to show measurable business value |
| Customer-facing agents (chatbots that talk to customers directly) | Higher regulatory and reputational risk; harder to keep a person in the loop. Internal, staff-assisting agents first |
| Investment advice or trading agents | Advice and trade execution are regulated activities with suitability obligations; out of scope for a prototype |
| Five business agents, no platform agent | Leaves out monitoring and model risk management, which regulated firms need before any agent reaches production |
| Real or anonymized customer data | Privacy and contractual risk; synthetic data is enough to prove the patterns |

## Consequences

- **Positive:** Each agent proves a different platform capability while sharing one runtime, gateway and test harness. Business cases give each prototype a measurable purpose and explicit risk controls.
- **Negative / risks:** Five agents is a lot of scope for a small project; the build order lets the portfolio stop at any point with working agents. Synthetic data can make results look better than real-world performance, so each business case states what a production pilot would have to prove.
- **Revisit when:** The first two agents are built and the shared `agent-kit` is stable, or a portfolio agent turns out not to need anything the platform doesn't already prove.
