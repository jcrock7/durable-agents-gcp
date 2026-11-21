// Demo controls for the Live Run view (docs/superpowers/specs/2026-11-20-live-run-view-design.md).
// Registered only when DEMO_CONTROLS=true: start a sample invoice case, and hard-kill the worker
// running a model step so the audience watches Temporal fail the case over to another worker.
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { z } from "zod";
import type { KubernetesSource, TemporalSource } from "./sources.js";

/** Writes the synthetic ERP as the erp_demo role: clones a seeded exception under a fresh invoice id. */
export interface ErpDemoSource {
  cloneException(templateInvoiceId: string): Promise<{ invoiceId: string; exceptionId: string }>;
}

/** The seeded price-variance demo invoice (data/generate.ts DEMO_INVOICE_ID). */
export const SAMPLE_TEMPLATE_INVOICE = "INV-20931";
/** Activities that heartbeat, so a killed worker is noticed within the 20s heartbeat timeout. */
export const MODEL_ACTIVITIES = ["readInvoice", "gatherEvidence", "proposeResolution", "draftMessage"];

const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;

export function registerDemo(app: FastifyInstance, deps: { temporal: TemporalSource; kubernetes: KubernetesSource; erp: ErpDemoSource }): void {
  const { temporal, kubernetes, erp } = deps;

  app.post("/api/demo/sample-case", async () => {
    const { invoiceId, exceptionId } = await erp.cloneException(SAMPLE_TEMPLATE_INVOICE);
    const workflowId = invoiceId.toLowerCase();
    await temporal.start("resolveInvoiceException", "invoice-exception-resolver", workflowId, { invoiceId, exceptionId });
    return { workflowId };
  });

  const KillBody = z.object({ workflowId: z.string().regex(ID) });
  app.post("/api/demo/kill-worker", async (req, reply) => {
    const body = KillBody.safeParse(req.body);
    if (!body.success || !temporal.describe || !kubernetes.workerPods || !kubernetes.deletePod) return reply.code(400).send({ error: "invalid request" });
    const run = await temporal.describe(body.data.workflowId);
    const active = run?.pending.find((p) => MODEL_ACTIVITIES.includes(p.activityType));
    if (!active) return reply.code(409).send({ error: "no model activity running" });
    const pods = await kubernetes.workerPods();
    // Temporal's default worker identity is <pid>@<hostname>, and a pod's hostname is its name.
    const named = active.lastWorkerIdentity?.split("@").pop();
    const pod = pods.find((p) => p.name === named)?.name ?? pods.find((p) => p.ready)?.name;
    if (!pod) return reply.code(409).send({ error: "no worker pod found" });
    await kubernetes.deletePod(pod);
    return { pod };
  });
}

/** ErpDemoSource over Postgres (ERP_DEMO_URL, the erp_demo role). */
export function pgErpDemoSource(connectionString: string): ErpDemoSource {
  const pool = new pg.Pool({ connectionString, max: 2 });
  const attempt = async (template: string) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // No table lock (erp_demo may only insert): two racing clones collide on the primary key,
      // and the loser retries once with the next id.
      const { rows } = await client.query<{ n: number }>("SELECT coalesce(max(substring(id from 5)::int), 0) + 1 AS n FROM erp.invoices WHERE id ~ '^INV-[0-9]+$'");
      const n = rows[0]!.n;
      const invoiceId = `INV-${n}`;
      const exceptionId = `EX-${n}`;
      const copied = await client.query(
        `INSERT INTO erp.invoices (id, vendor_id, vendor_invoice_number, po_id, invoice_date, due_date, total_cents, status, remit_bank_last4, document_path)
         SELECT $2, vendor_id, vendor_invoice_number, po_id, invoice_date, due_date, total_cents, 'exception', remit_bank_last4, document_path
         FROM erp.invoices WHERE id = $1`,
        [template, invoiceId],
      );
      if (copied.rowCount !== 1) throw new Error(`template invoice ${template} not found`);
      await client.query(
        `INSERT INTO erp.invoice_lines (invoice_id, line_no, po_line_no, item_id, description, quantity, uom, unit_price_cents)
         SELECT $2, line_no, po_line_no, item_id, description, quantity, uom, unit_price_cents FROM erp.invoice_lines WHERE invoice_id = $1`,
        [template, invoiceId],
      );
      await client.query(
        `INSERT INTO erp.exceptions (id, invoice_id, raised_on, reason_codes, status)
         SELECT $3, $2, current_date, reason_codes, 'open' FROM erp.exceptions WHERE invoice_id = $1 ORDER BY raised_on DESC LIMIT 1`,
        [template, invoiceId, exceptionId],
      );
      await client.query("COMMIT");
      return { invoiceId, exceptionId };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };
  return {
    async cloneException(template) {
      try {
        return await attempt(template);
      } catch (error) {
        if ((error as { code?: string }).code === "23505") return attempt(template); // unique violation: take the next id
        throw error;
      }
    },
  };
}
