# Manufacturing agents

Agents for plants and supply chains: production, quality, maintenance and supplier work. Typical fit for the platform: long-running processes that wait on people, machines or suppliers, decisions that need an audit trail, and steps a person must approve before anything changes on the shop floor or in a purchase order.

No agents are scheduled here ([ADR-0019](../../docs/adr/0019-pattern-agent-portfolio.md)). A credible manufacturing agent needs domain depth and plant data that this project doesn't have. Instead, the table shows how each built pattern would carry over: the workflow shape stays the same, while the skills, tools and evidence sources change. Building one would start with a `business-case.md` and a real need. Any agent here would use synthetic or public data only.

| Pattern | Built as | How it would carry over here |
|---|---|---|
| Exception resolution | [Invoice Exception Resolver](../general/invoice-exception-resolver/) | Quality nonconformances or supplier delivery exceptions: gather batch and inspection evidence, propose a disposition; a person approves |
| Evidence screening at scale | Audit Evidence Collector | Screening inspection or sensor results against specifications, with every finding cited |
| Analysis and explanation | FinOps Cost Sentinel | Explaining movement in yield, scrap or downtime; supplier risk |
| Monitor, diagnose, act | Incident Commander | Equipment alerts: correlate with maintenance history and manuals, propose a work order for approval |
| Remediation by pull request | CVE Remediator | Unchanged, plus configuration drift in plant-floor software |
