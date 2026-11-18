# Platform

Everything deployed to Google Cloud, organized by layer. Each layer keeps its Terraform, code and configuration together ([ADR-0016](../docs/adr/0016-repository-structure.md)).

| Layer | Lifecycle | Contents | Script | Status |
|---|---|---|---|---|
| [`cost-guardrails/`](cost-guardrails/) | Once, **first** | Budget, alerts, enforcer function, cluster time limit ([ADR-0015](../docs/adr/0015-cost-guardrails.md)) | [`scripts/gcp/cost-guardrails.sh`](../scripts/gcp/cost-guardrails.sh) | Built |
| [`foundation/`](foundation/terraform/) | Persistent, always on | Artifact Registry, Postgres backup bucket, workload service accounts, generated secrets, IAP access, GitHub Actions federation | [`scripts/gcp/foundation.sh`](../scripts/gcp/foundation.sh) | Built |
| [`cluster/`](cluster/terraform/) | Per session | VPC + Cloud NAT, GKE Autopilot, Workload Identity bindings, gateway IP and certificate | [`scripts/gke/up.sh`](../scripts/gke/up.sh), [`down.sh`](../scripts/gke/down.sh) | Built |
| [`modules/`](modules/) | Shared | `network`, `gke-autopilot` | (used by `cluster/`) | Built |
| [`services/`](services/) | Inside the cluster | Postgres (CloudNativePG + pgvector), Temporal dev server, LiteLLM with the prompt-injection guardrail | (included by `k8s/` overlays) | Built |
| [`k8s/`](k8s/) | Inside the cluster | Namespace, service accounts, limits, network policies; Gateway + HTTPS + IAP on GKE, Traefik on k3d | [`scripts/gke/apply-k8s.sh`](../scripts/gke/apply-k8s.sh), [`scripts/local/apply-k8s.sh`](../scripts/local/apply-k8s.sh) | Built |

## How the Terraform works

### The building blocks

| Term | What it is here |
|---|---|
| **Provider** | The plugin that talks to an API. Every layer uses `hashicorp/google`; `random` generates passwords, `archive` zips the enforcer function, `time` adds a wait. Versions are pinned in each layer's `versions.tf`. |
| **Resource** | One thing Terraform creates and owns, e.g. `google_container_cluster`. Change the code and Terraform changes the real thing to match. |
| **Data source** | Something Terraform only reads, e.g. `google_project` or `terraform_remote_state`. |
| **Module** | A reusable folder of resources with inputs (`variables.tf`) and outputs (`outputs.tf`). `modules/network` and `modules/gke-autopilot` are modules. |
| **Root module (layer)** | A folder you run `terraform` in. It has its own state. `cost-guardrails/terraform`, `foundation/terraform` and `cluster/terraform` are the three roots. |
| **Variables** | Inputs. The scripts set them from `.env` as `TF_VAR_<name>` environment variables, so no `.tfvars` file with real values is ever needed (and `*.tfvars` is gitignored). |
| **Outputs** | Values a layer publishes: printed after `apply`, and readable by other layers. |
| **State** | Terraform's record of what it created, stored in the private, versioned bucket `TF_STATE_BUCKET`, one **prefix** per layer (`cost-guardrails/`, `foundation/`, `cluster/`). Generated secrets are in state, which is why the bucket is private and state is never committed. |

### Why three layers instead of one

Each layer has a different lifecycle, so each has its own state. Destroying the cluster can never touch the registry, secrets or budget.

```text
cost-guardrails  ──(once)──────────────────────────────────────────────►  keeps running
foundation       ──(once)──────────────────────────────────────────────►  keeps running
cluster                    up ───── session ───── down        up ─── down
                           │ reads foundation outputs via terraform_remote_state
```

- **cost-guardrails** has no dependencies and is deployed first, so spending is capped before anything expensive exists.
- **foundation** creates things that are cheap and slow to recreate: images, secrets, service accounts, backups.
- **cluster** creates everything billed by the hour. It **reads** foundation's outputs (service account emails, namespace) with a `terraform_remote_state` data source instead of hard-coding them.

### How a script runs a layer

Every script does the same four steps:

1. **Load settings** from `.env` and export them as `TF_VAR_*` variables.
2. **`terraform init`** with `-backend-config=bucket=$TF_STATE_BUCKET`. This connects the folder to its state and downloads providers. The state prefix is fixed in the layer's `versions.tf`.
3. **`terraform plan`** compares the code with the state and real infrastructure, and shows what would change. Nothing is changed.
4. **`terraform apply`** shows the same plan and asks for `yes` before changing anything.

### Reading a plan

| Symbol | Meaning |
|---|---|
| `+` create | New resource |
| `~` update in place | Existing resource modified |
| `-/+` replace | Destroyed and recreated. **Read these carefully**: on a cluster or bucket this means downtime or data loss |
| `-` destroy | Removed |

The last line summarizes it: `Plan: 12 to add, 0 to change, 0 to destroy.` After a successful apply, running `plan` again should show **no changes**. If it doesn't, something changed outside Terraform ("drift").

### Order of operations

```bash
scripts/gcp/cost-guardrails.sh apply   # once, first
scripts/gcp/foundation.sh apply        # once
scripts/gke/up.sh                      # each session (~10 min); also runs get-credentials
scripts/gke/apply-k8s.sh               # each session: namespace, policies, Gateway + IAP (platform/k8s)
#   ... deploy workloads, work, demo ...
scripts/gke/down.sh                    # each session (~10 min); then checks for leftovers
```

Use `plan` first whenever you're unsure: `scripts/gcp/foundation.sh plan`, `scripts/gke/up.sh plan`.

### Things to know

- **Destroy in reverse order.** `down.sh` before `foundation.sh destroy`; the cluster depends on foundation's service accounts.
- **Resources created outside Terraform.** The GKE Gateway creates its own load balancer. `down.sh` deletes Gateways first so GKE removes it; otherwise it would block deleting the network. `check-orphans.sh` lists anything still billing.
- **If the budget enforcer deletes the cluster** (time limit or budget), Terraform's state still lists it. The next `plan` notices it's gone, and `up.sh` recreates it.
- **Lock files.** The first `init` in each layer writes `.terraform.lock.hcl`, recording exact provider versions. Commit these so every machine uses the same versions.
- **Don't edit state by hand**, and don't run two applies on the same layer at once (the GCS backend locks state to prevent this).
- **Workload Identity Federation pools** are kept for 30 days after deletion, so after destroying foundation the same pool ID can't be reused until then.
