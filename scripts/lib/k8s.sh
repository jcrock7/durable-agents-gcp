#!/usr/bin/env bash
# Kubernetes helpers shared by scripts/local/apply-k8s.sh and scripts/gke/apply-k8s.sh.
# Source after common.sh.

NS="${NS:-agents}"

# Each agent's LiteLLM budget in USD per 30 days. Adding an agent: add it here.
AGENT_BUDGETS_USD=(
  "research-summarize=2"
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
ensure_litellm_ui_admin() {
  local primary has_password invitation
  primary="$(kubectl -n "$NS" get cluster.postgresql.cnpg.io/agents-pg -o jsonpath='{.status.currentPrimary}')"
  has_password="$(kubectl -n "$NS" exec "$primary" -c postgres -- psql -tAq litellm -c \
    "select password is not null from \"LiteLLM_UserTable\" where user_id = 'ui-admin'")"
  if [[ "$has_password" == "t" ]]; then
    log "LiteLLM UI: sign in as 'admin' with the password you chose"
    return 0
  fi
  invitation="$(kubectl -n "$NS" exec deploy/litellm -c litellm -- python -c '
import json, os, urllib.request, urllib.error
headers = {"Authorization": "Bearer " + os.environ["LITELLM_MASTER_KEY"], "Content-Type": "application/json"}
def call(path, body=None):
    req = urllib.request.Request("http://localhost:4000" + path, headers=headers,
                                 data=None if body is None else json.dumps(body).encode())
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)
try:
    call("/user/info?user_id=ui-admin")
except urllib.error.HTTPError as e:
    if e.code != 404:
        raise
    call("/user/new", {"user_id": "ui-admin", "user_email": "admin",
                       "user_role": "proxy_admin", "auto_create_key": False})
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
