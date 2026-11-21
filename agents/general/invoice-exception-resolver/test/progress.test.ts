import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { connectTransport, replayKey, type McpConnection, type ToolCallRecord } from "@agents/agent-kit";
import { MockActivityEnvironment } from "@temporalio/testing";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createActivities } from "../dist/activities.js";
import { addCall, emptyProgress, PROGRESS_MAX_BYTES, resumeFrom } from "../dist/progress.js";
import type { MatchResult } from "../dist/index.js";

const record = (n: number): ToolCallRecord => ({
  id: `c${n}`,
  ref: "erp-read:get_vendor",
  server: "erp-read",
  tool: "get_vendor",
  caller: "model",
  args: { vendor_id: `V-${n}` },
  outcome: "ok",
  durationMs: 1,
  at: "2026-11-20T00:00:00.000Z",
});

describe("progress details", () => {
  it("addCall stops storing results past 256 KB but keeps call records", () => {
    let p = emptyProgress();
    const big = "x".repeat(100_000);
    for (let i = 0; i < 5; i++) p = addCall(p, record(i), big);
    expect(p.calls).toHaveLength(5);
    expect(p.results.length).toBe(2);
    expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThanOrEqual(PROGRESS_MAX_BYTES);
  });

  it("resumeFrom ignores malformed or wrong-version details", () => {
    expect(resumeFrom({ v: 2, calls: [], results: [] }).replay.size).toBe(0);
    expect(resumeFrom("x").replay.size).toBe(0);
    expect(resumeFrom(undefined).calls).toEqual([]);
  });
});

describe("gatherEvidence resume", () => {
  const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
  const script = () =>
    new MockLanguageModelV4({
      doGenerate: [
        {
          content: [
            { type: "tool-call" as const, toolCallId: "t1", toolName: "erp-read__get_purchase_order", input: JSON.stringify({ po_id: "PO-1" }) },
            { type: "tool-call" as const, toolCallId: "t2", toolName: "erp-read__get_vendor", input: JSON.stringify({ vendor_id: "V-1" }) },
          ],
          finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
          usage,
          warnings: [],
        },
        { content: [{ type: "text" as const, text: "The amendment explains the variance." }], finishReason: { unified: "stop" as const, raw: "stop" }, usage, warnings: [] },
      ],
    });

  it("gatherEvidence resumed from heartbeat details calls no tool twice", async () => {
    const hits: Record<string, number> = {};
    const erp = (): McpServer => {
      const s = new McpServer({ name: "erp-read", version: "1" });
      for (const name of ["get_purchase_order", "get_vendor"]) {
        s.registerTool(name, { description: name, inputSchema: { po_id: z.string().optional(), vendor_id: z.string().optional() } }, async (args) => {
          hits[name] = (hits[name] ?? 0) + 1;
          // get_vendor returns more than an evidence excerpt (1,500 chars) but less than the model sees (20,000).
          return { content: [{ type: "text", text: JSON.stringify({ name, ...args, ...(name === "get_vendor" ? { notes: "x".repeat(3_000) } : {}) }) }] };
        });
      }
      return s;
    };
    const connect = async (server: string): Promise<McpConnection> => {
      const [client, side] = InMemoryTransport.createLinkedPair();
      await erp().connect(side);
      return connectTransport(server, client);
    };
    const input = {
      invoiceId: "INV-1",
      match: { invoiceId: "INV-1", status: "exception", findings: [{ code: "PRICE_VARIANCE", severity: "exception", message: "price" }] } as unknown as MatchResult,
      invoiceText: "invoice text",
      documentPath: "invoices/INV-1.pdf",
    };

    const first = new MockActivityEnvironment();
    let details: unknown;
    first.on("heartbeat", (d: unknown) => (details = d ?? details));
    const fast = script();
    const a1 = createActivities({ models: { fast, smart: fast }, connect });
    const uninterrupted = await first.run(a1.gatherEvidence, input);

    const second = new MockActivityEnvironment({ heartbeatDetails: details });
    const beats: unknown[] = [];
    second.on("heartbeat", (d: unknown) => beats.push(d));
    const fast2 = script();
    const a2 = createActivities({ models: { fast: fast2, smart: fast2 }, connect });
    const resumed = await second.run(a2.gatherEvidence, input);

    expect(hits).toEqual({ get_purchase_order: 1, get_vendor: 1 });
    expect(resumed.evidence).toEqual(uninterrupted.evidence);
    expect(resumed.calls.filter((c: ToolCallRecord) => c.replayed)).toHaveLength(2);

    // The model gets the same tool results it got the first time, not the shorter evidence excerpt.
    const toolResults = (m: MockLanguageModelV4) => JSON.stringify(m.doGenerateCalls[1]!.prompt.filter((p) => p.role === "tool"));
    expect(toolResults(fast2)).toBe(toolResults(fast));
    expect(resumeFrom(details).replay.get(replayKey("erp-read:get_vendor", { vendor_id: "V-1" }))!.length).toBeGreaterThan(3_000);

    // A resumed attempt keeps the earlier results in its own heartbeats from the start, so a second kill loses nothing.
    expect(resumeFrom(beats[0]).replay.size).toBe(2);
  });
});
