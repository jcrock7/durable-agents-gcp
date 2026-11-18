# Financial services agents

Agents for retail brokerage, retirement services and financial crime compliance. The work is document-heavy, exception-driven, often runs for days or weeks, and is regulated, so durability, audit trails and human approval are requirements rather than extras. Selection, shared controls, build order and cost assumptions: [ADR-0017](../../docs/adr/0017-prototype-agent-portfolio.md).

All agents use **synthetic data only** and **assist, don't decide**: anything that affects a customer, a regulatory filing or production infrastructure is approved by a person.

| Agent | Category | What it does | Business case | Status |
|---|---|---|---|---|
| `aml-alert-investigator` | Financial crime compliance | Gathers evidence for anti-money-laundering alerts, scores risk, drafts a cited case narrative for an investigator | [business case](aml-alert-investigator/business-case.md) | Planned, first to build |
| `metric-variance-analyst` | Data analytics | Answers "why did this metric move?" through governed metric definitions in BigQuery, with charts and the queries it ran | [business case](metric-variance-analyst/business-case.md) | Planned, second |
| `transfer-exception-resolver` | Brokerage operations | Diagnoses rejected account transfers, drafts the fix and customer outreach, waits for documents, resubmits | [business case](transfer-exception-resolver/business-case.md) | Planned |
| `rollover-concierge` | Retirement services | Runs the multi-week 401(k)-to-IRA rollover process: forms, tracking, reminders, tax-deadline checks | [business case](rollover-concierge/business-case.md) | Planned |
| `agent-fleet-ops` | Platform management | Monitors the other agents for cost, failures and accuracy drift; replays failed runs; proposes fixes by pull request; writes model-risk evidence | [business case](agent-fleet-ops/business-case.md) | Planned, last |

Each agent folder follows the [agent layout](../README.md#layout-of-an-agent). Until an agent is built, its folder holds only the business case.
