# Healthcare agents

Agents for providers, payers and life sciences: administrative and operational work such as claims, prior authorization, scheduling and documentation. Typical fit for the platform: multi-day processes that wait on other parties, strict audit and privacy requirements, and human approval of anything that affects a patient or a claim decision.

No agents are scheduled here ([ADR-0019](../../docs/adr/0019-pattern-agent-portfolio.md)). A credible healthcare agent needs domain depth and data (much of it licensed or not public) that this project doesn't have. Instead, the table shows how each built pattern would carry over: the workflow shape stays the same, while the skills, tools and evidence sources change. Building one would start with a `business-case.md` and a real need. Any agent here would use **synthetic data only**: no real patient data (PHI) ever enters this repo or the platform, and agents never make clinical decisions.

| Pattern | Built as | How it would carry over here |
|---|---|---|
| Exception resolution | [Invoice Exception Resolver](../general/invoice-exception-resolver/) | Claim denials or prior-authorization requests: gather the clinical and coverage evidence, propose the next step, wait on the payer; a person approves |
| Evidence screening at scale | Audit Evidence Collector | Screening records against written criteria, such as trial eligibility or documentation completeness, with every finding cited |
| Analysis and explanation | FinOps Cost Sentinel | Explaining movement in operational metrics: denial rates, scheduling backlog, length of stay |
| Monitor, diagnose, act | Incident Commander | Monitoring clinical-system integrations (interface queues, failed feeds) and proposing fixes for approval |
| Remediation by pull request | CVE Remediator | Unchanged: vulnerable dependencies in healthcare software are the same problem |
