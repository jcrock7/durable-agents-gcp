# ADR-0016: Repository structure — agents by agent, platform by layer

- **Status:** Accepted — amends [ADR-0009](0009-evals-promptfoo.md) (evals move into each agent's folder)
- **Date:** 2026-11-17

## Context

The repo started with folders by file type: `infra/terraform/`, `functions/`, a planned top-level `k8s/` and `evals/`. Related things were split apart. The budget enforcer's code lived in `functions/`, while the Terraform that deploys it lived in `infra/`. An agent's eval cases would have lived far from its code. As more agents are added, finding everything that belongs to one agent or one platform layer would get harder.

## Decision

Organize by **what a thing belongs to**, not by file type:

```text
agents/                one folder per industry (general/, financial-services/, …), then one
                       self-contained folder per agent: workflows, activities, tools, prompts, tests, evals
apps/                  runtime hosts: api (serves the UI), web, worker (runs every agent)
packages/              shared code: agent-kit (Temporal + model plumbing), contracts (Zod schemas)
platform/              everything deployed to GCP, by layer:
  cost-guardrails/       terraform/ + enforcer/ (deployed first)
  foundation/            persistent: state, registry, secrets, service accounts
  cluster/               ephemeral: VPC, Autopilot, Gateway + IAP
  services/              temporal/, litellm/ (incl. LLM guardrail evals), postgres/
  k8s/                   Kustomize base + overlays (local, gke)
  modules/               shared Terraform modules
scripts/               operator entry points (local/, gcp/, gke/, lib/)
docs/                  setup guide, architecture brief, decision records
```

Agent conventions are documented in [`agents/README.md`](../../agents/README.md); platform layers in [`platform/README.md`](../../platform/README.md).

## Alternatives considered

| Option | Why not |
|---|---|
| By file type (`infra/`, `functions/`, `k8s/`, `evals/`) | Splits one component across several top-level folders |
| One package per agent with its own Deployment and Terraform | Duplicates platform setup per agent; [ADR-0013](0013-consolidated-workloads.md) runs all agents in one worker |
| Separate repos for platform and agents | More overhead than one small project needs; harder for reviewers to follow |

## Consequences

- **Positive:** Adding an agent touches one folder plus one registration line in `apps/worker`. Platform layers map one-to-one to their lifecycle (first, persistent, per session, in-cluster).
- **Negative / risks:** Paths in scripts and Terraform reference the new layout. Terraform state is unaffected because state is keyed by backend prefix, not folder path.
- **Moved in this change:** `infra/terraform/cost-guardrails` → `platform/cost-guardrails/terraform`; `functions/budget-enforcer` → `platform/cost-guardrails/enforcer`.
