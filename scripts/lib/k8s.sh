#!/usr/bin/env bash
# Kubernetes helpers shared by scripts/local/apply-k8s.sh and scripts/gke/apply-k8s.sh.
# Source after common.sh.

NS="${NS:-agents}"

# Each agent's LiteLLM budget in USD per 30 days. Adding an agent: add it here.
AGENT_BUDGETS_USD=(
  "research-summarize=2"
  "invoice-exception-resolver=3"
)

# Install the CloudNativePG operator (pinned in platform/services/postgres/operator) and wait for it.
install_cnpg_operator() {
  log "installing the CloudNativePG operator"
  kubectl apply --server-side --force-conflicts -k "${REPO_ROOT}/platform/services/postgres/operator" >/dev/null
  kubectl -n cnpg-system rollout status deployment/cnpg-controller-manager --timeout=5m
}

# apply_secret <name> <type> key=value...   (idempotent; values never printed)
apply_secret() {
  local name="$1" type="$2"; shift 2
  local args=()
  for kv in "$@"; do args+=("--from-literal=${kv}"); done
  kubectl -n "$NS" create secret generic "$name" --type="$type" "${args[@]}" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
}

random_password() {
  # tr is killed by SIGPIPE when head has enough; '|| true' keeps pipefail from failing the script.
  { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom || true; } | head -c "${1:-32}"
}

# Platform secrets: pg-app, pg-litellm (CloudNativePG basic-auth) and litellm (master key, DB URL).
#   ensure_platform_secrets gsm    -> values from Secret Manager (GKE; created by the foundation Terraform)
#   ensure_platform_secrets local  -> random values, generated once and kept in the cluster (k3d)
ensure_platform_secrets() {
  local source="$1" app_pw litellm_pw master_key
  if [[ "$source" == "gsm" ]]; then
    local get=(gcloud secrets versions access latest --project "$PROJECT_ID")
    app_pw="$("${get[@]}" --secret postgres-app-password)"
    litellm_pw="$("${get[@]}" --secret postgres-litellm-password)"
    master_key="$("${get[@]}" --secret litellm-master-key)"
  else
    if kubectl -n "$NS" get secret pg-litellm litellm pg-app >/dev/null 2>&1; then
      log "local secrets already exist; keeping them"
      return 0
    fi
    app_pw="$(random_password 32)"
    litellm_pw="$(random_password 32)"
    master_key="sk-$(random_password 40)"
  fi
  [[ -n "$app_pw" && -n "$litellm_pw" && -n "$master_key" ]] || die "could not read platform secrets"

  apply_secret pg-app kubernetes.io/basic-auth "username=app" "password=${app_pw}"
  apply_secret pg-litellm kubernetes.io/basic-auth "username=litellm" "password=${litellm_pw}"
  apply_secret litellm Opaque "master-key=${master_key}" \
    "database-url=postgresql://litellm:${litellm_pw}@agents-pg-rw:5432/litellm"
  log "platform secrets in place: pg-app, pg-litellm, litellm"
}

# LiteLLM Admin UI account. Sign-in with the master key is turned off
# (general_settings.disable_env_credential_login), so this database user is the only way in.
# LiteLLM doesn't let an admin set another user's password: it issues an invitation link where
# the user chooses their own, so no UI password is stored anywhere. Until a password is set,
# each run prints a fresh link (valid 7 days). Run after LiteLLM is ready.
# litellm_user_exists <user_id>: "t" if LiteLLM's database has the user, else "f". Read from the
# database because /user/info answers 200 with a placeholder for unknown users (LiteLLM v1.106).
litellm_user_exists() {
  local primary
  primary="$(kubectl -n "$NS" get cluster.postgresql.cnpg.io/agents-pg -o jsonpath='{.status.currentPrimary}')"
  kubectl -n "$NS" exec "$primary" -c postgres -- psql -tAq litellm -c \
    "select exists (select 1 from \"LiteLLM_UserTable\" where user_id = '$1')"
}

