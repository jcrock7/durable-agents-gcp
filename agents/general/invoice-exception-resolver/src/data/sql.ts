import { isDemoPoolId } from "./generate.js";
import type { ErpData } from "./model.js";

/**
 * The ERP schema, in its own schema `erp` of database `erp`. Run as a superuser (the load script
 * uses `kubectl exec` into the Postgres primary); tables are owned by `erp_owner`.
 *
 * Roles (CloudNativePG managed roles in platform/services/postgres/cluster.yaml):
 *   erp_owner   no login; owns the tables
 *   erp_reader  SELECT on everything                      → MCP server erp-read
 *   erp_writer  INSERT on resolutions and outbox, UPDATE of invoices.status and exceptions.status
 *               only                                       → MCP server erp-write
 *   erp_demo    SELECT on everything, UPDATE of invoices.status and exceptions.status, INSERT on
 *               exceptions                                 → portal API demo controls (raises the exception
 *                                                            on the next demo-pool invoice)
 */
export const SCHEMA_SQL = `
SET ROLE erp_owner;
DROP SCHEMA IF EXISTS erp CASCADE;
CREATE SCHEMA erp;

CREATE TABLE erp.vendors (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  bank_last4 text NOT NULL,
  payment_terms_days int NOT NULL,
  freight_terms text NOT NULL CHECK (freight_terms IN ('prepaid', 'add')),
  freight_cap_cents int NOT NULL
);

CREATE TABLE erp.items (
  id text PRIMARY KEY,
  vendor_id text NOT NULL REFERENCES erp.vendors,
  description text NOT NULL,
  uom text NOT NULL,
  case_qty int NOT NULL
);

CREATE TABLE erp.contract_prices (
  id text PRIMARY KEY,
  vendor_id text NOT NULL REFERENCES erp.vendors,
  item_id text NOT NULL REFERENCES erp.items,
  price_cents int NOT NULL,
  effective_from date NOT NULL,
  effective_to date
);
CREATE INDEX ON erp.contract_prices (vendor_id, item_id);

CREATE TABLE erp.purchase_orders (
  id text PRIMARY KEY,
  vendor_id text NOT NULL REFERENCES erp.vendors,
  buyer_email text NOT NULL,
  issued_on date NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'closed'))
);
CREATE INDEX ON erp.purchase_orders (vendor_id);

CREATE TABLE erp.po_lines (
  po_id text NOT NULL REFERENCES erp.purchase_orders,
  line_no int NOT NULL,
  item_id text NOT NULL REFERENCES erp.items,
  quantity int NOT NULL,
  unit_price_cents int NOT NULL,
  PRIMARY KEY (po_id, line_no)
);

CREATE TABLE erp.receipts (
  id text PRIMARY KEY,
  po_id text NOT NULL REFERENCES erp.purchase_orders,
  received_on date NOT NULL
);
CREATE INDEX ON erp.receipts (po_id);

CREATE TABLE erp.receipt_lines (
  receipt_id text NOT NULL REFERENCES erp.receipts,
  po_line_no int NOT NULL,
  quantity int NOT NULL,
  PRIMARY KEY (receipt_id, po_line_no)
);

CREATE TABLE erp.invoices (
  id text PRIMARY KEY,
  vendor_id text NOT NULL REFERENCES erp.vendors,
  vendor_invoice_number text NOT NULL,
  po_id text NOT NULL REFERENCES erp.purchase_orders,
  invoice_date date NOT NULL,
  due_date date NOT NULL,
  total_cents bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('received', 'matched', 'exception', 'on_hold', 'resolved', 'paid')),
  remit_bank_last4 text NOT NULL,
  document_path text NOT NULL
);
CREATE INDEX ON erp.invoices (vendor_id, invoice_date);

CREATE TABLE erp.invoice_lines (
  invoice_id text NOT NULL REFERENCES erp.invoices,
  line_no int NOT NULL,
  po_line_no int,
  item_id text REFERENCES erp.items,
  description text NOT NULL,
  quantity int NOT NULL,
  uom text NOT NULL,
  unit_price_cents int NOT NULL,
  PRIMARY KEY (invoice_id, line_no)
);

CREATE TABLE erp.messages (
  id text PRIMARY KEY,
  vendor_id text NOT NULL REFERENCES erp.vendors,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  sent_at timestamptz NOT NULL,
  from_address text NOT NULL,
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  invoice_id text,
  po_id text,
  document_path text NOT NULL
);
CREATE INDEX ON erp.messages (vendor_id, sent_at);

CREATE TABLE erp.exceptions (
  id text PRIMARY KEY,
  invoice_id text NOT NULL REFERENCES erp.invoices,
  raised_on date NOT NULL,
  reason_codes text[] NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'resolved'))
);

CREATE TABLE erp.resolutions (
  id bigserial PRIMARY KEY,
  invoice_id text NOT NULL REFERENCES erp.invoices,
  exception_id text REFERENCES erp.exceptions,
  action text NOT NULL,
  amount_cents bigint NOT NULL,
  note text NOT NULL,
  approved_by text,
  run_id text NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE erp.outbox (
  id bigserial PRIMARY KEY,
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  invoice_id text REFERENCES erp.invoices,
  run_id text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  queued_at timestamptz NOT NULL DEFAULT now()
);

GRANT USAGE ON SCHEMA erp TO erp_reader, erp_writer;
GRANT SELECT ON ALL TABLES IN SCHEMA erp TO erp_reader;

GRANT SELECT (id, status) ON erp.invoices TO erp_writer;
GRANT UPDATE (status) ON erp.invoices TO erp_writer;
GRANT SELECT (id, invoice_id, status) ON erp.exceptions TO erp_writer;
GRANT UPDATE (status) ON erp.exceptions TO erp_writer;
GRANT INSERT ON erp.resolutions, erp.outbox TO erp_writer;
GRANT SELECT (id) ON erp.resolutions, erp.outbox TO erp_writer;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA erp TO erp_writer;

-- Also applied on every deploy by scripts/lib/k8s.sh (grant_erp_demo), for ERPs loaded before this role existed.
GRANT USAGE ON SCHEMA erp TO erp_demo;
GRANT SELECT ON ALL TABLES IN SCHEMA erp TO erp_demo;
GRANT UPDATE (status) ON erp.invoices, erp.exceptions TO erp_demo;
GRANT INSERT ON erp.exceptions TO erp_demo;
`;

