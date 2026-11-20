// Everything that defines this agent's behavior and limits, in one place.
// Imported by workflow code, so it must stay plain data.
export const agentConfig = {
  name: "invoice-exception-resolver",
  taskQueue: "invoice-exception-resolver",

  /** Environment variable with this agent's LiteLLM virtual key (from Secret litellm-agent-keys). */
  apiKeyEnv: "LITELLM_KEY_INVOICE_EXCEPTION_RESOLVER",

  /** LiteLLM aliases per step. */
  models: { extract: "fast", evidence: "fast", propose: "smart", draft: "fast" },

  /**
   * MCP tool allow-list (ADR-0020). Write tools are workflow-only: the workflow calls them after
   * approval where the rules below require it; the model never sees them.
   */
  tools: {
    allow: [
      "erp-read:get_invoice",
      "erp-read:get_purchase_order",
      "erp-read:list_vendor_purchase_orders",
      "erp-read:get_receipts",
      "erp-read:get_vendor",
      "erp-read:get_item",
      "erp-read:get_contract_prices",
      "erp-read:get_invoice_history",
      "erp-read:search_vendor_messages",
      "erp-read:list_open_exceptions",
      "erp-write:post_resolution",
      "erp-write:queue_message",
      "erp-write:set_invoice_hold",
      "docs:list_directory",
      "docs:read_text_file",
      "docs:read_pdf_text",
      "docs:read_media_file",
      "match-engine:run_match",
      "match-engine:check_duplicate",
      "match-engine:compute_adjustment",
    ],
    workflowOnly: ["erp-write:post_resolution", "erp-write:queue_message", "erp-write:set_invoice_hold"],
  },

  /** Example policy values, set per company. Integer cents throughout. */
  tolerance: { pricePct: 2, priceCents: 5_000, quantity: 0 },
  approval: {
    amountCents: 100_000,
    alwaysFor: ["accept_variance", "short_pay", "reject_duplicate"],
  },
  wait: { reminderDays: [3, 7], escalateDays: 10 },
  limits: { evidenceRounds: 4, rounds: 3 },
  queue: { maxParallel: 10 },
} as const;
