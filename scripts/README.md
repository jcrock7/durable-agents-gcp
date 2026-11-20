# Scripts

Folders are named for **where and how often** you run them. The full order, with checks after each step, is in [docs/RUNBOOK.md](../docs/RUNBOOK.md).

| Folder | When | Scripts, in the order you run them |
|---|---|---|
| [`local/`](local/) | Your PC: once to set up, then each k3d session | `bootstrap-wsl.sh` → `verify-tools.sh` → `install-git-hooks.sh` (once); `k3d-up.sh` → `apply-k8s.sh` → `k3d-down.sh` (each session) |
| [`gcp/`](gcp/) | **Once per GCP project** (re-run to change settings) | `cost-guardrails.sh` (always first) → `foundation.sh` |
| [`gke/`](gke/) | **Each GKE session** | `up.sh` → `apply-k8s.sh` → `down.sh` (which runs `check-orphans.sh`) |
| [`lib/`](lib/) | **Never run directly.** Shared functions that the scripts above load with `source` | `common.sh`, `terraform.sh`, `k8s.sh`, `images.sh` |

## What each script does

| Script | Does | Reads |
|---|---|---|
| `local/bootstrap-wsl.sh` | Installs the toolchain in WSL with pinned versions | — |
| `local/verify-tools.sh` | Checks every tool is installed; fails if one is missing | — |
| `local/install-git-hooks.sh` | Installs pre-commit + gitleaks so secrets can't be committed | — |
| `local/k3d-up.sh` / `k3d-down.sh` | Creates / deletes (or `--stop` pauses) the local cluster | `K3D_*` |
| `local/apply-k8s.sh` | Builds the worker, docs and match-engine images, then deploys the platform to k3d: operator, secrets, Postgres, Temporal, LiteLLM, agent keys, worker, MCP servers (and loads the synthetic ERP once), placeholder API. `diff` previews | `PROJECT_ID` |
| `local/build-push.sh [app]` | Builds `apps/<app>/Dockerfile` (default `worker`), pushes it to the k3d registry, records it in `overlays/local/images.env`. Run by `apply-k8s.sh` | `K3D_REGISTRY_*` |
| `local/load-secrets.sh` | Optional: copies `SECRET_*` values from `.env` into a k3d Secret `agent-secrets`, for third-party keys an agent may need. Not used by the platform | `SECRET_*` |
| `local/mcp-verify.sh` | Port-forwards the MCP servers and checks them through the agent's allow-listed client: tools per server, one call each, write tools hidden from the model. Changes no data | — |
| `local/erp-load.sh` | Resets the synthetic ERP (database `erp`) to its seeded state, dropping every resolution and outbox message | — |
| `local/match-engine-load.sh [seconds] [concurrency]` | HPA demo: runs a load-test Job against match-engine in the cluster and prints CPU and replicas every 15 seconds as it scales up and back down | — |
| `local/erp-event.sh receipt|reply INV-<n> [text]` | Invoice Exception Resolver demo: posts a goods receipt or a vendor reply in the synthetic ERP and signals the case to re-check at once | — |
| `local/invoice-evals.sh [models label]` | Runs the Invoice Exception Resolver evals (promptfoo) against the deployed agent, writes its `evals/RESULTS.md`, then resets the ERP. Costs about $0.005 a case on Flash-Lite | `EVAL_SCENARIOS`, `EVAL_PER_SCENARIO`, `EVAL_LIMIT` |
| `gcp/cost-guardrails.sh` | `plan`, `apply`, `test`, `status`, `destroy` for budget alerts and the enforcer | Cost guardrails block |
| `gcp/foundation.sh` | `plan`, `apply`, `output`, `destroy` for the persistent layer: registry, backup bucket, service accounts, secrets, IAP, CI federation | Foundation block |
| `gke/up.sh` | Creates the per-session cluster layer and points kubectl at it. `plan` previews | Cluster block |
| `gke/build-push.sh [app]` | Builds `apps/<app>/Dockerfile` (default `worker`), pushes it to Artifact Registry, records it in `overlays/gke/images.env`. Run by `apply-k8s.sh` | `PROJECT_ID`, `REGION`, `AR_REPO` |
| `gke/apply-k8s.sh` | Builds the worker, docs and match-engine images, then deploys the platform to GKE, with secrets from Secret Manager, Spot, backups, Gateway + IAP. `diff` previews | `IAP_OAUTH_*` |
| `gke/down.sh` | Backs up Postgres, deletes Gateways, destroys the cluster layer. `--yes`, `--no-backup` | Cluster block |
| `gke/check-orphans.sh` | Lists anything still billing after a teardown | — |

## The shared library (`lib/`)

| File | Provides |
|---|---|
| `common.sh` | `REPO_ROOT`, `load_env` (reads `.env`), `log` / `warn` / `die`, `require_cmd`, `refuse_root`. Turns on strict mode (`set -euo pipefail`), so any failed command stops the script |
| `terraform.sh` | `tf_require_settings` (rejects placeholder values), `tf_ensure_state_bucket`, `tf_init`, `csv_to_json_list` |
| `k8s.sh` | `install_cnpg_operator`, `apply_secret`, `ensure_platform_secrets` (Secret Manager on GKE, random on k3d), `wait_for_services`, `ensure_litellm_ui_admin` (creates the `admin` UI user and prints an invitation link until its password is set), `ensure_litellm_agent_keys` (one LiteLLM key per agent with the budget in `AGENT_BUDGETS_USD`, in Secret `litellm-agent-keys`), `wait_for_worker` |
| `images.sh` | `image_tag` (commit, plus a timestamp for uncommitted changes), `build_image`, `record_image`, `k3d_registry_name` |

Every runnable script starts the same way:

```bash
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
```

## Conventions

- Run as your normal user in WSL, never with `sudo` (`refuse_root` stops it). Only `bootstrap-wsl.sh` calls `sudo` itself, for package installs.
- Settings and secrets come from `.env` (gitignored). Secret values are never printed or written to files in the repo.
- Scripts are safe to re-run: they apply changes rather than recreating things.
- If a script stops without a message, run it with `bash -x` to see the failing line.
