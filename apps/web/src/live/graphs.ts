// The workflow graph the Live Run view draws, per agent. Each node lists the activities and
// timeline entries (resolve.workflow.ts step names) that belong to it.

export interface GraphNode {
  id: string;
  label: string;
  /** Temporal activity types run in this node. */
  activities: string[];
  /** Timeline entry names (exact, or a prefix ending in "*"). */
  timeline: string[];
  /** Usage step names (CaseState.usage[].step) billed to this node. */
  usage?: string[];
  /** What the node is when idle, under its label ("rule", "policy", "human · ≤7d"). */
  hint?: string;
  gate?: true;
}

export interface LiveGraph {
  nodes: GraphNode[];
  /** A branch off the main line, drawn greyed when the run didn't take it. */
  branch?: { from: string; label: string; node: GraphNode };
}

export const LIVE_GRAPHS: Record<string, LiveGraph> = {
  "invoice-exception-resolver": {
    nodes: [
      { id: "match", label: "Match", activities: ["runMatch"], timeline: ["Match"], hint: "rule" },
      { id: "read", label: "Read invoice", activities: ["readInvoice"], timeline: ["Read invoice PDF"], usage: ["read invoice"] },
      { id: "evidence", label: "Gather evidence", activities: ["gatherEvidence"], timeline: ["Gather evidence"], usage: ["gather evidence"] },
      { id: "propose", label: "Propose", activities: ["proposeResolution", "computeAdjustment"], timeline: ["Propose resolution", "Revise proposal"], usage: ["propose", "revise proposal"] },
      { id: "route", label: "Route", activities: [], timeline: ["Route"], hint: "policy" },
      { id: "gate", label: "Review gate", activities: [], timeline: ["Waiting for approval", "Approved", "Sent back", "Escalated by reviewer"], hint: "human · ≤7d", gate: true },
      {
        id: "finish",
        label: "Draft → Post → Confirm",
        activities: ["draftMessage", "queueMessage", "postResolution", "confirmInvoice"],
        timeline: ["Message queued", "Post resolution", "Confirm"],
        usage: ["draft message"],
        hint: "erp-write",
      },
    ],
    branch: {
      from: "match",
      label: "if no goods receipt",
      node: { id: "hold", label: "Hold for GR", activities: [], timeline: ["Waiting for receipt", "Receipt found", "Reminder *"], hint: "daily re-match · remind · escalate @ 3d" },
    },
  },
};

export const allNodes = (g: LiveGraph): GraphNode[] => [...g.nodes, ...(g.branch ? [g.branch.node] : [])];

export function nodeForTimeline(g: LiveGraph, name: string): GraphNode | undefined {
  return allNodes(g).find((n) => n.timeline.some((t) => (t.endsWith("*") ? name.startsWith(t.slice(0, -1)) : t === name)));
}

export const nodeForActivity = (g: LiveGraph, activityType: string | undefined): GraphNode | undefined =>
  activityType ? allNodes(g).find((n) => n.activities.includes(activityType)) : undefined;

const PHRASES: Record<string, (a: Record<string, unknown>) => string> = {
  "erp-read:get_invoice": (a) => `Reading invoice ${a.invoice_id ?? ""}`.trim(),
  "erp-read:get_purchase_order": (a) => `Looking up purchase order ${a.po_id ?? ""}`.trim(),
  "erp-read:list_vendor_purchase_orders": (a) => `Listing the vendor's purchase orders ${a.vendor_id ?? ""}`.trim(),
  "erp-read:get_receipts": (a) => `Checking goods receipts for ${a.po_id ?? "the PO"}`,
  "erp-read:get_vendor": (a) => `Looking up vendor ${a.vendor_id ?? ""}`.trim(),
  "erp-read:get_item": (a) => `Looking up item ${a.item_id ?? ""}`.trim(),
  "erp-read:get_contract_prices": (a) => `Checking contract prices${a.vendor_id ? ` for ${a.vendor_id}` : ""}`,
  "erp-read:get_invoice_history": (a) => `Reviewing invoice history${a.vendor_id ? ` for ${a.vendor_id}` : ""}`,
  "erp-read:search_vendor_messages": (a) => `Searching vendor messages${a.query ? ` for "${a.query}"` : ""}`,
  "docs:read_pdf_text": () => "Reading the document",
};

/** A plain-language line for a tool call, for the agent feed. */
export function toolPhrase(ref: string, args: Record<string, unknown>): string {
  return PHRASES[ref]?.(args) ?? `Calling ${ref}`;
}
