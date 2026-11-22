# Financial services agents

Example applications of the five agent patterns ([ADR-0019](../../docs/adr/0019-pattern-agent-portfolio.md)) to retail brokerage, retirement services and financial crime compliance. They show how each pattern carries over to this industry: the workflow shape stays the same, and the skills, tools and evidence sources change. None is scheduled to build. The original selection, shared controls and cost assumptions are in [ADR-0017](../../docs/adr/0017-prototype-agent-portfolio.md).

All agents use **synthetic data only** and **assist, don't decide**: anything that affects a customer, a regulatory filing or production infrastructure is approved by a person.

| Agent | Pattern | Closest built agent | What it would do | Business case |
|---|---|---|---|---|
| `transfer-exception-resolver` | Exception resolution | [Invoice Exception Resolver](../general/invoice-exception-resolver/) | Diagnoses rejected account transfers, drafts the fix and customer outreach, waits for documents, resubmits | [business case](transfer-exception-resolver/business-case.md) |
| `rollover-concierge` | Exception resolution, multi-week | Invoice Exception Resolver | Runs the 401(k)-to-IRA rollover process: forms, tracking, reminders, deadline checks | [business case](rollover-concierge/business-case.md) |
| `aml-alert-investigator` | Evidence screening at scale | Audit Evidence Collector | Gathers evidence for anti-money-laundering alerts and drafts a cited case narrative for an investigator | [business case](aml-alert-investigator/business-case.md) |
| `metric-variance-analyst` | Analysis and explanation | FinOps Cost Sentinel | Explains why a metric moved, through governed metric definitions in BigQuery | [business case](metric-variance-analyst/business-case.md) |

Agent Fleet Ops, originally the fifth agent here, moved to the [platform engineering](../platform-engineering/) group ([ADR-0022](../../docs/adr/0022-platform-engineering-agents.md)).

The business cases describe purpose, benefits to measure, cost, risks and controls. They carry no value model: the industry volumes and labor figures one would need are not something this project can validate.
