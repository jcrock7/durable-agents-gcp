# Business case: Delivery Metrics Advisor

- **Category:** Developer experience
- **Status:** Concept; application of analysis and explanation (pattern 4) to the engineering process; not scheduled to build ([ADR-0022](../../../docs/adr/0022-platform-engineering-agents.md))
- **Users:** Engineering leads, platform engineers, developers

## Summary

The four DORA metrics are the most widely used measures of software delivery: **deployment frequency**, **lead time for changes**, **change failure rate** and **time to restore service** after a failed change. Most teams either don't measure them or have a dashboard nobody acts on. The Delivery Metrics Advisor computes the four metrics from GitHub, explains what moved them and why, and recommends the few changes most likely to improve them, each backed by the pull requests, runs and incidents it is based on. The numbers come from deterministic queries; the model writes only the explanation and the recommendations. Recommendations become GitHub issues only after a person approves them.

## Business purpose

**The problem**

- Delivery problems hide in the gaps between tools. A pull request that waits two days for review, a flaky test that forces reruns and a deploy that has to be rolled back each show up in a different place, and nobody adds them up.
- A dashboard of the four numbers says *that* lead time rose, not *why*. Finding the why means breaking lead time into its stages (first commit to pull request, waiting for review, review to merge, merge to deploy) and reading the outliers, which takes time nobody budgets for.
- The metrics are easy to game and easy to misread. Deploying more often by splitting changes, or lowering change failure rate by not recording incidents, improves the number and not the delivery.

**What the agent does**

1. **Collects** from GitHub through the GitHub MCP server: merged pull requests with commit, review and merge times; Actions runs (CI duration, reruns, failures); releases or deploy tags; and issues labelled `incident`, linked to the change that caused them. Agent Fleet Ops contributes failed and restored agent runs.
2. **Computes** the four metrics, plus their stage breakdowns, with deterministic queries, on a weekly and a rolling 30-day window. It labels each with its DORA performance band.
3. **Explains** what changed since the last period and why: which stage of lead time grew, which workflows fail or get rerun most, which changes led to incidents. Every claim cites the pull requests, runs or issues behind it.
4. **Recommends** up to three changes ranked by expected effect on the metric that is furthest from target, e.g. "quarantine the two tests behind 60% of reruns", "pull requests over 400 lines wait 3× longer for review: split them", "add a deploy workflow so merge-to-deploy is measured and automatic". Each states the metric it should move and how to check it worked.
5. **Files issues after approval.** A person approves which recommendations become GitHub issues. Next period's report checks whether each one moved its metric.

**Data in the prototype:** this repository deploys through apply scripts and has no incident records yet, so real history is thin. The prototype uses this repository's real pull requests and Actions runs where they exist, plus a **synthetic history** (a seeded repository with a year of pull requests, deploys, incidents and restores, with known bottlenecks planted) labelled as synthetic in every report.

## Value proposition

| Benefit | How it's measured |
|---|---|
| Delivery metrics exist and are trusted | Four metrics computed every week; numbers match a hand calculation on a sample |
| Bottlenecks found without manual analysis | Planted bottlenecks in the synthetic history found and correctly explained |
| Recommendations that work | Share of approved recommendations that moved their metric in the following periods |
| Less time preparing delivery reviews | Engineer hours per review |

No value model: DORA's published research links the metrics to organisational outcomes, but this project can't validate a dollar figure for its own process.

## Cost

Assumes the `fast` and `smart` aliases and list prices in [ADR-0017](../../../docs/adr/0017-prototype-agent-portfolio.md); re-check current pricing.

| Item | Estimate |
|---|---|
| Collection and metrics | Deterministic GitHub queries; no model cost |
| Weekly explanation and recommendations | `smart` over the metric tables and the outlier pull requests and runs: ≈ **$0.05–0.15 per report** |
| Infrastructure | Shared platform; GitHub MCP server (shared with the CVE Remediator); results kept in Postgres |
| Prototype build | ~2 weeks: GitHub collection, metric queries and stage breakdowns, synthetic history generator with planted bottlenecks, report template, approval step, issue filing |
| **Monthly cost** | Under $1 for this repository |

## Risks

| Risk | Impact | Likelihood |
|---|---|---|
| Metrics computed wrongly (a missed deploy, an incident not linked to its change) | Wrong conclusions; lost trust in the report | Medium |
| Metrics used to rank individual developers | Gaming, damaged trust | Medium |
| Recommendations that improve the number and not the delivery (split changes to raise deploy frequency, under-report incidents) | Worse delivery behind better numbers | Low–Medium |
| Confident explanation that doesn't follow from the data | Effort spent on the wrong fix | Medium |
| Pull request, commit or issue text contains injected instructions | Report or issues manipulated | Low |
| Synthetic results presented as if they were this project's real performance | Misleading claims | Low |

## Controls

| Control | Type | Addresses |
|---|---|---|
| Numbers come from deterministic queries with the definitions written down; the model never computes a metric. Sample checks against a hand calculation are in the eval suite | Preventive | Wrong metrics |
| Team and repository level only: no per-person metrics in the report or the stored data | Preventive | Ranking individuals |
| Each recommendation names the metric it should move and a counter-metric it must not worsen (deploy frequency with change failure rate, lead time with incident count) | Preventive | Gaming the numbers |
| Every claim cites the pull requests, runs or issues behind it; claims without a citation are dropped | Preventive | Unsupported explanations |
| Read-only GitHub access, except filing issues after a person approves | Preventive | Unwanted changes |
| Pull request, commit and issue text treated as data and screened by the injection guardrail | Preventive | Injected instructions |
| Every report states its data source and labels synthetic data | Preventive | Misleading claims |
| Eval suite on the synthetic history: planted bottlenecks, an unlinked incident, an injection in a pull request description | Detective | Regressions |

## Prototype scope and success measures

- **In scope:** this repository plus a seeded synthetic repository; the four metrics with stage breakdowns; weekly report; recommendations with approval; issue filing; follow-up check on approved recommendations.
- **Out of scope:** other code hosts, incident-management or paging tools, per-person metrics, the SPACE or developer-survey measures of developer experience.
- **Success measures:**

| Measure | Target |
|---|---|
| Metrics matching a hand calculation on the synthetic history | 100% |
| Planted bottlenecks found and correctly explained | 80% or more |
| Claims in the report citing a source record | 100% |
| Recommendations that worsen their counter-metric in the synthetic replay | 0 |
| Cost per weekly report | under $0.25 |
