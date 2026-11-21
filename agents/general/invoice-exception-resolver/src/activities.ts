import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Context, log } from "@temporalio/activity";
import {
  connectHttp,
  gatewayCostUsd,
  loadSkills,
  MODEL_CALL,
  McpToolbox,
  replayKey,
  resultText,
  runToolLoop,
  skillsPrompt,
  skillVersions,
  toActivityFailure,
  withHeartbeat,
  type McpCallResult,
  type McpConnection,
  type McpToolboxOptions,
  type ModelAlias,
  type ToolCallRecord,
  type ToolCaller,
} from "@agents/agent-kit";
import { generateText, Output, type LanguageModel } from "ai";
import { agentConfig } from "./agent.config.js";
import {
  DRAFT_MESSAGE_SYSTEM,
  draftMessagePrompt,
  EVIDENCE_SYSTEM,
  evidencePrompt,
  PROPOSE_SYSTEM,
  proposePrompt,
  READ_INVOICE_SYSTEM,
  readInvoicePrompt,
  splitNarration,
} from "./prompts/index.js";
import { addCall, emptyProgress, resumeFrom, type Progress } from "./progress.js";
import { checkCitations } from "./route.js";
import { InvoiceFieldsSchema, MessageSchema, ProposalSchema, type Action, type InvoiceFields, type MessageDraft, type Proposal } from "./schemas.js";
import type { Adjustment, Evidence, InvoiceFacts, MatchResult, Recipient, Usage } from "./types.js";

const EXCERPT_CHARS = 1_500;
/** What the model sees of a tool result (McpToolbox's default maxResultChars). */
const MODEL_RESULT_CHARS = 20_000;
/** An evidence excerpt from model-facing text: the same as resultText(result, EXCERPT_CHARS). */
const excerptOf = (text: string) => (text.length > EXCERPT_CHARS ? `${text.slice(0, EXCERPT_CHARS)}
[cut at ${EXCERPT_CHARS} characters]` : text);
const RECEIVING_ADDRESS = "receiving@company.example";

export interface ActivityDeps {
  models: Record<ModelAlias, LanguageModel>;
  /** Opens a session with an MCP server. Default: Streamable HTTP to the in-cluster Service. */
  connect?: (server: string) => Promise<McpConnection>;
  /** Where skills live: the agent's own first, then shared. */
  skillRoots?: string[];
}

export function defaultSkillRoots(): string[] {
  const own = fileURLToPath(new URL("../skills/", import.meta.url));
  const shared = dirname(fileURLToPath(import.meta.resolve("@agents/skills/package.json")));
  return [own, shared];
}

/** The JSON a match-engine tool returned. */
function json<T>(result: McpCallResult): T {
  if (result.isError) throw new Error(resultText(result, 500));
  return (result.structuredContent as T | undefined) ?? (JSON.parse(resultText(result, 1_000_000)) as T);
}

/** MCP Toolbox rows: one JSON object per text block. */
function rows(result: McpCallResult): Array<Record<string, unknown>> {
  if (result.isError) throw new Error(resultText(result, 500));
  return result.content
    .filter((c) => c.type === "text" && c.text?.trim() && c.text.trim() !== "null")
    .map((c) => JSON.parse(c.text!) as Record<string, unknown>);
}

const usageOf = (step: string, model: string, u: { inputTokens?: number; outputTokens?: number }, costUsd: number): Usage => ({
  step,
  model,
  inputTokens: u.inputTokens ?? 0,
  outputTokens: u.outputTokens ?? 0,
  costUsd,
});

/**
 * Every side effect of the agent. Each runs as a Temporal activity: retried by policy, never
 * repeated once complete. Each opens its own allow-listed MCP toolbox and returns the calls it
 * made, so they land in the workflow history and the portal's inspector.
 */
