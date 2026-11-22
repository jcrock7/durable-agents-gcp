// Demo controls for the Live Run view (docs/superpowers/specs/2026-11-20-live-run-view-design.md).
// Registered only when DEMO_CONTROLS=true: start a sample invoice case, and hard-kill the worker
// running a model step so the audience watches Temporal fail the case over to another worker.
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { z } from "zod";
import type { KubernetesSource, TemporalSource } from "./sources.js";

/**
 * Writes the synthetic ERP as the erp_demo role. Each sample run takes the next unused demo-pool
 * invoice (INV-20931-D2, -D3, …; data/generate.ts DEMO_POOL_SIZE), a copy of the demo invoice with its
 * own PO, receipt, vendor invoice number and PDF, and raises its exception. Every sample case is a
 * distinct invoice, and nothing an earlier run posted is removed. Undefined once the pool is used up.
 */
export interface ErpDemoSource {
  raiseNextSample(): Promise<{ invoiceId: string; exceptionId: string } | undefined>;
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

  app.post("/api/demo/sample-case", async (_req, reply) => {
    // One sample at a time: a second press opens the one already running.
    const [current] = await temporal.listRuns(`WorkflowType = 'resolveInvoiceException' AND WorkflowId STARTS_WITH '${SAMPLE_PREFIX}' AND ExecutionStatus = 'Running'`, 1);
    if (current) return { workflowId: current.workflowId };
    const next = await erp.raiseNextSample();
    if (!next) {
      return reply.code(409).send({ error: "every demo invoice has been used; reload the synthetic ERP (scripts/local/erp-load.sh) to start over" });
    }
    const { invoiceId, exceptionId } = next;
    // inv-20931-demo-d2-<time>: the prefix finds a running sample; the pool suffix keeps ids readable.
    const suffix = invoiceId.slice(SAMPLE_INVOICE.length + 1).toLowerCase();
    const workflowId = `${SAMPLE_PREFIX}${suffix}-${Date.now().toString(36)}`;
    await temporal.start("resolveInvoiceException", "invoice-exception-resolver", workflowId, { invoiceId, exceptionId });
    return { workflowId };
  });

  // A research brief from the portal: the same workflow and input as the README's command line.
  const BriefBody = z.object({ question: z.string().trim().min(10).max(500) });
  app.post("/api/demo/research-brief", async (req, reply) => {
    const body = BriefBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "ask a full question, 10 to 500 characters" });
    const workflowId = `research-${Date.now().toString(36)}`;
    await temporal.start("researchAndSummarize", "research-summarize", workflowId, { question: body.data.question });
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
    async raiseNextSample() {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // The lowest unused pool invoice (D2 before D10); SKIP LOCKED so two presses never take the same one.
        const { rows } = await client.query<{ id: string }>(
          "SELECT id FROM erp.invoices WHERE id LIKE $1 AND status = 'received' ORDER BY length(id), id LIMIT 1 FOR UPDATE SKIP LOCKED",
          [`${SAMPLE_INVOICE}-D%`],
        );
        const invoiceId = rows[0]?.id;
        if (!invoiceId) {
          await client.query("ROLLBACK");
          return undefined;
        }
        // The same exception the seeded demo invoice carries, under the pool invoice's own id.
        const { rows: ex } = await client.query<{ id: string }>("SELECT id FROM erp.exceptions WHERE invoice_id = $1 ORDER BY raised_on DESC LIMIT 1", [SAMPLE_INVOICE]);
        if (!ex[0]) throw new Error(`no exception for ${SAMPLE_INVOICE}`);
        const exceptionId = `${ex[0].id}${invoiceId.slice(SAMPLE_INVOICE.length)}`;
        await client.query(
          "INSERT INTO erp.exceptions (id, invoice_id, raised_on, reason_codes, status) SELECT $1, $2, raised_on, reason_codes, 'open' FROM erp.exceptions WHERE id = $3",
          [exceptionId, invoiceId, ex[0].id],
        );
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
