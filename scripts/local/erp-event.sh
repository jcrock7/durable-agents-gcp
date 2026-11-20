#!/usr/bin/env bash
# Simulate the outside world for the Invoice Exception Resolver demo, then tell the waiting case
# to re-check at once (signal "recheck") instead of at its next daily check.
#
#   scripts/local/erp-event.sh receipt INV-20123            receiving posts a full goods receipt for the invoice's PO
#   scripts/local/erp-event.sh reply INV-20123 "message"    the vendor replies (written to the AP mailbox)
#
# Writes to the synthetic ERP as the database superuser (the agent's own roles cannot do this).
source "$(dirname "${BASH_SOURCE[0]}")/../lib/common.sh"
source "$(dirname "${BASH_SOURCE[0]}")/../lib/k8s.sh"

refuse_root
require_cmd kubectl

kind="${1:-}"
invoice="${2:-}"
[[ "$kind" =~ ^(receipt|reply)$ && "$invoice" =~ ^INV-[0-9]+$ ]] || die "usage: $0 receipt|reply INV-<n> [message]"
text="${3:-Thank you. We have checked this invoice and confirm the details.}"

primary="$(kubectl -n "$NS" get cluster.postgresql.cnpg.io/agents-pg -o jsonpath='{.status.currentPrimary}')"
psql() { kubectl -n "$NS" exec -i "$primary" -c postgres -- psql -tAq -v ON_ERROR_STOP=1 -d erp "$@"; }

if [[ "$kind" == "receipt" ]]; then
  result="$(psql -v invoice="$invoice" <<'SQL'
WITH inv AS (SELECT po_id FROM erp.invoices WHERE id = :'invoice'),
     g AS (INSERT INTO erp.receipts (id, po_id, received_on)
           SELECT 'GR-' || (9000 + (SELECT count(*) FROM erp.receipts)), po_id, current_date FROM inv
           RETURNING id, po_id),
     l AS (INSERT INTO erp.receipt_lines (receipt_id, po_line_no, quantity)
           SELECT g.id, p.line_no, p.quantity FROM g JOIN erp.po_lines p ON p.po_id = g.po_id
           RETURNING 1)
SELECT g.id || ' for ' || g.po_id || ' (' || (SELECT count(*) FROM l) || ' lines)' FROM g;
SQL
)"
  [[ -n "$result" ]] || die "no invoice ${invoice}"
  reason="receipt ${result} posted"
else
  result="$(psql -v invoice="$invoice" -v body="$text" <<'SQL'
INSERT INTO erp.messages (id, vendor_id, direction, sent_at, from_address, to_address, subject, body, invoice_id, po_id, document_path)
SELECT 'MSG-' || (9500 + (SELECT count(*) FROM erp.messages)), i.vendor_id, 'in', now(), v.email, 'ap@company.example',
       'Re: invoice ' || i.vendor_invoice_number, :'body', i.id, i.po_id, ''
  FROM erp.invoices i JOIN erp.vendors v ON v.id = i.vendor_id
 WHERE i.id = :'invoice'
RETURNING id;
SQL
)"
  [[ -n "$result" ]] || die "no invoice ${invoice}"
  reason="vendor replied (${result})"
fi
log "$reason"

workflow="$(tr '[:upper:]' '[:lower:]' <<<"$invoice")"
MSYS_NO_PATHCONV=1 kubectl -n "$NS" exec temporal-0 -- temporal workflow signal --workflow-id "$workflow" --name recheck \
  --input "{\"reason\":\"${reason}\"}" >/dev/null 2>&1 \
  && log "signalled ${workflow} to re-check" \
  || warn "no running case ${workflow} to signal; it will see the change at its next daily check"
