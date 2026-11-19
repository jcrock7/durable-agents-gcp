// Inputs and outputs of the match engine. Money is integer cents; dates are ISO strings.

export interface Tolerance {
  /** Price variance within this percentage of the PO line amount passes… */
  pricePct: number;
  /** …and within this many cents; the lower of the two applies. */
  priceCents: number;
  /** Units of quantity variance allowed (0: exact). */
  quantity: number;
}

export interface InvoiceLineIn {
  lineNo: number;
  poLineNo: number | null;
  itemId: string | null;
  description: string;
  quantity: number;
  uom: string;
  unitPriceCents: number;
}

export interface PoLineIn {
  lineNo: number;
  itemId: string;
  quantity: number;
  unitPriceCents: number;
}

export interface PoIn {
  id: string;
  vendorId: string;
  status: string;
  issuedOn: string;
  lines: PoLineIn[];
}

export interface ContractPriceIn {
  id: string;
  priceCents: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface InvoiceSummaryIn {
  id: string;
  vendorInvoiceNumber: string;
  poId: string;
  invoiceDate: string;
  totalCents: number;
  status: string;
}

/** Everything the engine needs about one invoice. Loaded from erp-read, or built directly in tests. */
export interface MatchInput {
  invoice: InvoiceSummaryIn & { vendorId: string; remitBankLast4: string };
  lines: InvoiceLineIn[];
  /** The PO the invoice references; null if it does not exist. */
  po: PoIn | null;
  /** Received quantity per line of the referenced PO, summed over all receipts. */
  receivedByPoLine: Record<number, number>;
  /** True if any receipt exists for the referenced PO. */
  hasReceipts: boolean;
  vendor: { id: string; bankLast4: string; freightTerms: string; freightCapCents: number };
  /** Item master entries for the invoice's items, by item id. */
  items: Record<string, { uom: string; caseQty: number }>;
  /** Contract price history per item id, oldest first. Missing or empty: none on file. */
  contractPrices: Record<string, ContractPriceIn[]>;
  /** The vendor's other invoices (for duplicate checks). */
  history: InvoiceSummaryIn[];
  /** The vendor's open POs other than the referenced one (for a wrong PO reference). */
  otherOpenPos: PoIn[];
}

export type FindingCode =
  | "PRICE_VARIANCE"
  | "UOM_CONVERTIBLE"
  | "QUANTITY_OVER_RECEIVED"
  | "NO_RECEIPT"
  | "CHARGE_ALLOWED"
  | "CHARGE_NOT_ALLOWED"
  | "PO_MISMATCH"
  | "DUPLICATE_SUSPECT"
  | "BANK_DETAILS_CHANGED";

export interface Finding {
  code: FindingCode;
  /** "exception" stops the match; "fraud_signal" must go to a person; "info" explains a pass. */
  severity: "info" | "exception" | "fraud_signal";
  lineNo?: number;
  message: string;
  /** Money involved, where there is any. */
  amountCents?: number;
  details?: Record<string, unknown>;
}

export interface MatchResult {
  invoiceId: string;
  status: "matched" | "exception";
  findings: Finding[];
  /** Exception types the findings point to, for the model to confirm or refine. */
  exceptionTypes: string[];
  totals: { invoiceCents: number; poMatchedCents: number };
}

export interface DuplicateCandidate {
  invoiceId: string;
  vendorInvoiceNumber: string;
  status: string;
  reasons: string[];
}

export interface DuplicateResult {
  invoiceId: string;
  duplicate: boolean;
  candidates: DuplicateCandidate[];
}

export const ACTIONS = [
  "accept_variance",
  "request_credit_memo",
  "short_pay",
  "wait_for_receipt",
  "request_receipt_entry",
  "accept_uom_conversion",
  "accept_charge",
  "reject_duplicate",
  "reassign_po",
  "escalate",
] as const;
export type Action = (typeof ACTIONS)[number];

export interface Adjustment {
  invoiceId: string;
  action: Action;
  /** The money the action is about: the variance accepted, the credit asked for, the amount withheld… 0 if none. */
  amountCents: number;
  /** What would be paid after the action, or null if the action does not settle payment yet. */
  payableCents: number | null;
  /** How the amount was computed, line by line. */
  basis: string[];
}