type Value = string | number | null | string[];

function literal(v: Value): string {
  if (v === null) return "NULL";
  if (typeof v === "number") {
    if (!Number.isInteger(v)) throw new Error(`non-integer value in ERP data: ${v}`);
    return String(v);
  }
  if (Array.isArray(v)) return `ARRAY[${v.map(literal).join(", ")}]::text[]`;
  return `'${v.replace(/'/g, "''")}'`;
}

function insert(table: string, columns: string[], rows: Value[][], tail = ""): string {
  if (rows.length === 0) return "";
  const chunks: string[] = [];
  for (let i = 0; i < rows.length; i += 200) {
    const values = rows.slice(i, i + 200).map((row) => `  (${row.map(literal).join(", ")})`).join(",\n");
    chunks.push(`INSERT INTO erp.${table} (${columns.join(", ")}) VALUES\n${values}${tail};`);
  }
  return chunks.join("\n");
}

/** The demo pool's rows only (generate.ts DEMO_POOL_SIZE), added to an ERP loaded before the pool existed. Idempotent. */
export function demoPoolSql(data: ErpData): string {
  const pool = new Set(data.invoices.filter((i) => isDemoPoolId(i.id)).map((i) => i.id));
  const pos = new Set(data.invoices.filter((i) => pool.has(i.id)).map((i) => i.poId));
  const skip = " ON CONFLICT DO NOTHING";
  return [
    "-- The demo-pool invoices (generate.ts DEMO_POOL_SIZE). Generated: do not edit. Safe to re-run.",
    "\\set ON_ERROR_STOP on",
    "BEGIN;",
    "SET ROLE erp_owner;",
    insert("purchase_orders", ["id", "vendor_id", "buyer_email", "issued_on", "status"], data.purchaseOrders.filter((p) => pos.has(p.id)).map((p) => [p.id, p.vendorId, p.buyerEmail, p.issuedOn, p.status]), skip),
    insert("po_lines", ["po_id", "line_no", "item_id", "quantity", "unit_price_cents"], data.poLines.filter((l) => pos.has(l.poId)).map((l) => [l.poId, l.lineNo, l.itemId, l.quantity, l.unitPriceCents]), skip),
    insert("receipts", ["id", "po_id", "received_on"], data.receipts.filter((g) => pos.has(g.poId)).map((g) => [g.id, g.poId, g.receivedOn]), skip),
    insert("receipt_lines", ["receipt_id", "po_line_no", "quantity"], data.receiptLines.filter((g) => data.receipts.some((r) => r.id === g.receiptId && pos.has(r.poId))).map((g) => [g.receiptId, g.poLineNo, g.quantity]), skip),
    insert("invoices", ["id", "vendor_id", "vendor_invoice_number", "po_id", "invoice_date", "due_date", "total_cents", "status", "remit_bank_last4", "document_path"], data.invoices.filter((i) => pool.has(i.id)).map((i) => [i.id, i.vendorId, i.vendorInvoiceNumber, i.poId, i.invoiceDate, i.dueDate, i.totalCents, i.status, i.remitBankLast4, i.documentPath]), skip),
    insert("invoice_lines", ["invoice_id", "line_no", "po_line_no", "item_id", "description", "quantity", "uom", "unit_price_cents"], data.invoiceLines.filter((l) => pool.has(l.invoiceId)).map((l) => [l.invoiceId, l.lineNo, l.poLineNo, l.itemId, l.description, l.quantity, l.uom, l.unitPriceCents]), skip),
    "RESET ROLE;",
    "COMMIT;",
    "",
  ].join("\n");
}

