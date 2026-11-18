# Business case: Metric Variance Analyst

- **Category:** Data analytics
- **Status:** Prototype planned, second to build ([ADR-0017](../../../docs/adr/0017-prototype-agent-portfolio.md))
- **Users:** Business leaders, finance and strategy teams, data analysts

## Summary

Leaders regularly ask why a key number moved: "Why did net new assets drop in the Southwest last quarter?" or "Why are new-account openings up but funded accounts flat?" Answering takes an analyst days of querying, slicing and writing. The Metric Variance Analyst answers these questions in minutes, but only through the organization's **governed metric definitions**, so every answer uses the same definition of "net new assets" as the official reports. Each answer comes with the charts, the explanation, and the exact queries it ran, so an analyst can check it.

## Business purpose

**The problem**

- Variance questions are frequent, urgent and repetitive. The analysis follows a familiar pattern: break the change down by region, product, segment and channel; find the drivers; rule out data problems; write it up.
- Analysts are a bottleneck, so leaders wait days or decide without the analysis.
- Generic "chat with your data" tools write SQL directly against raw tables. They often compute a metric differently from the official definition, and give a confident answer that disagrees with the finance report. In a regulated firm, two numbers for the same metric is worse than no answer.

**What the agent does**

1. Takes a question in plain English (from a synthetic brokerage data mart in BigQuery in the prototype).
2. Maps it to governed metrics and dimensions in a **semantic layer**: a catalog of approved metric definitions, the tables behind them and the dimensions they can be broken down by. If the question needs a metric that isn't defined, the agent says so rather than inventing one.
3. Writes an analysis plan (which breakdowns to test, in what order) and shows it.
4. Runs the plan: generates queries from the semantic layer, checks each query's estimated cost before running it, and decomposes the change into contributions by dimension.
5. Tests its own explanations: confirms the drivers add up to the total change, and checks for data-quality causes (a late data load, a reclassified product) before reporting a business cause.
6. Produces a short written answer with charts, ranked drivers, caveats, and an appendix with every query run.
7. Saves the analysis so an analyst can rerun, edit or promote it into a standard report.

## Value proposition

| Benefit | How it's measured |
|---|---|
| Faster answers to "why did it move?" | Time from question to answer: days → minutes |
| Analyst time moves to deeper work | Ad-hoc variance requests handled by analysts |
| One version of the truth | Agent answers that match official reported figures (target: 100%) |
| Answers people can check | Share of answers with a complete query appendix (target: 100%) |
| Lower query spend | BigQuery bytes scanned per answer, against a cap |

**Illustrative value model** (assumptions to replace with real volumes):

| Assumption | Example value |
|---|---|
| Variance questions per month across the business | 200 |
| Analyst time per question today | 6 hours |
| Share the agent can answer without an analyst rewriting it | 60% |
| Analyst review time for those answers | 30 minutes |
| Loaded cost per analyst hour | $90 |
| **Analyst hours saved per month** | 200 × 60% × (6 h − 0.5 h) ≈ **660 hours** |
| **Labor value per month** | 660 × $90 ≈ **$59,000** |

The harder-to-measure value is decision speed: leaders get an answer while it can still change a decision this week.

## Cost

| Item | Estimate |
|---|---|
| Model usage per question | Plan + 5–10 query generations (`fast`) + driver analysis and write-up (`smart`): roughly 80,000 tokens in, 8,000 out ≈ **$0.08–0.12** |
| BigQuery per question | Each query capped by maximum bytes billed (e.g., 1 GB); the synthetic data mart is small enough to stay within BigQuery's monthly free query allowance |
| Infrastructure | Shared platform cost (~$0.08–0.15/hour while the cluster is up), plus BigQuery storage for the synthetic mart (cents per month) |
| Prototype build | ~3 weeks: synthetic data mart and generator, semantic layer definitions, query tools with cost caps, decomposition logic, charting, eval suite |
| **Monthly cost at 200 questions** | ~$20–30 model usage; BigQuery near zero at prototype scale |

**Production cost drivers** (not in the prototype): building and maintaining the semantic layer over real data, data access reviews, and query costs at production data volumes.

## Risks

| Risk | Impact | Likelihood |
|---|---|---|
| Wrong answer stated confidently (bad SQL, wrong join, wrong filter) | Bad decision based on a wrong number | Medium |
| Agent computes a metric differently from the official definition | Conflicting numbers; loss of trust in data | Medium (low with the semantic layer) |
| Agent confuses correlation with cause | Misleading explanation | Medium |
| User sees data they aren't entitled to (e.g., customer-level detail, another division's results) | Data access breach; possible privacy or information-barrier violation | Low–Medium |
| Runaway or expensive queries | Unexpected BigQuery cost | Low |
| Question text contains instructions to bypass rules ("ignore the semantic layer and query the raw table") | Agent bypasses governance | Low |

## Controls

| Control | Type | Addresses |
|---|---|---|
| Queries generated **only** from the semantic layer; the agent has no tool that runs arbitrary SQL against raw tables | Preventive | Wrong definitions, bypass attempts |
| Reconciliation check: drivers must add up to the reported total change, and totals must match the official figure, or the answer is flagged | Detective | Wrong answers |
| Data-quality checks (late loads, reclassifications, nulls) run before business explanations | Detective | Wrong cause |
| Answers say "contributed to" and "associated with", never "caused", unless the cause is a known event in the data | Preventive | Correlation vs. cause |
| Queries run as the **signed-in user's** identity (or a role mapped to it), so BigQuery's own access controls apply; aggregated output only, with minimum group sizes | Preventive | Unauthorized data access |
| Maximum bytes billed on every query; dry-run cost estimate before execution; per-agent BigQuery budget | Preventive | Runaway cost |
| Query appendix on every answer so an analyst can verify and rerun | Detective | Wrong answers |
| Eval suite of questions with known answers on the synthetic mart, including "unanswerable" questions the agent must decline | Detective | Regressions |

## Prototype scope and success measures

- **In scope:** a synthetic brokerage data mart (accounts, flows, assets, products, regions, channels) with planted drivers; a semantic layer of 10–15 metrics; plan, query, decompose, reconcile and write-up; charts in the UI.
- **Out of scope:** real data, free-form SQL, forecasting, and dashboards (answers only).
- **Success measures:** finds the planted primary driver in ≥ 90% of eval questions; 100% of answers reconcile to the official totals; declines 100% of questions that need undefined metrics; no query exceeds its byte cap.
