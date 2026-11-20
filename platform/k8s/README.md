# Kubernetes platform layer

Kustomize manifests for what every workload shares: the namespace, service accounts, limits, network policies, and the public edge (Gateway, HTTPS, Identity-Aware Proxy). The services themselves (Temporal, LiteLLM, Postgres) live in [`platform/services/`](../services/) and are included by these overlays; the app goes in `apps/`.

```text
platform/k8s/
├── base/                         # same everywhere
│   ├── namespace.yaml            # "agents", Pod Security: enforce restricted
│   ├── serviceaccounts.yaml      # api, worker, litellm (no token automount)
│   ├── limits.yaml               # default requests + namespace quota (4 vCPU, 8 GiB, 30 pods, no LoadBalancers)
│   └── networkpolicies.yaml      # deny all inbound, then allow only the architecture's paths
└── overlays/
    ├── local/                    # k3d: Traefik Ingress on http://localhost, no sign-in
    └── gke/                      # GKE: Gateway + managed certificate + IAP, Workload Identity annotations
```

## How Kustomize is used

- **base** holds plain manifests shared by every environment.
- **overlays** start from base and add or patch what differs. `kubectl apply -k <overlay>` renders and applies one.
- **components** are optional add-ons an overlay can include (`components:`). There are none now: the placeholder API that stood in for the portal has been replaced by `apps/api`.
- **Environment values** (IP and certificate names, hostname, service account emails, IAP client ID) aren't committed. `scripts/gke/apply-k8s.sh` writes them from Terraform outputs and `.env` into `overlays/gke/cluster.env` (gitignored). The overlay's `replacements` copy them into the manifests. See `cluster.env.example`. App images work the same way: `build-push.sh` writes `overlays/<env>/images.env` (gitignored, see `images.env.example`), and the overlay sets the worker image from it.

Preview without applying: `kubectl kustomize platform/k8s/overlays/local`, or `scripts/gke/apply-k8s.sh diff` on GKE.

## Network policies

All inbound traffic in `agents` is denied, then these paths are allowed:

| To | From | Port |
|---|---|---|
| `api` | Google load balancers and health checks (`35.191.0.0/16`, `130.211.0.0/22`); Traefik on k3d | any |
| `temporal` | `api`, `worker` | 7233 |
| `litellm` | `worker` | 4000 |
| Postgres (`cnpg.io/cluster: agents-pg`) | `api`, `worker`, `litellm` on 5432; other Postgres pods and the CloudNativePG operator on any port | 5432 / any |

Workloads must use the label `app.kubernetes.io/name: api | worker | litellm | temporal` for these to match.

## Running it

### Local (k3d)

```bash
scripts/local/k3d-up.sh
scripts/local/apply-k8s.sh
open http://localhost/          # the agent portal (apps/api)
```

### GKE

One-time setup: create an OAuth client for Identity-Aware Proxy. Google's API for creating these was retired, so this step is manual.

1. In the console, open **Google Auth Platform** for the project.
2. **Branding:** set an app name and support email.
3. **Audience:** choose **External**. While the app is in *Testing*, add each person in `IAP_MEMBERS` as a test user.
4. **Clients → Create client → Web application.** Copy the client ID and secret into `.env` as `IAP_OAUTH_CLIENT_ID` and `IAP_OAUTH_CLIENT_SECRET`.
5. Edit the client and add this **Authorized redirect URI** (with your client ID):
   `https://iap.googleapis.com/v1/oauth/clientIds/<IAP_OAUTH_CLIENT_ID>:handleRedirect`

Each session:

```bash
scripts/gke/up.sh              # cluster (Terraform)
scripts/gke/apply-k8s.sh       # this layer
```

`apply-k8s.sh` checks that kubectl points at the right cluster, writes `cluster.env`, creates the `iap-oauth-client` Secret, applies the overlay, waits for the Gateway, and prints the certificate status and app URL.

**Timing:** the load balancer is ready in a few minutes. The Google-managed certificate turns **ACTIVE 15–60 minutes** after that; until then HTTPS fails with a certificate error. After that, opening the URL asks for a Google sign-in, and only `IAP_MEMBERS` get through.

`scripts/gke/down.sh` deletes the Gateway first, so GKE removes the load balancer before Terraform destroys the network.

## The portal at the edge

Both overlays deploy the agent portal from [`apps/api/k8s`](../../apps/api/k8s/) ([README](../../apps/api/README.md)), which replaced the placeholder API. It keeps the edge's contract:

- use the `api` service account and the `app.kubernetes.io/name: api` label
- expose a Service named `api` on port 80
- answer `GET /healthz` with 200 (the load balancer health check)
