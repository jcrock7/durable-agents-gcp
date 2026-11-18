# Business case: AML Alert Investigator

- **Category:** Business problem (financial crime compliance)
- **Status:** Prototype planned, first to build ([ADR-0017](../../../docs/adr/0017-prototype-agent-portfolio.md))
- **Users:** Anti-money-laundering (AML) investigators and their reviewers

## Summary

Transaction-monitoring systems flag activity that might be money laundering. The large majority of alerts turn out to be legitimate, but each one has to be investigated and documented. Investigators spend most of their time gathering evidence from several systems rather than judging it. The AML Alert Investigator gathers that evidence, scores the alert, and drafts a case narrative in which every statement cites its source record. The investigator makes the decision; the agent never closes, escalates or files anything on its own.

## Business purpose

**The problem**

- Banks and broker-dealers must monitor for suspicious activity and file Suspicious Activity Reports (SARs) when warranted, generally within 30 days of detecting it. Regulators expect each alert decision to be documented and defensible.
- An investigator typically pulls the customer profile and expected activity, transaction history, linked accounts and counterparties, prior alerts, and news and sanctions screening results, then writes up the reasoning. Gathering and write-up can take 30–90 minutes per alert.
- Alert volumes rise faster than staff, creating backlogs. Backlogs lead to late filings, and weak or inconsistent documentation is a frequent finding in regulatory exams.

**What the agent does**

1. Receives an alert (from a synthetic alert generator in the prototype): the rule that fired and the transactions involved.
2. Gathers evidence with read-only tools: customer profile and stated purpose of the account, 12 months of transactions, linked accounts, counterparties, prior alerts and outcomes, and simulated news and sanctions screening results.
3. Compares observed activity with expected activity and with known typologies (e.g., structuring, rapid movement of funds, funnel accounts).
4. Produces a risk score with the factors behind it, and a recommendation: likely legitimate, needs more review, or potential SAR.
5. Drafts the case narrative, with a citation to the source record for every factual claim.
6. **Hands the case to an investigator**, who accepts, edits or rejects the draft and makes the disposition decision. High-risk cases also go to a second reviewer.
7. Records everything: evidence retrieved, score, draft, edits and the human decision.

## Value proposition

| Benefit | How it's measured |
|---|---|
| Less investigator time per alert | Minutes per alert, before vs. after |
| Smaller backlog; fewer late SAR decisions | Alerts past their internal deadline |
| More consistent, exam-ready documentation | Quality-assurance review scores; share of claims with a source citation |
| Investigator time moves to the high-risk cases | Time spent on alerts later escalated vs. closed |
| Better feedback for tuning monitoring rules | Reasons for false positives captured in structured form |

**Illustrative value model** (assumptions to replace with real volumes):

| Assumption | Example value |
|---|---|
| Alerts per month | 5,000 |
| Investigator time per alert today | 45 minutes |
| Share of that time spent gathering evidence and writing | 60% |
| Time on those tasks removed by the agent | 70% |
| Loaded cost per investigator hour | $75 |
| **Investigator hours saved per month** | 5,000 × 45 min × 60% × 70% ≈ **1,575 hours** |
| **Labor value per month** | 1,575 × $75 ≈ **$118,000** |

Labor savings understate the value. The bigger exposure is regulatory: late filings and weak documentation lead to findings, remediation programs and penalties. Consistent, cited narratives reduce that exposure, though no prototype can put a number on it.

## Cost

| Item | Estimate |
|---|---|
| Model usage per alert | ~6–8 `fast` calls (evidence summaries, typology checks) + 1 `smart` call (narrative): roughly 80,000 tokens in, 8,000 out ≈ **$0.08–0.12** |
| Infrastructure | Shared platform cost (~$0.08–0.15/hour while the cluster is up) |
| Prototype build | ~3 weeks: workflow, read-only evidence tools, synthetic data generator with planted typologies, citation checker, eval suite, investigator review UI |
| **Monthly model cost at 5,000 alerts** | ~$400–600 |

**Production cost drivers** (not in the prototype): integration with the monitoring platform and case-management system, model validation by an independent model risk team, and ongoing tuning and quality-assurance review.

## Risks

| Risk | Impact | Likelihood |
|---|---|---|
| Agent misses real suspicious activity and recommends "likely legitimate" | Unfiled SAR; regulatory and criminal-exposure risk | Medium |
| Narrative states a "fact" that isn't in the evidence (hallucination) | Inaccurate filing; loss of examiner trust | Medium |
| Investigators rubber-stamp the agent's recommendation (automation bias) | Human review becomes nominal | Medium |
| Customer is tipped off that they are under investigation | SAR confidentiality violation (prohibited by law) | Low |
| Risk scores are biased by attributes such as nationality or name | Unfair treatment; fair-lending and reputational risk | Low–Medium |
| Agent can't explain its score in a way an examiner accepts | Model can't be used in production | Medium |
| Evidence text (e.g., a wire memo or news article) contains injected instructions | Agent manipulated into a wrong recommendation | Low |

## Controls

| Control | Type | Addresses |
|---|---|---|
| **No autonomous disposition:** the agent has no tool to close, escalate or file; only a person can | Preventive | Missed activity, rubber-stamping consequences |
| Citation checker: every factual sentence must link to a retrieved record, and a deterministic check verifies the cited values match; failing drafts are rejected | Preventive | Hallucination |
| Read-only tools only; no tool can contact a customer or write to any customer record | Preventive | Tipping off |
| Score must list its contributing factors and the typology matched; factors exclude protected attributes | Preventive | Explainability, bias |
| Second reviewer required for high-risk scores and for any "likely legitimate" on a high-value alert | Preventive | Missed activity |
| Sampled quality-assurance: a share of agent-assisted closures re-reviewed in full; agreement rate tracked | Detective | Rubber-stamping, missed activity |
| Eval suite with planted typologies, measured on recall of true suspicious cases (missing one is far worse than a false alarm) | Detective | Missed activity regressions |
| Bias tests: same activity, varied names and nationalities; scores must not change | Detective | Bias |
| Evidence text treated as data and screened by the injection guardrail | Preventive | Injected instructions |
| Complete record of evidence, score, draft, edits and decision for examiners | Detective | All |

## Prototype scope and success measures

- **In scope:** synthetic customers, accounts and transactions with planted typologies and realistic noise; alerts from three to five monitoring rules; evidence gathering, scoring, cited narrative and investigator review UI.
- **Out of scope:** real monitoring systems or customer data, actual SAR filing, and sanctions screening against real lists (simulated only).
- **Success measures:** recall ≥ 95% on planted suspicious cases in the eval set; 100% of narrative claims pass the citation check; no change in scores across the bias-test variations; median agent time per alert under 2 minutes.