export function createActivities({ models, connect = (server) => connectHttp(server), skillRoots = defaultSkillRoots() }: ActivityDeps) {
  const withToolbox = async <T>(
    fn: (toolbox: McpToolbox) => Promise<T>,
    hooks: Pick<McpToolboxOptions, "onResult" | "onCall" | "replay"> = {},
  ): Promise<T & { calls: ToolCallRecord[] }> => {
    const toolbox = new McpToolbox({ policy: agentConfig.tools, connect, ...hooks });
    try {
      const value = await fn(toolbox);
      return { ...value, calls: toolbox.calls };
    } finally {
      await toolbox.close();
    }
  };
  const skills = async (names: string[]) => {
    const loaded = await loadSkills(skillRoots, names);
    return { text: skillsPrompt(loaded), versions: skillVersions(loaded) };
  };
  const call = (toolbox: McpToolbox, ref: string, args: Record<string, unknown>, caller: ToolCaller = "workflow") => toolbox.call(ref, args, caller);
  const tolerance = { price_tolerance_pct: agentConfig.tolerance.pricePct, price_tolerance_cents: agentConfig.tolerance.priceCents };

  return {
    /** 1. Deterministic three-way match (match-engine). */
    async runMatch(input: { invoiceId: string }) {
      return withToolbox(async (t) => ({ match: json<MatchResult>(await call(t, "match-engine:run_match", { invoice_id: input.invoiceId, ...tolerance })) }));
    },

    /** 2. Read the vendor's PDF: text layer from docs, fields from the fast model. Injection shows up here. */
    async readInvoice(input: { invoiceId: string }) {
      try {
        return await withToolbox(async (t) => {
          const [invoice] = rows(await call(t, "erp-read:get_invoice", { invoice_id: input.invoiceId }, "activity"));
          if (!invoice) throw new Error(`invoice ${input.invoiceId} not found`);
          const text = resultText(await call(t, "docs:read_pdf_text", { path: String(invoice.document_path) }, "activity"), 20_000);
          const [vendor] = rows(await call(t, "erp-read:get_vendor", { vendor_id: String(invoice.vendor_id) }, "activity"));
          const num = (v: unknown) => (v == null || Number.isNaN(Number(v)) ? undefined : Number(v));
          const facts: InvoiceFacts = {
            vendorId: String(invoice.vendor_id),
            vendorName: vendor?.name ? String(vendor.name) : undefined,
            dueDate: invoice.due_date ? String(invoice.due_date).slice(0, 10) : undefined,
            totalCents: num(invoice.total_cents),
            lines: (Array.isArray(invoice.lines) ? (invoice.lines as Array<Record<string, unknown>>) : []).map((l) => ({
              lineNo: Number(l.line_no),
              itemId: l.item_id ? String(l.item_id) : undefined,
              description: l.description ? String(l.description) : undefined,
              quantity: num(l.quantity),
              uom: l.uom ? String(l.uom) : undefined,
              unitPriceCents: num(l.unit_price_cents),
            })),
          };
          const skill = await skills(["untrusted-content"]);
          const { output, usage, response } = await withHeartbeat((abortSignal, beat) =>
            (beat(emptyProgress("Reading the invoice")),
            generateText({
              ...MODEL_CALL,
              abortSignal,
              model: models[agentConfig.models.extract],
              system: `${READ_INVOICE_SYSTEM}\n\n${skill.text}`,
              prompt: readInvoicePrompt(text),
              output: Output.object({ schema: InvoiceFieldsSchema }),
            })),
          );
          return {
            fields: output as InvoiceFields,
            text,
            documentPath: String(invoice.document_path),
            record: { vendorId: String(invoice.vendor_id), poId: String(invoice.po_id) },
            facts,
            skillVersions: skill.versions,
            usage: usageOf("read invoice", agentConfig.models.extract, usage, gatewayCostUsd(response.headers)),
          };
        });
      } catch (error) {
        throw toActivityFailure(error);
      }
    },

    /** 3. Model-driven evidence gathering over read-only tools, bounded by evidenceRounds. */
    async gatherEvidence(input: { invoiceId: string; match: MatchResult; invoiceText: string; documentPath: string; record?: { vendorId: string; poId: string } }) {
      const evidence: Evidence[] = [
        { ref: "E1", source: "match-engine:run_match", args: { invoice_id: input.invoiceId }, excerpt: input.match.findings.map((f) => `${f.code}: ${f.message}`).join("\n").slice(0, EXCERPT_CHARS) },
        { ref: "E2", source: "docs:read_pdf_text", args: { path: input.documentPath }, excerpt: input.invoiceText.slice(0, EXCERPT_CHARS) },
      ];
      // A retry resumes from the last attempt's heartbeat details: tool calls it already made are
      // answered from the replay cache instead of the server (Live Run view, failover demo).
      const resume = resumeFrom(Context.current().info.heartbeatDetails);
      // Keep the earlier attempt's results in this attempt's heartbeats from the start, so a second kill loses nothing.
      let progress: Progress = { ...emptyProgress("Gathering evidence"), results: [...resume.replay].map(([key, text]) => ({ key, text })) };
      let report: (details: unknown) => void = () => {};
      const cite = (record: ToolCallRecord, text: string) =>
        evidence.push({ ref: `E${evidence.length + 1}`, source: record.ref, args: record.args, excerpt: excerptOf(text) || "(no rows)" });
      const onResult = (record: ToolCallRecord, result: McpCallResult) => {
        const ok = record.caller === "model" && record.outcome === "ok";
        // Cache what the model saw (the toolbox's default cut), so a replayed call gives it the same input.
        const text = ok ? resultText(result, MODEL_RESULT_CHARS) : undefined;
        if (text !== undefined) cite(record, text);
        progress = addCall(progress, record, text);
        report(progress);
      };
      const onCall = (record: ToolCallRecord) => {
        if (record.replayed) {
          const text = resume.replay.get(replayKey(record.ref, record.args)) ?? "";
          cite(record, text);
          progress = addCall(progress, record, text);
          report(progress);
        } else if (record.outcome !== "ok" || record.caller !== "model") {
          progress = addCall(progress, record);
          report(progress);
        }
      };
      try {
        return await withToolbox(async (t) => {
          const skill = await skills(["three-way-match-exceptions", "untrusted-content"]);
          const loop = await withHeartbeat((abortSignal, beat) => {
            report = beat;
            beat(progress);
            return runToolLoop({
              model: models[agentConfig.models.evidence],
              system: `${EVIDENCE_SYSTEM}\n\n${skill.text}`,
              prompt: evidencePrompt(input.invoiceId, input.match, input.invoiceText.slice(0, 6_000), input.record),
              toolbox: t,
              maxSteps: agentConfig.limits.evidenceRounds + 1,
              abortSignal,
            });
          });
          log.info("evidence gathered", { steps: loop.steps, calls: loop.calls.length, stoppedAtLimit: loop.stoppedAtLimit });
          return {
            ...splitNarration(loop.text),
            evidence,
            steps: loop.steps,
            stoppedAtLimit: loop.stoppedAtLimit,
            skillVersions: skill.versions,
            usage: usageOf("gather evidence", agentConfig.models.evidence, loop.usage, loop.usage.costUsd),
          };
        }, { onResult, onCall, replay: resume.replay });
      } catch (error) {
        throw toActivityFailure(error);
      }
    },

    /** 4. The smart model proposes one action, citing evidence; citations are checked here. */
    async proposeResolution(input: {
      invoiceId: string;
      match: MatchResult;
      evidence: Evidence[];
      notes: string;
      revision?: { previous: Proposal; feedback: string };
    }) {
      try {
        const skill = await skills(["ap-resolution-policy", "three-way-match-exceptions", "untrusted-content"]);
        const { output, usage, response } = await withHeartbeat((abortSignal, beat) =>
          (beat(emptyProgress("Proposing a resolution")),
          generateText({
            ...MODEL_CALL,
            abortSignal,
            model: models[agentConfig.models.propose],
            system: `${PROPOSE_SYSTEM}\n\n${skill.text}`,
            prompt: proposePrompt(input.invoiceId, input.match, input.evidence, input.notes, input.revision),
            output: Output.object({ schema: ProposalSchema }),
          })),
        );
        const proposal = output as Proposal;
        const { cited, valid } = checkCitations(proposal, input.evidence.map((e) => e.ref));
        return {
          proposal: { ...proposal, citedEvidence: cited },
          citationsValid: valid,
          skillVersions: skill.versions,
          usage: usageOf(input.revision ? "revise proposal" : "propose", agentConfig.models.propose, usage, gatewayCostUsd(response.headers)),
        };
      } catch (error) {
        throw toActivityFailure(error);
      }
    },

    /** The money for the proposed action: match-engine, never the model. */
    async computeAdjustment(input: { invoiceId: string; action: Action }) {
      return withToolbox(async (t) => ({
        adjustment: json<Adjustment>(await call(t, "match-engine:compute_adjustment", { invoice_id: input.invoiceId, action: input.action, ...tolerance })),
      }));
    },

    /** Draft a message from the facts (fast model, vendor-correspondence) and resolve the address. */
    async draftMessage(input: { invoiceId: string; recipient: Recipient; purpose: string; facts: Record<string, unknown> }) {
      try {
        return await withToolbox(async (t) => {
          const [invoice] = rows(await call(t, "erp-read:get_invoice", { invoice_id: input.invoiceId }, "activity"));
          let to = RECEIVING_ADDRESS;
          if (input.recipient === "vendor") to = String(rows(await call(t, "erp-read:get_vendor", { vendor_id: String(invoice?.vendor_id) }, "activity"))[0]?.email);
          if (input.recipient === "buyer") to = String(rows(await call(t, "erp-read:get_purchase_order", { po_id: String(invoice?.po_id) }, "activity"))[0]?.buyer_email);
          const skill = await skills(["vendor-correspondence", "untrusted-content"]);
          const { output, usage, response } = await withHeartbeat((abortSignal, beat) =>
            (beat(emptyProgress("Drafting the message")),
            generateText({
              ...MODEL_CALL,
              abortSignal,
              model: models[agentConfig.models.draft],
              system: `${DRAFT_MESSAGE_SYSTEM}\n\n${skill.text}`,
              prompt: draftMessagePrompt(input.recipient, input.purpose, { ...input.facts, vendorInvoiceNumber: invoice?.vendor_invoice_number, poId: invoice?.po_id }),
              output: Output.object({ schema: MessageSchema }),
            })),
          );
          return { message: { ...(output as MessageDraft), to }, skillVersions: skill.versions, usage: usageOf("draft message", agentConfig.models.draft, usage, gatewayCostUsd(response.headers)) };
        });
      } catch (error) {
        throw toActivityFailure(error);
      }
    },

    /** Write tools: called only by the workflow, after approval where its rules require. */
    async queueMessage(input: { to: string; subject: string; body: string; invoiceId: string; runId: string }) {
      return withToolbox(async (t) => ({
        outbox: rows(await call(t, "erp-write:queue_message", { to_address: input.to, subject: input.subject, body: input.body, invoice_id: input.invoiceId, run_id: input.runId }))[0] ?? null,
      }));
    },

    async setHold(input: { invoiceId: string }) {
      return withToolbox(async (t) => ({ held: rows(await call(t, "erp-write:set_invoice_hold", { invoice_id: input.invoiceId })).length > 0 }));
    },

    async postResolution(input: {
      invoiceId: string;
      exceptionId: string;
      action: string;
      amountCents: number;
      note: string;
      approvedBy: string;
      runId: string;
      invoiceStatus: "resolved" | "on_hold";
    }) {
      return withToolbox(async (t) => ({
        posted:
          rows(
            await call(t, "erp-write:post_resolution", {
              invoice_id: input.invoiceId,
              exception_id: input.exceptionId,
              action: input.action,
              amount_cents: input.amountCents,
              note: input.note,
              approved_by: input.approvedBy,
              run_id: input.runId,
              invoice_status: input.invoiceStatus,
            }),
          )[0] ?? null,
      }));
    },

    /** 7. Confirm what the ERP now shows. */
    async confirmInvoice(input: { invoiceId: string }) {
      return withToolbox(async (t) => ({ status: String(rows(await call(t, "erp-read:get_invoice", { invoice_id: input.invoiceId }))[0]?.status ?? "unknown") }));
    },

    /** For the queue: open exceptions, oldest first. */
    async listOpenExceptions(input: { limit: number }) {
      return withToolbox(async (t) => ({
        exceptions: rows(await call(t, "erp-read:list_open_exceptions", { limit: input.limit })).map((r) => ({ exceptionId: String(r.id), invoiceId: String(r.invoice_id) })),
      }));
    },
  };
}

export type Activities = ReturnType<typeof createActivities>;
