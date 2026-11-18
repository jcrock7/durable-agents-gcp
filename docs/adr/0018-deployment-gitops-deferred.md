# ADR-0018: Deploy with scripts and CI; defer a GitOps controller (Argo CD)

- **Status:** Accepted
- **Date:** 2026-11-18

## Context

A GitOps controller such as Argo CD watches a git repository and keeps the cluster matching it: drift is corrected automatically, and rollback is a `git revert`. It is a common production pattern, so the question is whether it earns its place here.

What this project looks like today:

- **Clusters are disposable.** A GKE cluster is created for a session and deleted within 8 hours ([ADR-0015](0015-cost-guardrails.md)); k3d clusters are recreated freely. A controller would be reinstalled and resynced every session.
- **Desired state is already declarative.** Kustomize base + `local` / `gke` overlays, pinned image digests for platform services, and `kubectl apply -k` from the apply scripts.
- **Image tags are not in git.** `build-push.sh` tags images with the commit (plus a timestamp for uncommitted work) and records them in the overlay's gitignored `images.env`. A controller that deploys from git needs the tag committed, or an extra component (Argo CD Image Updater) to write it.
- **Some state is created at deploy time.** The apply scripts create the per-agent LiteLLM keys (Secret `litellm-agent-keys`) and the LiteLLM admin user. A controller would need External Secrets or the Secret Manager CSI driver to own these.
- **The repo is public.** A GitOps loop means every change to see on a cluster is a commit and push.
- **Cost and footprint matter** ([ADR-0013](0013-consolidated-workloads.md)). Argo CD adds 5–7 pods (server, application controller, repo server, Redis, ApplicationSet, Dex), roughly 0.5–1 vCPU and 1–1.5 GB requested on Autopilot, plus spin-up time and another thing to debug mid-demo.

## Decision

- **Now:** deploy with the apply scripts (`scripts/local/apply-k8s.sh`, `scripts/gke/apply-k8s.sh`). Git stays the source of truth for manifests; the scripts apply it.
- **Next:** add a GitHub Actions deploy job for GKE that authenticates with the existing Workload Identity Federation (`platform/foundation/terraform/ci.tf`, no stored keys): build and push the image, then apply the `gke` overlay. Push-based, keyless, and reviewable in pull requests.
- **Defer** a pull-based GitOps controller (Argo CD, Flux, or GKE Config Sync) until a trigger below applies.

## Alternatives considered

| Option | Why not (for now) |
|---|---|
| Argo CD on each cluster | Reinstalled every session; 5–7 extra pods; needs image tags in git and a secrets operator; slows the edit-and-see loop to commit-and-push |
| Flux | Lighter than Argo CD (no UI), but the same image-tag and secrets changes, and less to show in a demo |
| GKE Config Sync | Managed GitOps for GKE and a natural fit for this stack; same workflow changes as Argo CD, no local (k3d) equivalent, and pricing should be checked before adopting |
| Skaffold or Tilt for the inner loop | Useful for rebuild-on-save, but solves a different problem (local iteration speed, not deployment). Reconsider if the build-push-apply loop becomes slow |

## Consequences

- **Positive:** No extra pods or cost; edits deploy in one command on k3d and GKE; secrets stay out of git and out of a controller; the CI deploy shows keyless, auditable delivery.
- **Negative / risks:** No automatic drift correction: a manual `kubectl edit` persists until the next apply. Rollback means re-running apply from an earlier commit rather than a `git revert` the cluster follows on its own.
- **CI deploy needs more access:** the `github-ci` service account can only push images today. Deploying adds a GKE role (`roles/container.developer`), which should be limited to runs on `main` (the federation already maps `attribute.ref`).
- **Path to GitOps:** the overlays are already what a controller would sync. Moving means committing image tags (or adding an image updater), moving the agent keys to Secret Manager with External Secrets, and installing the controller in `cluster` Terraform or `platform/k8s`.
- **Revisit when:** a long-lived cluster exists (staging or shared), more than one person deploys, there are several environments to keep in step, or demonstrating drift correction becomes a goal in itself.