ensure_litellm_ui_admin() {
  local primary has_password invitation
  primary="$(kubectl -n "$NS" get cluster.postgresql.cnpg.io/agents-pg -o jsonpath='{.status.currentPrimary}')"
  has_password="$(kubectl -n "$NS" exec "$primary" -c postgres -- psql -tAq litellm -c \
    "select password is not null from \"LiteLLM_UserTable\" where user_id = 'ui-admin'")"
  if [[ "$has_password" == "t" ]]; then
    log "LiteLLM UI: sign in as 'admin' with the password you chose"
    return 0
  fi
  # The invitation records its creator, and the master key acts as user "default_user_id", which a
  # fresh database doesn't have (foreign key on LiteLLM_InvitationLink.created_by).
  invitation="$(kubectl -n "$NS" exec deploy/litellm -c litellm -- env \
    "USER_EXISTS=$(litellm_user_exists ui-admin)" "CREATOR_EXISTS=$(litellm_user_exists default_user_id)" python -c '
import json, os, urllib.request, urllib.error
headers = {"Authorization": "Bearer " + os.environ["LITELLM_MASTER_KEY"], "Content-Type": "application/json"}
def call(path, body=None):
    req = urllib.request.Request("http://localhost:4000" + path, headers=headers,
                                 data=None if body is None else json.dumps(body).encode())
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)
if os.environ["USER_EXISTS"] != "t":
    call("/user/new", {"user_id": "ui-admin", "user_email": "admin",
                       "user_role": "proxy_admin", "auto_create_key": False})
if os.environ["CREATOR_EXISTS"] != "t":
    call("/user/new", {"user_id": "default_user_id", "user_role": "proxy_admin", "auto_create_key": False})
print(call("/invitation/new", {"user_id": "ui-admin"})["id"])
')"
  log "LiteLLM UI: set the admin password (link valid 7 days), with the LiteLLM port-forward running:"
  log "  http://localhost:4000/ui/onboarding?invitation_id=${invitation}"
}

# One LiteLLM virtual key per agent (models fast and smart only, with the budget above), stored in
# Secret litellm-agent-keys as LITELLM_KEY_<AGENT>. The worker reads that Secret; it never sees
# the master key. Existing keys are kept while LiteLLM still knows them; a key that's missing or
# unknown (for example after a fresh database) is replaced and the worker restarted to pick it up.
# Key values are passed on stdin and never printed.
ensure_litellm_agent_keys() {
  local existing='{}' request keys
  if kubectl -n "$NS" get secret litellm-agent-keys >/dev/null 2>&1; then
    existing="$(kubectl -n "$NS" get secret litellm-agent-keys -o json | jq -c '.data | map_values(@base64d)')"
  fi
  request="$(printf '%s\n' "${AGENT_BUDGETS_USD[@]}" | jq -Rnc --argjson existing "$existing" '
    {existing: $existing,
     agents: [inputs | split("=") | {name: .[0], budget: (.[1] | tonumber),
              env: ("LITELLM_KEY_" + (.[0] | ascii_upcase | gsub("-"; "_")))}]}')"

  keys="$(kubectl -n "$NS" exec -i deploy/litellm -c litellm -- python -c '
import json, os, sys, urllib.request, urllib.error
req = json.load(sys.stdin)
headers = {"Authorization": "Bearer " + os.environ["LITELLM_MASTER_KEY"], "Content-Type": "application/json"}
def call(path, body=None):
    r = urllib.request.Request("http://localhost:4000" + path, headers=headers,
                               data=None if body is None else json.dumps(body).encode())
    with urllib.request.urlopen(r, timeout=60) as resp:
        return json.load(resp)
out, changed = {}, []
for agent in req["agents"]:
    key = req["existing"].get(agent["env"])
    if key:
        try:
            call("/key/info?key=" + key)
            out[agent["env"]] = key
            continue
        except urllib.error.HTTPError:
            pass
    alias = "agent-" + agent["name"]
    try:
        call("/key/delete", {"key_aliases": [alias]})
    except urllib.error.HTTPError:
        pass
    created = call("/key/generate", {"key_alias": alias, "models": ["fast", "smart"],
        "max_budget": agent["budget"], "budget_duration": "30d", "metadata": {"agent": agent["name"]}})
    out[agent["env"]] = created["key"]
    changed.append(agent["name"])
print(json.dumps({"keys": out, "changed": changed}))
' <<<"$request")"

  jq -r '.keys | to_entries[] | "\(.key)=\(.value)"' <<<"$keys" \
    | kubectl -n "$NS" create secret generic litellm-agent-keys --from-env-file=/dev/stdin --dry-run=client -o yaml \
    | kubectl apply -f - >/dev/null
  local changed
  changed="$(jq -r '.changed | join(", ")' <<<"$keys")"
  if [[ -n "$changed" ]]; then
    log "LiteLLM agent keys created: ${changed} (budgets: ${AGENT_BUDGETS_USD[*]} USD/30 days)"
    kubectl -n "$NS" rollout restart deployment/worker >/dev/null 2>&1 || true
  else
    log "LiteLLM agent keys in place"
  fi
}

