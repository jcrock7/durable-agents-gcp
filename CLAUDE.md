# CLAUDE.md

## What this repo is

A reference architecture for running AI agents on Google Cloud that finish the job, safely and on budget. Agent runs are durable (Temporal), every model call goes through one gateway (LiteLLM on Vertex AI), and the GKE environment is created when needed and destroyed when idle (Terraform, with cost guardrails). The repo is public: never commit secrets. Overview and architecture: `README.md`.

## Commands

Node 24 and pnpm 12 (see `package.json`).

- Install: `pnpm install`
- Build: `pnpm build` (runs `tsc -b`)
- Test: `pnpm test` (runs `tsc -b && vitest run`; about 30 seconds, no cluster needed)
- Watch tests: `pnpm test:watch`
- LiteLLM Python tests, in the pinned LiteLLM image (from `platform/services/README.md`):

```bash
docker run --rm -v "$PWD/platform/services/litellm:/svc" -w /svc --entrypoint python \
  ghcr.io/berriai/litellm-non_root:v1.106.6 -m unittest discover -s tests -v
```

- Run locally on k3d, and on GKE: follow `docs/RUNBOOK.md` (scripts live in `scripts/`, see `scripts/README.md`). Settings come from `.env` (copy `.env.example`; gitignored).
- There is no lint script.

## Layout

Organised by what a thing belongs to (ADR-0016):

- `agents/<industry>/<agent>/`: one self-contained folder per agent (workflows, activities, tools, prompts, tests, evals). Conventions: `agents/README.md`. Only `agents/general/research-summarize` is implemented so far.
- `apps/worker/`: the single Temporal worker that runs every agent, plus its Dockerfile and k8s files.
- `packages/agent-kit/`: shared LiteLLM clients, retry presets, heartbeats, review gate.
- `platform/`: everything deployed to GCP, by layer: `cost-guardrails`, `foundation`, `cluster`, `k8s` (Kustomize), `services` (Postgres, Temporal, LiteLLM), `modules`. See `platform/README.md`.
- `scripts/`: operator entry points, named for when you run them (`local/`, `gcp/`, `gke/`, `lib/`).
- `docs/`: `RUNBOOK.md` (step by step), `SETUP.md` (reference), `architecture.html`, `adr/`.

The pnpm workspace (`pnpm-workspace.yaml`) covers `packages/*`, `apps/*` and `agents/*/*`.

## Conventions

- TypeScript, ESM, one pnpm monorepo (ADR-0001). Tests import compiled packages from `dist/`, which is why `pnpm test` builds first.
- Python is used only where it clearly wins (the LiteLLM guardrail and mock provider in `platform/services/litellm/config/`).
- Pin versions exactly, as `package.json` does.

## Testing

- TypeScript tests live in `{packages,apps}/*/test/` and `agents/*/*/test/` (see `vitest.config.ts`). Workflow tests use Temporal's time-skipping test server.
- LiteLLM Python tests live in `platform/services/litellm/tests/`.
- Run one test file: `pnpm build && pnpm exec vitest run <path>`.

## Architecture decisions (ADRs)

Decisions are recorded in `docs/adr/NNNN-slug.md`, numbered in sequence (next is 0019), copied from `docs/adr/template.md`. Fill in Status, Date, Context, Decision, Alternatives considered and Consequences. Never delete old ADRs; mark them superseded. Read the relevant ADR before changing what it decides. Index: the tech stack table in `README.md`.

## UI

`apps/web` does not exist yet. ADR-0001 fixes the stack as React + Vite + TypeScript (a single-page app served by the API, per ADR-0013). The first UI feature therefore sets the conventions: structure, styling, components, accessibility and testing. Record those choices in an ADR and add a UI section to this file when they are made. `apps/api` and `packages/contracts` are also planned and absent.

## Do not touch

- `.env`, anything secret, Terraform state or `*.tfvars`, kubeconfigs, key files. Pre-commit (gitleaks) and CI secret scanning enforce this.
- `platform/` and `scripts/gcp`, `scripts/gke` change real cloud infrastructure and cost money: do not run them, and change them only when the task is about them.
- `factory.yml`, `CLAUDE.md` and `.github/` are owner-controlled.

## Pointers

- `README.md`: architecture, tech stack, cost, roadmap.
- `docs/RUNBOOK.md`, `docs/SETUP.md`: running and reference.
- `docs/adr/`: decision records.
- `agents/README.md`, `platform/README.md`, `scripts/README.md`: per-area conventions.
