// Demo controls for the Live Run view (docs/superpowers/specs/2026-11-20-live-run-view-design.md).
// Registered only when DEMO_CONTROLS=true: start a sample invoice case, and hard-kill the worker
// running a model step so the audience watches Temporal fail the case over to another worker.
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { z } from "zod";
import type { KubernetesSource, TemporalSource } from "./sources.js";

/**
 * Writes the synthetic ERP as the erp_demo role. The sample case reuses the seeded demo invoice:
 * reopening it (and removing what earlier sample runs posted) keeps its PDF, PO and vendor history
 * consistent, so a repeat run isn't mistaken for a duplicate of an earlier one.
 */
export interface ErpDemoSource {
  resetException(invoiceId: string): Promise<{ invoiceId: string; exceptionId: string }>;
}

/** The seeded price-variance demo invoice (data/generate.ts DEMO_INVOICE_ID). */
export const SAMPLE_INVOICE = "INV-20931";
export const SAMPLE_PREFIX = `${SAMPLE_INVOICE.toLowerCase()}-demo-`;
/** Activities that heartbeat, so a killed worker is noticed within the 20s heartbeat timeout. */
export const MODEL_ACTIVITIES = ["readInvoice", "gatherEvidence", "proposeResolution", "draftMessage"];

const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;

/** The pod a worker identity names. The worker sets `<hostname>/<agent>` (apps/worker/src/main.ts); the SDK default is `<pid>@<hostname>`. */
export function podFromIdentity(identity: string | undefined): string | undefined {
  if (!identity) return undefined;
  return identity.split("/")[0]!.split("@").pop() || undefined;
}

export function registerDemo(app: FastifyInstance, deps: { temporal: TemporalSource; kubernetes: KubernetesSource; erp: ErpDemoSource }): void {
  const { temporal, kubernetes, erp } = deps;

  app.post("/api/demo/sample-case", async () => {
    // One sample at a time: a second press opens the one already running.
    const [current] = await temporal.listRuns(`WorkflowType = 'resolveInvoiceException' AND WorkflowId STARTS_WITH '${SAMPLE_PREFIX}' AND ExecutionStatus = 'Running'`, 1);
    if (current) return { workflowId: current.workflowId };
    const { invoiceId, exceptionId } = await erp.resetException(SAMPLE_INVOICE);
    const workflowId = `${SAMPLE_PREFIX}${Date.now().toString(36)}`;
    await temporal.start("resolveInvoiceException", "invoice-exception-resolver", workflowId, { invoiceId, exceptionId });
    return { workflowId };
  });

  const KillBody = z.object({ workflowId: z.string().regex(ID) });
  app.post("/api/demo/kill-worker", async (req, reply) => {
    const body = KillBody.safeParse(req.body);
    if (!body.success || !temporal.describe || !kubernetes.workerPods || !kubernetes.deletePod) return reply.code(400).send({ error: "invalid request" });
    const run = await temporal.describe(body.data.workflowId);
    const active = run?.pending.find((p) => MODEL_ACTIVITIES.includes(p.activityType) && p.state === "STARTED");
    if (!active) return reply.code(409).send({ error: "no model activity running" });
    // Only the pod actually running the step, and only while it is alive. After a kill the activity
    // still names the dead pod until its heartbeat times out; never fall back to another worker.
    const name = podFromIdentity(active.lastWorkerIdentity);
    const pod = (await kubernetes.workerPods()).find((p) => p.name === name && p.ready);
    if (!pod) return reply.code(409).send({ error: "that worker is already gone; Temporal is retrying the step" });
    await kubernetes.deletePod(pod.name);
    return { pod: pod.name };
  });
}

/** ErpDemoSource over Postgres (ERP_DEMO_URL, the erp_demo role). */
export function pgErpDemoSource(connectionString: string): ErpDemoSource {
  const pool = new pg.Pool({ connectionString, max: 2 });
  return {
    async resetException(invoiceId) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query<{ id: string }>("SELECT id FROM erp.exceptions WHERE invoice_id = $1 ORDER BY raised_on DESC LIMIT 1", [invoiceId]);
        const exceptionId = rows[0]?.id;
        if (!exceptionId) throw new Error(`no exception for ${invoiceId}`);
        await client.query("DELETE FROM erp.outbox WHERE invoice_id = $1", [invoiceId]);
        await client.query("DELETE FROM erp.resolutions WHERE invoice_id = $1", [invoiceId]);
        await client.query("UPDATE erp.exceptions SET status = 'open' WHERE id = $1", [exceptionId]);
        await client.query("UPDATE erp.invoices SET status = 'exception' WHERE id = $1", [invoiceId]);
        await client.query("COMMIT");
        return { invoiceId, exceptionId };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