# The worker starts once Secret litellm-agent-keys exists, so wait for it after the keys.
wait_for_worker() {
  log "waiting for the agent worker"
  kubectl -n "$NS" rollout status deployment/worker --timeout=5m \
    || warn "worker not ready yet: kubectl -n $NS logs deploy/worker"
}

# Wait for Postgres, Temporal and LiteLLM, reporting rather than failing on slow starts.
wait_for_services() {
  log "waiting for Postgres (first start takes a few minutes)"
  kubectl -n "$NS" wait cluster.postgresql.cnpg.io/agents-pg --for=condition=Ready --timeout=10m \
    || warn "Postgres not ready yet: kubectl -n $NS get cluster agents-pg"
  log "waiting for Temporal"
  kubectl -n "$NS" rollout status statefulset/temporal --timeout=5m \
    || warn "Temporal not ready yet: kubectl -n $NS describe pod -l app.kubernetes.io/name=temporal"
  log "waiting for LiteLLM (runs database migrations on first start)"
  kubectl -n "$NS" rollout status deployment/litellm --timeout=8m \
    || warn "LiteLLM not ready yet: kubectl -n $NS logs deploy/litellm"
}

# Postgres logins for the synthetic ERP's MCP servers (platform/mcp): erp_reader for erp-read,
# erp_writer for erp-write, erp_demo for the portal's demo controls. The data is synthetic, so on k3d and GKE alike the passwords are
# random, generated once and kept in the cluster. Values never printed.
ensure_erp_secrets() {
  local pair name user
  for pair in pg-erp-reader:erp_reader pg-erp-writer:erp_writer pg-erp-demo:erp_demo; do
    name="${pair%%:*}"
    user="${pair##*:}"
    kubectl -n "$NS" get secret "$name" >/dev/null 2>&1 && continue
    apply_secret "$name" kubernetes.io/basic-auth "username=${user}" "password=$(random_password 32)"
    log "created Secret ${name}"
  done
}

# Load the synthetic ERP (schema, grants and data) into database "erp". The seed SQL is generated
# into the docs MCP server image alongside the documents, so rows and documents always agree.
#   load_erp          load if the ERP has no tables yet
#   load_erp force    drop and reload (resets every resolution and outbox message)
load_erp() {
  local primary loaded
  kubectl -n "$NS" wait database.postgresql.cnpg.io/erp --for=jsonpath='{.status.applied}'=true --timeout=5m >/dev/null \
    || die "database erp not created: kubectl -n $NS describe database erp"
  kubectl -n "$NS" rollout status deployment/mcp-docs --timeout=3m >/dev/null \
    || die "mcp-docs not ready: kubectl -n $NS logs deploy/mcp-docs"
  primary="$(kubectl -n "$NS" get cluster.postgresql.cnpg.io/agents-pg -o jsonpath='{.status.currentPrimary}')"
  loaded="$(kubectl -n "$NS" exec "$primary" -c postgres -- psql -tAq erp -c "select to_regclass('erp.invoices') is not null")"
  if [[ "$loaded" == "t" && "${1:-}" != "force" ]]; then
    log "synthetic ERP already loaded (scripts/local/erp-load.sh reloads it)"
    return 0
  fi
  log "loading the synthetic ERP into database erp"
  # MSYS_NO_PATHCONV: stops Git Bash on Windows from rewriting the in-container path.
  MSYS_NO_PATHCONV=1 kubectl -n "$NS" exec deploy/mcp-docs -c docs -- cat /seed/seed.sql \
    | kubectl -n "$NS" exec -i "$primary" -c postgres -- psql -q -v ON_ERROR_STOP=1 -d erp >/dev/null
  log "synthetic ERP: $(kubectl -n "$NS" exec "$primary" -c postgres -- psql -tAq erp -c \
    "select count(*) || ' invoices, ' || (select count(*) from erp.exceptions where status = 'open') || ' open exceptions' from erp.invoices")"
}

