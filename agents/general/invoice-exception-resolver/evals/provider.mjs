// promptfoo provider: runs one labelled exception through the deployed agent, end to end (real
// MCP servers, real models through LiteLLM), and returns where the case stands at its first
// decision point: waiting for a person, waiting for a receipt, or finished. A case that is left
// waiting is then terminated, so the eval never approves anything; cases the rules let through
// without a person do post to the synthetic ERP (reset it afterwards with scripts/local/erp-load.sh).
//
// TEMPORAL_ADDRESS (default localhost:7233, via kubectl port-forward), EVAL_RUN (a tag for workflow ids).
import { Client, Connection } from "@temporalio/client";

const DECISION_STAGES = new Set(["awaiting_review", "waiting", "done"]);
const TIMEOUT_MS = 6 * 60 * 1000;
const run = process.env.EVAL_RUN ?? new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);

let clientPromise;
function client() {
  clientPromise ??= Connection.connect({ address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233" }).then((connection) => new Client({ connection }));
  return clientPromise;
}

export default class InvoiceCaseProvider {
  id() {
    return "invoice-exception-resolver";
  }

  async callApi(_prompt, context) {
    const { invoiceId, exceptionId } = context.vars;
    const c = await client();
    const workflowId = `eval-${run}-${invoiceId.toLowerCase()}`;
    const started = Date.now();
    const handle = await c.workflow.start("resolveInvoiceException", {
      taskQueue: "invoice-exception-resolver",
      workflowId,
      args: [{ exceptionId, invoiceId }],
    });

    let state;
    for (;;) {
      try {
        state = await handle.query("caseState");
      } catch {
        state = undefined; // not started yet
      }
      if (state && DECISION_STAGES.has(state.stage)) break;
      if (Date.now() - started > TIMEOUT_MS) {
        await handle.terminate("eval: no decision point within 6 minutes").catch(() => undefined);
        return { error: `timed out at stage ${state?.stage ?? "unknown"}` };
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (state.stage !== "done") await handle.terminate(`eval: stopped at ${state.stage}`).catch(() => undefined);

    const costUsd = state.usage.reduce((sum, u) => sum + (u.costUsd ?? 0), 0);
    const summary = {
      workflowId,
      seconds: Math.round((Date.now() - started) / 1000),
      stage: state.stage,
      status: state.status ?? null,
      reasons: state.reasons,
      proposal: state.proposal ?? null,
      citationsValid: state.citationsValid ?? null,
      route: state.route ?? null,
      amountCents: state.adjustment?.amountCents ?? null,
      evidence: state.evidence.map((e) => `${e.ref} ${e.source}`),
      toolCalls: state.toolCalls.length,
      refusedCalls: state.toolCalls.filter((t) => t.outcome === "refused").map((t) => t.ref),
      usage: state.usage,
      costUsd,
    };
    return { output: JSON.stringify(summary), cost: costUsd };
  }
}
