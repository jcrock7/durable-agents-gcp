import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { checkDuplicate, computeAdjustment, runMatch } from "./engine.js";
import { ACTIONS, type MatchInput, type Tolerance } from "./types.js";

export interface MatchServerDeps {
  /** Loads the ERP data for one invoice. */
  load: (invoiceId: string) => Promise<MatchInput>;
  /** Default tolerance; callers may pass their own policy values per call. */
  tolerance: Tolerance;
}

const json = (value: object) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

const invoiceId = z.string().regex(/^INV-\d+(-D\d+)?$/).describe("ERP invoice id, for example INV-20931");
const toleranceArgs = {
  price_tolerance_pct: z.number().min(0).max(100).optional().describe("Price tolerance as a percentage of the PO line amount; the lower of this and the cents limit applies. Defaults to the server's setting"),
  price_tolerance_cents: z.number().int().min(0).optional().describe("Price tolerance in cents. Defaults to the server's setting"),
};

/** One instance per request (stateless Streamable HTTP). */
export function createMatchServer(deps: MatchServerDeps): McpServer {
  const server = new McpServer({ name: "match-engine", version: "0.1.0" });
  const tol = (a: { price_tolerance_pct?: number; price_tolerance_cents?: number }): Tolerance => ({
    pricePct: a.price_tolerance_pct ?? deps.tolerance.pricePct,
    priceCents: a.price_tolerance_cents ?? deps.tolerance.priceCents,
    quantity: deps.tolerance.quantity,
  });
  const guarded = async (fn: () => Promise<ReturnType<typeof json>>) => {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof Error && error.name === "NotFoundError") return fail(error.message);
      throw error;
    }
  };

  server.registerTool(
    "run_match",
    {
      description:
        "Deterministic three-way match of one invoice against its PO and goods receipts, with the price tolerance rules. Returns matched or exception, each finding (price variance with the contract price on the invoice date, quantity over received, no receipt, unit-of-measure conversion, charges not on the PO, wrong PO with candidate POs, duplicate, changed bank details) with amounts in cents, and the exception types the findings point to.",
      inputSchema: { invoice_id: invoiceId, ...toleranceArgs },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => guarded(async () => json(runMatch(await deps.load(args.invoice_id), tol(args)))),
  );

  server.registerTool(
    "check_duplicate",
    {
      description: "Look for the same invoice already in the vendor's history: the same invoice number once re-send suffixes (-R, COPY) are removed, or the same PO and amount.",
      inputSchema: { invoice_id: invoiceId },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => guarded(async () => json(checkDuplicate(await deps.load(args.invoice_id)))),
  );

  server.registerTool(
    "compute_adjustment",
    {
      description:
        "The money for a proposed resolution action, computed from the match: the variance accepted, the credit to request, the amount to withhold, or the duplicate to reject, plus what would be paid. Use these amounts; never compute them yourself.",
      inputSchema: { invoice_id: invoiceId, action: z.enum(ACTIONS).describe("The proposed action"), ...toleranceArgs },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => guarded(async () => json(computeAdjustment(await deps.load(args.invoice_id), args.action, tol(args)))),
  );

  return server;
}
