// The synthetic ERP's records. Money is integer cents; dates are ISO strings (YYYY-MM-DD).
// Everything here is generated: vendor names, people and addresses are not real.

export type Uom = "EA" | "CS";
export type FreightTerms = "prepaid" | "add";

export interface Vendor {
  id: string;
  name: string;
  email: string;
  /** Last four digits of the bank account on file for remittance. */
  bankLast4: string;
  paymentTermsDays: number;
  /** "prepaid": the vendor pays freight, so freight on an invoice is not allowed. "add": freight may be billed up to freightCapCents. */
  freightTerms: FreightTerms;
  freightCapCents: number;
}

export interface Item {
  id: string;
  vendorId: string;
  description: string;
  /** Unit the item is ordered and priced in. */
  uom: Uom;
  /** Units per case, for items a vendor may also bill by the case. */
  caseQty: number;
}

export interface ContractPrice {
  id: string;
  vendorId: string;
  itemId: string;
  priceCents: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface PurchaseOrder {
  id: string;
  vendorId: string;
  buyerEmail: string;
  issuedOn: string;
  status: "open" | "closed";
}

export interface PoLine {
  poId: string;
  lineNo: number;
  itemId: string;
  quantity: number;
  unitPriceCents: number;
}

export interface Receipt {
  id: string;
  poId: string;
  receivedOn: string;
}

export interface ReceiptLine {
  receiptId: string;
  poLineNo: number;
  quantity: number;
}

export type InvoiceStatus = "received" | "matched" | "exception" | "on_hold" | "resolved" | "paid";

export interface Invoice {
  id: string;
  vendorId: string;
  vendorInvoiceNumber: string;
  poId: string;
  invoiceDate: string;
  dueDate: string;
  totalCents: number;
  status: InvoiceStatus;
  /** Path of the vendor's invoice PDF in the document store. */
  documentPath: string;
  /** Bank account (last four digits) printed on the invoice for remittance. */
  remitBankLast4: string;
}

export interface InvoiceLine {
  invoiceId: string;
  lineNo: number;
  /** PO line this invoice line bills against; null for charges not on the PO (freight). */
  poLineNo: number | null;
  itemId: string | null;
  description: string;
  quantity: number;
  uom: Uom | "LOT";
  unitPriceCents: number;
}

export interface Message {
  id: string;
  vendorId: string;
  direction: "in" | "out";
  sentAt: string;
  fromAddress: string;
  toAddress: string;
  subject: string;
  body: string;
  invoiceId: string | null;
  poId: string | null;
  documentPath: string;
}

/** Why the ERP's own three-way match rejected an invoice. */
export type ReasonCode = "PRICE" | "QUANTITY" | "NO_RECEIPT" | "UNMATCHED_LINE" | "DUPLICATE_SUSPECT" | "PO_MISMATCH";

export interface MatchException {
  id: string;
  invoiceId: string;
  raisedOn: string;
  reasonCodes: ReasonCode[];
  status: "open" | "resolved";
}

/** Exception types the agent classifies into (business case). */
export type ExceptionType =
  | "price_variance"
  | "quantity_variance"
  | "uom_mismatch"
  | "unplanned_charge"
  | "no_receipt"
  | "duplicate"
  | "wrong_po";

/** Actions the agent may propose (ap-resolution-policy). */
export type ResolutionAction =
  | "accept_variance"
  | "request_credit_memo"
  | "short_pay"
  | "wait_for_receipt"
  | "request_receipt_entry"
  | "accept_uom_conversion"
  | "accept_charge"
  | "reject_duplicate"
  | "reassign_po"
  | "escalate";

export type Scenario =
  | "price_variance_contract"
  | "price_overcharge"
  | "quantity_short"
  | "receipt_in_transit"
  | "receipt_not_entered"
  | "uom_mismatch"
  | "charge_allowed"
  | "charge_not_allowed"
  | "duplicate_resent"
  | "wrong_po"
  | "missing_evidence"
  | "bank_change_request"
  | "hidden_instructions";

/**
 * The right answer for one seeded exception, for evals. Kept out of the ERP database: the agent
 * must never see it.
 */
export interface Label {
  exceptionId: string;
  invoiceId: string;
  scenario: Scenario;
  expectedType: ExceptionType;
  /** "blocked" when the guardrail should stop the run before the model acts. */
  expectedAction: ResolutionAction | "blocked";
  /** True if the route must go to a person (amount, action or flag). */
  needsPerson: boolean;
  /** True if the case must be flagged as possible fraud. */
  fraudFlag: boolean;
  /** Expected money change, where there is one (credit, short-pay or accepted variance), from the match engine's rules. */
  amountCents?: number;
  /** Evidence a good resolution cites: ERP row ids or document paths. */
  evidence: string[];
  note: string;
}

export interface ErpData {
  today: string;
  vendors: Vendor[];
  items: Item[];
  contractPrices: ContractPrice[];
  purchaseOrders: PurchaseOrder[];
  poLines: PoLine[];
  receipts: Receipt[];
  receiptLines: ReceiptLine[];
  invoices: Invoice[];
  invoiceLines: InvoiceLine[];
  messages: Message[];
  exceptions: MatchException[];
  labels: Label[];
  /** Invoice ids whose PDF carries hidden text addressed to the agent. */
  hiddenTextInvoices: string[];
}
