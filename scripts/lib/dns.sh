#!/usr/bin/env bash
# Cloudflare DNS for the app hostname. Source after common.sh.
#
# The gateway IP is reserved by up.sh and released by down.sh. A DNS record left pointing at a
# released IP can be claimed by whoever is given that IP next, so the record lives exactly as
# long as the IP does: up.sh creates it, down.sh deletes it before the IP is released.
#
# Needs in .env:
#   CLOUDFLARE_API_TOKEN  token with Zone > DNS > Edit on the zone only
#   CLOUDFLARE_ZONE_ID    the zone's ID (Cloudflare dashboard, zone Overview page)
# The token is sent only to api.cloudflare.com and is never printed.

CF_API="https://api.cloudflare.com/client/v4"

# True when the app hostname is one we manage (a custom hostname, with Cloudflare settings).
dns_managed() {
  [[ -n "${APP_HOSTNAME:-}" && -n "${CLOUDFLARE_API_TOKEN:-}" && -n "${CLOUDFLARE_ZONE_ID:-}" ]]
}

# Fail when a custom hostname is set but its DNS can't be managed. Call before creating anything.
dns_require_settings() {
  [[ -z "${APP_HOSTNAME:-}" ]] && return 0 # <ip>.sslip.io needs no record
  dns_managed || die "APP_HOSTNAME is set, so set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID in .env (scripts/lib/dns.sh). Without them the DNS record would outlive the gateway IP."
}

# cf_api <method> <path> [json-body]: prints the response; fails unless Cloudflare reports success.
cf_api() {
  local method="$1" path="$2" body="${3:-}" out
  local args=(-sS --max-time 30 -X "$method" -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H "Content-Type: application/json")
  [[ -n "$body" ]] && args+=(--data "$body")
  out="$(curl "${args[@]}" "${CF_API}${path}")" || return 1
  [[ "$(jq -r '.success' <<<"$out" 2>/dev/null)" == "true" ]] || {
    warn "Cloudflare API ${method} failed: $(jq -c '.errors' <<<"$out" 2>/dev/null || echo 'unreadable response')"
    return 1
  }
  echo "$out"
}

# IDs of every A/AAAA/CNAME record for the hostname, one per line.
dns_record_ids() {
  local host="$1" type
  for type in A AAAA CNAME; do
    cf_api GET "/zones/${CLOUDFLARE_ZONE_ID}/dns_records?type=${type}&name=${host}" | jq -r '.result[].id'
  done
}

# dns_upsert <hostname> <ipv4>: one DNS-only A record (the Google-managed certificate and IAP need
# clients to reach the load balancer directly), TTL 60s so a new session's IP is picked up quickly.
dns_upsert() {
  local host="$1" ip="$2" ids id body first=""
  body="$(jq -cn --arg n "$host" --arg ip "$ip" '{type: "A", name: $n, content: $ip, ttl: 60, proxied: false, comment: "durable-agents gateway; managed by scripts/gke/up.sh and down.sh"}')"
  ids="$(dns_record_ids "$host")" || die "could not read DNS records for ${host}"
  for id in $ids; do
    if [[ -z "$first" ]]; then
      cf_api PUT "/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${id}" "$body" >/dev/null || die "could not update the DNS record for ${host}"
      first="$id"
    else
      cf_api DELETE "/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${id}" >/dev/null || die "could not remove a duplicate DNS record for ${host}"
    fi
  done
  if [[ -z "$first" ]]; then
    cf_api POST "/zones/${CLOUDFLARE_ZONE_ID}/dns_records" "$body" >/dev/null || die "could not create the DNS record for ${host}"
  fi
  log "DNS: ${host} -> ${ip} (Cloudflare, DNS only, TTL 60s)"
}

# dns_delete <hostname>: remove every address record for the hostname. Fails if any remains.
dns_delete() {
  local host="$1" ids id
  ids="$(dns_record_ids "$host")" || return 1
  for id in $ids; do
    cf_api DELETE "/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${id}" >/dev/null || return 1
  done
  log "DNS: removed ${host} from Cloudflare"
}
