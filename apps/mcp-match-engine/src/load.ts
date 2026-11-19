// Load a MatchInput for one invoice from the ERP, through the erp-read MCP server. The engine
// holds no database credentials: it reads through the same least-privilege server the agent uses.
import { McpToolbox, type McpCallResult } from "@agents/agent-kit";
import type { InvoiceSummaryIn, MatchInput, PoIn } from "./types.js";

export const ERP_READ_TOOLS = [
  "erp-read:get_invoice",
  "erp-read:get_purchase_order",
  "erp-read:get_receipts",
  "erp-read:get_vendor",
  "erp-read:get_item",
  "erp-read:get_contract_prices",
  "erp-read:get_invoice_history",
  "erp-read:list_vendor_purchase_orders",
];

export class NotFoundError extends Error {
  override name = "NotFoundError";
}

type Row = Record<string, unknown>;

/** MCP Toolbox returns one JSON text block per row; no rows comes back as an empty result or "null". */
export function rowsOf(result: McpCallResult): Row[] {
  if (result.isError) {
    throw new Error(result.content.map((c) => c.text ?? "").join(" ") || "erp-read reported an error");
  }
  const rows: Row[] = [];
  for (const part of result.content) {
    if (part.type !== "text" || !part.text?.trim()) continue;
    const value = JSON.parse(part.text) as unknown;
    if (Array.isArray(value)) rows.push(...(value as Row[]));
    else if (value && typeof value === "object") rows.push(value as Row);
  }
  return rows;
}

const date = (v: unknown) => String(v ?? "").slice(0, 10);
const num = (v: unknown) => Number(v);

function toPo(row: Row): PoIn {
  const lines = (row.lines as Row[] | null) ?? [];
  return {
    id: String(row.id),
    vendorId: String(row.vendor_id),
    status: String(row.status),
    issuedOn: date(row.issued_on),
    lines: lines.map((l) => ({ lineNo: num(l.line_no), itemId: String(l.item_id), quantity: num(l.quantity), unitPriceCents: num(l.unit_price_cents) })),
  };
}

function toSummary(row: Row): InvoiceSummaryIn {
  return {
    id: String(row.id),
    vendorInvoiceNumber: String(row.vendor_invoice_number),
    poId: String(row.po_id),
    invoiceDate: date(row.invoice_date),
    totalCents: num(row.total_cents),
    status: String(row.status),
  };
}

export async function loadMatchInput(toolbox: McpToolbox, invoiceId: string, signal?: AbortSignal): Promise<MatchInput> {
  const call = async (tool: string, args: Record<string, unknown>) => rowsOf(await toolbox.call(`erp-read:${tool}`, args, "activity", signal));

  const [inv] = await call("get_invoice", { invoice_id: invoiceId });
  if (!inv) throw new NotFoundError(`invoice ${invoiceId} not found`);
  const vendorId = String(inv.vendor_id);
  const poId = String(inv.po_id);
  const lines = ((inv.lines as Row[] | null) ?? []).map((l) => ({
    lineNo: num(l.line_no),
    poLineNo: l.po_line_no === null ? null : num(l.po_line_no),
    itemId: l.item_id === null ? null : String(l.item_id),
    description: String(l.description),
    quantity: num(l.quantity),
    uom: String(l.uom),
    unitPriceCents: num(l.unit_price_cents),
  }));
  const itemIds = [...new Set(lines.map((l) => l.itemId).filter((x): x is string => x !== null))];

  const [poRows, receiptRows, vendorRows, historyRows, openPoRows, itemRows, priceRows] = await Promise.all([
    call("get_purchase_order", { po_id: poId }),
    call("get_receipts", { po_id: poId }),
    call("get_vendor", { vendor_id: vendorId }),
    call("get_invoice_history", { vendor_id: vendorId, limit: 200 }),
    call("list_vendor_purchase_orders", { vendor_id: vendorId }),
    Promise.all(itemIds.map((id) => call("get_item", { item_id: id }))),
    Promise.all(itemIds.map((id) => call("get_contract_prices", { vendor_id: vendorId, item_id: id }))),
  ]);

  const vendor = vendorRows[0];
  if (!vendor) throw new NotFoundError(`vendor ${vendorId} not found`);
  const receivedByPoLine: Record<number, number> = {};
  for (const r of receiptRows) {
    for (const l of (r.lines as Row[] | null) ?? []) receivedByPoLine[num(l.po_line_no)] = (receivedByPoLine[num(l.po_line_no)] ?? 0) + num(l.quantity);
  }

  return {
    invoice: { ...toSummary(inv), vendorId, remitBankLast4: String(inv.remit_bank_last4) },
    lines,
    po: poRows[0] ? toPo(poRows[0]) : null,
    receivedByPoLine,
    hasReceipts: receiptRows.length > 0,
    vendor: {
      id: vendorId,
      bankLast4: String(vendor.bank_last4),
      freightTerms: String(vendor.freight_terms),
      freightCapCents: num(vendor.freight_cap_cents),
    },
    items: Object.fromEntries(itemIds.map((id, i) => [id, { uom: String(itemRows[i]![0]?.uom ?? "EA"), caseQty: num(itemRows[i]![0]?.case_qty ?? 1) }])),
    contractPrices: Object.fromEntries(
      itemIds.map((id, i) => [
        id,
        priceRows[i]!.map((c) => ({ id: String(c.id), priceCents: num(c.price_cents), effectiveFrom: date(c.effective_from), effectiveTo: c.effective_to ? date(c.effective_to) : null })),
      ]),
    ),
    history: historyRows.filter((h) => h.id !== invoiceId).map(toSummary),
    otherOpenPos: openPoRows.filter((p) => p.id !== poId).map(toPo),
  };
}
