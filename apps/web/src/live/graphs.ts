// The workflow graph the Live Run view draws, per agent. Each node lists the activities and
// timeline entries (resolve.workflow.ts step names) that belong to it. Clock figures (review window,
// reminder and escalation days) are never written here: withSchedule adds them from the agent's config,
// which the API serves.
import type { Agent } from "../api.js";

export interface GraphNode {
  id: string;
  label: string;
  /** Temporal activity types run in this node. */
  activities: string[];
  /** Timeline entry names (exact, or a prefix ending in "*"). */
  timeline: string[];
  /** Usage step names (CaseState.usage[].step) billed to this node. */
  usage?: string[];
  /** What the node is when idle, under its label ("Rule", "Policy", "Person · up to 7 days"). */
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
      { id: "match", label: "Match", activities: ["runMatch"], timeline: ["Match"], hint: "Rule" },
      { id: "read", label: "Read Invoice", activities: ["readInvoice"], timeline: ["Read invoice PDF"], usage: ["read invoice"] },
      { id: "evidence", label: "Gather Evidence", activities: ["gatherEvidence"], timeline: ["Gather evidence"], usage: ["gather evidence"] },
      { id: "propose", label: "Propose", activities: ["proposeResolution", "computeAdjustment"], timeline: ["Propose resolution", "Revise proposal"], usage: ["propose", "revise proposal"] },
      { id: "route", label: "Route", activities: [], timeline: ["Route"], hint: "Policy" },
      { id: "gate", label: "Review Gate", activities: [], timeline: ["Waiting for approval", "Approved", "Sent back", "Escalated by reviewer"], hint: "Person", gate: true },
      {
        id: "finish",
        label: "Draft → Post → Confirm",
        activities: ["draftMessage", "queueMessage", "postResolution", "confirmInvoice"],
        timeline: ["Message queued", "Post resolution", "Confirm"],
        usage: ["draft message"],
        hint: "ERP Write",
      },
    ],
    branch: {
      from: "match",
      label: "If No Goods Receipt",
      node: { id: "hold", label: "Hold for Goods Receipt", activities: [], timeline: ["Waiting for receipt", "Receipt found", "Reminder *"], hint: "Daily re-check" },
    },
  },
};

const days = (ns: readonly number[]) => (ns.length > 1 ? `${ns.slice(0, -1).join(", ")} and ${ns.at(-1)}` : String(ns[0] ?? ""));

/** The graph with the agent's configured clocks in its hints: the review window and the receipt wait. */
export function withSchedule(g: LiveGraph | undefined, schedule: Agent["schedule"] | undefined): LiveGraph | undefined {
  if (!g || !schedule) return g;
  const hint = (n: GraphNode): GraphNode =>
    n.gate ? { ...n, hint: `Person · up to ${schedule.reviewDays} days` } : n.id === "hold" && schedule.receipt ? { ...n, hint: `Daily re-check · reminders on days ${days(schedule.receipt.reminderDays)} · escalates on day ${schedule.receipt.escalateDays}` } : n;
  return { nodes: g.nodes.map(hint), ...(g.branch ? { branch: { ...g.branch, node: hint(g.branch.node) } } : {}) };
}

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