# Wait for the MCP servers.
wait_for_mcp() {
  local d
  for d in mcp-erp-read mcp-erp-write mcp-docs mcp-match-engine; do
    kubectl -n "$NS" rollout status "deployment/$d" --timeout=3m >/dev/null \
      || warn "$d not ready yet: kubectl -n $NS logs deploy/$d"
  done
  log "MCP servers ready: mcp-erp-read, mcp-erp-write, mcp-docs, mcp-match-engine (check: scripts/local/mcp-verify.sh)"
}

# The portal API's LiteLLM key (Secret litellm-portal-key, PORTAL_LITELLM_KEY): a user with the
# proxy_admin_viewer role, so it can read every key's spend and budget, with a $0 budget so it can
# never spend. Kept while LiteLLM still knows it. Value never printed.
ensure_litellm_portal_key() {
  local existing=""
  if kubectl -n "$NS" get secret litellm-portal-key >/dev/null 2>&1; then
    existing="$(kubectl -n "$NS" get secret litellm-portal-key -o go-template='{{index .data "PORTAL_LITELLM_KEY" | base64decode}}')"
  fi
  kubectl -n "$NS" exec -i deploy/litellm -c litellm -- env "USER_EXISTS=$(litellm_user_exists portal-api)" python -c '
import json, os, sys, urllib.request, urllib.error
existing = sys.stdin.read().strip()
h = {"Authorization": "Bearer " + os.environ["LITELLM_MASTER_KEY"], "Content-Type": "application/json"}
def call(path, body=None):
    r = urllib.request.Request("http://localhost:4000" + path, headers=h, data=None if body is None else json.dumps(body).encode())
    with urllib.request.urlopen(r, timeout=60) as resp:
        return json.load(resp)
if existing:
    try:
        call("/key/info?key=" + existing)
        print(existing)
        sys.exit(0)
    except urllib.error.HTTPError:
        pass
if os.environ["USER_EXISTS"] != "t":
    call("/user/new", {"user_id": "portal-api", "user_role": "proxy_admin_viewer", "auto_create_key": False})
try:
    call("/key/delete", {"key_aliases": ["portal-api"]})
except urllib.error.HTTPError:
    pass
print(call("/key/generate", {"user_id": "portal-api", "key_alias": "portal-api", "max_budget": 0, "metadata": {"purpose": "portal read-only"}})["key"])
' <<<"$existing" \
    | sed 's/^/PORTAL_LITELLM_KEY=/' \
    | kubectl -n "$NS" create secret generic litellm-portal-key --from-env-file=/dev/stdin --dry-run=client -o yaml \
    | kubectl apply -f - >/dev/null
  # The API reads the key from its environment at start, so restart it when the key is new.
  local current
  current="$(kubectl -n "$NS" get secret litellm-portal-key -o go-template='{{index .data "PORTAL_LITELLM_KEY" | base64decode}}')"
  if [[ "$current" != "$existing" ]] && kubectl -n "$NS" get deployment api >/dev/null 2>&1; then
    kubectl -n "$NS" rollout restart deployment/api >/dev/null
    log "LiteLLM portal key in place (viewer role, no spend); restarted the portal API to pick it up"
  else
    log "LiteLLM portal key in place (viewer role, no spend)"
  fi
}