/** The whole ERP as one SQL script: schema, grants and data, in a single transaction. */
export function seedSql(data: ErpData): string {
  return [
    "-- Synthetic ERP for the Invoice Exception Resolver. Generated: do not edit.",
    "\\set ON_ERROR_STOP on",
    "BEGIN;",
    SCHEMA_SQL,
    insert("vendors", ["id", "name", "email", "bank_last4", "payment_terms_days", "freight_terms", "freight_cap_cents"], data.vendors.map((v) => [v.id, v.name, v.email, v.bankLast4, v.paymentTermsDays, v.freightTerms, v.freightCapCents])),
    insert("items", ["id", "vendor_id", "description", "uom", "case_qty"], data.items.map((i) => [i.id, i.vendorId, i.description, i.uom, i.caseQty])),
    insert("contract_prices", ["id", "vendor_id", "item_id", "price_cents", "effective_from", "effective_to"], data.contractPrices.map((c) => [c.id, c.vendorId, c.itemId, c.priceCents, c.effectiveFrom, c.effectiveTo])),
    insert("purchase_orders", ["id", "vendor_id", "buyer_email", "issued_on", "status"], data.purchaseOrders.map((p) => [p.id, p.vendorId, p.buyerEmail, p.issuedOn, p.status])),
    insert("po_lines", ["po_id", "line_no", "item_id", "quantity", "unit_price_cents"], data.poLines.map((l) => [l.poId, l.lineNo, l.itemId, l.quantity, l.unitPriceCents])),
    insert("receipts", ["id", "po_id", "received_on"], data.receipts.map((g) => [g.id, g.poId, g.receivedOn])),
    insert("receipt_lines", ["receipt_id", "po_line_no", "quantity"], data.receiptLines.map((g) => [g.receiptId, g.poLineNo, g.quantity])),
    insert("invoices", ["id", "vendor_id", "vendor_invoice_number", "po_id", "invoice_date", "due_date", "total_cents", "status", "remit_bank_last4", "document_path"], data.invoices.map((i) => [i.id, i.vendorId, i.vendorInvoiceNumber, i.poId, i.invoiceDate, i.dueDate, i.totalCents, i.status, i.remitBankLast4, i.documentPath])),
    insert("invoice_lines", ["invoice_id", "line_no", "po_line_no", "item_id", "description", "quantity", "uom", "unit_price_cents"], data.invoiceLines.map((l) => [l.invoiceId, l.lineNo, l.poLineNo, l.itemId, l.description, l.quantity, l.uom, l.unitPriceCents])),
    insert("messages", ["id", "vendor_id", "direction", "sent_at", "from_address", "to_address", "subject", "body", "invoice_id", "po_id", "document_path"], data.messages.map((m) => [m.id, m.vendorId, m.direction, m.sentAt, m.fromAddress, m.toAddress, m.subject, m.body, m.invoiceId, m.poId, m.documentPath])),
    insert("exceptions", ["id", "invoice_id", "raised_on", "reason_codes", "status"], data.exceptions.map((e) => [e.id, e.invoiceId, e.raisedOn, e.reasonCodes, e.status])),
    "RESET ROLE;",
    "COMMIT;",
    "",
  ].join("\n");
}
