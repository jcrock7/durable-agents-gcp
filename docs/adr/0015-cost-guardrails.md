# ADR-0015: Cost guardrails — forecast alerts, automatic cluster shutdown, and a billing hard cap

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

The platform is meant to cost about $0.08–0.15/hour while running and close to nothing while idle ([ADR-0014](0014-gke-autopilot-spot.md)). The real risks are a cluster left running after a session, a runaway agent burning model tokens, and a misconfiguration that creates expensive resources. GCP budgets only **alert**; they never stop spending on their own. Billing data also lags actual usage by hours, so any spend-based control reacts late.

## Decision

Deploy a separate Terraform root module, `platform/cost-guardrails/terraform` (function code in `platform/cost-guardrails/enforcer`), **before** any other infrastructure. It contains:

1. **Monthly Cloud Billing budget** scoped to the project. Cost is measured **after Free Tier usage and usage discounts** (which never become a bill) but **before promotional credits** such as the $300 trial, so trial credit can't hide real spend. Without the Free Tier subtraction, the free GKE cluster fee alone (~$0.10/hour) would count toward the budget and trigger the guardrails early.
2. **Forecast alerts** at 80% and 100% of the budget (`FORECASTED_SPEND`): "we expect to exceed the budget this month".
3. **Actual-spend alerts** at 50%, 90% and 100% (`CURRENT_SPEND`), emailed to listed addresses and billing admins.
4. **Budget enforcer**: a Cloud Run function (gen2, Node.js) subscribed to the budget's Pub/Sub topic.
   - At **100% actual spend**: deletes every GKE cluster in the project (the main cost driver). Recreated later with Terraform.
   - At **120% actual spend**: **disables billing on the project**: the hard cap.
   - On every message: deletes any GKE cluster **older than 8 hours**, triggered hourly by Cloud Scheduler. This catches a forgotten teardown long before billing data shows it.
5. **Dry-run first.** The enforcer ships in `dry_run` mode (logs decisions only). `cost-guardrails.sh test` publishes a fake 130% notification; after checking the logs, switch `BUDGET_ENFORCEMENT_MODE=enforce`.

Spend inside the platform is also capped at the application layer by per-agent LiteLLM budgets ([ADR-0005](0005-llm-gateway-litellm.md)).

## Alternatives considered

| Option | Why not |
|---|---|
| Budget alerts only | Alerts don't stop spend; a forgotten cluster keeps running |
| Disable billing at 100% | Disabling billing is disruptive (all paid services stop, and resources can eventually be deleted). Deleting clusters first removes most of the cost and is easy to undo. |
| Quotas as the only cap | Quotas limit rate, not total monthly spend; still useful as a secondary limit (e.g., Vertex AI tokens per minute) |
| Third-party cost tools | Extra accounts and cost for a single small project |
| Exclude all credits (gross cost) | Counts Free Tier usage as spend, so guardrails fire early |
| Include all credits (net cost) | During the free trial, the $300 credit hides spend and nothing fires until the credit is gone |

## Consequences

- **Positive:** An alert arrives when the month is forecast to go over. A forgotten cluster is removed within about an hour of hitting 8 hours. A hard ceiling exists even if everything else fails.
- **Negative / risks:**
  - **Lag:** budget evaluations run several times a day on billing data that can be hours old, so spend can overshoot a threshold before the enforcer acts. The 8-hour cluster limit and LiteLLM budgets are the faster controls.
  - **Disabling billing** stops every paid service in the project, including the enforcer itself and Cloud Storage. Re-enable with `gcloud billing projects link PROJECT_ID --billing-account=ACCOUNT_ID`. Resources may be deleted if billing stays disabled for a long time.
  - **Permissions:** the person applying needs Billing Account Administrator (or Billing Account Costs Manager plus Project Billing Manager) and Owner on the project. The enforcer's service account gets Project Billing Manager and Kubernetes Engine Cluster Admin on this project only.
  - Long demo or test sessions over 8 hours need `CLUSTER_MAX_HOURS` raised first.
- **Revisit when:** The project moves into an organization with its own FinOps controls, or a session regularly needs more than 8 hours.
