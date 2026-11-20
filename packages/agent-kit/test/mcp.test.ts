import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ApplicationFailure } from "@temporalio/common";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AllowList,
  connectTransport,
  FailureType,
  mcpServerUrl,
  McpToolbox,
  runToolLoop,
  type McpConnection,
  type ToolCallRecord,
} from "../dist/index.js";

/** A small fake ERP server: two read tools and one write tool, plus one tool no agent lists. */
function erpServer(): McpServer {
  const server = new McpServer({ name: "erp", version: "1.0.0" });
  server.registerTool("get_invoice", { description: "Read an invoice", inputSchema: { id: z.string() } }, async ({ id }) => ({
    content: [{ type: "text", text: JSON.stringify({ id, totalCents: 128400 }) }],
  }));
  server.registerTool("get_vendor", { description: "Read a vendor", inputSchema: { id: z.string() } }, async ({ id }) =>
    id === "missing"
      ? { content: [{ type: "text", text: "vendor not found" }], isError: true }
      : { content: [{ type: "text", text: `vendor ${id}` }] },
  );
  server.registerTool("post_resolution", { description: "Post a resolution", inputSchema: { id: z.string() } }, async ({ id }) => ({
    content: [{ type: "text", text: `posted ${id}` }],
  }));
  server.registerTool("drop_tables", { description: "Not for agents", inputSchema: {} }, async () => ({
    content: [{ type: "text", text: "dropped" }],
  }));
  return server;
}

async function connectInMemory(server: McpServer): Promise<McpConnection> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  return connectTransport("erp", clientSide);
}

const policy = {
  allow: ["erp:get_invoice", "erp:get_vendor", "erp:post_resolution"],
  workflowOnly: ["erp:post_resolution"],
};

let toolbox: McpToolbox | undefined;
afterEach(async () => {
  await toolbox?.close();
  toolbox = undefined;
});

function newToolbox(onCall?: (r: ToolCallRecord) => void): McpToolbox {
  toolbox = new McpToolbox({ policy, connect: () => connectInMemory(erpServer()), onCall });
  return toolbox;
}

async function refusal(promise: Promise<unknown>): Promise<ApplicationFailure> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApplicationFailure);
  return error as ApplicationFailure;
}

describe("AllowList", () => {
  it("rejects malformed references and workflow-only tools that are not allowed", () => {
    expect(() => new AllowList({ allow: ["no-colon"] })).toThrow(/server:tool/);
    expect(() => new AllowList({ allow: ["erp:a"], workflowOnly: ["erp:b"] })).toThrow(/not in the allow-list/);
  });

  it("lists the servers and separates model-visible tools", () => {
    const list = new AllowList(policy);
    expect(list.servers()).toEqual(["erp"]);
    expect(list.isAllowed("erp", "post_resolution")).toBe(true);
    expect(list.isModelVisible("erp", "post_resolution")).toBe(false);
    expect(list.isModelVisible("erp", "get_invoice")).toBe(true);
    expect(list.isAllowed("erp", "drop_tables")).toBe(false);
  });
});

describe("McpToolbox", () => {
  it("lists only allow-listed tools, and keeps write tools from the model", async () => {
    const box = newToolbox();
    expect((await box.listTools()).map((t) => t.ref).sort()).toEqual(["erp:get_invoice", "erp:get_vendor", "erp:post_resolution"]);
    expect((await box.listTools({ forModel: true })).map((t) => t.ref).sort()).toEqual(["erp:get_invoice", "erp:get_vendor"]);
  });

  it("calls an allowed tool and records it", async () => {
    const seen: ToolCallRecord[] = [];
    const box = newToolbox((r) => seen.push(r));
    const result = await box.call("erp:get_invoice", { id: "INV-20931" }, "activity");
    expect(result.content[0]?.text).toContain("128400");
    expect(box.calls).toHaveLength(1);
    expect(box.calls[0]).toMatchObject({ ref: "erp:get_invoice", caller: "activity", outcome: "ok", args: { id: "INV-20931" } });
    expect(box.calls[0]!.resultChars).toBeGreaterThan(0);
    expect(seen).toEqual(box.calls);
  });

  it("refuses a tool that is not on the allow-list, without reaching the server", async () => {
    const box = newToolbox();
    const failure = await refusal(box.call("erp:drop_tables", {}, "workflow"));
    expect(failure.type).toBe(FailureType.ToolNotAllowed);
    expect(failure.nonRetryable).toBe(true);
    expect(box.calls[0]).toMatchObject({ ref: "erp:drop_tables", outcome: "refused" });
  });

  it("lets the workflow call a write tool but refuses it to the model", async () => {
    const box = newToolbox();
    await expect(box.call("erp:post_resolution", { id: "R1" }, "workflow")).resolves.toBeDefined();
    const failure = await refusal(box.call("erp:post_resolution", { id: "R1" }, "model"));
    expect(failure.message).toMatch(/workflow-only/);
    expect(box.calls.map((c) => c.outcome)).toEqual(["ok", "refused"]);
  });

  it("records a tool-reported error without throwing", async () => {
    const box = newToolbox();
    const result = await box.call("erp:get_vendor", { id: "missing" }, "activity");
    expect(result.isError).toBe(true);
    expect(box.calls[0]).toMatchObject({ outcome: "error", error: "vendor not found" });
  });
});

describe("runToolLoop", () => {
  const usage = {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  };
  const toolStep = (calls: Array<{ name: string; input: object }>) => ({
    content: calls.map((c, i) => ({ type: "tool-call" as const, toolCallId: `call-${c.name}-${i}`, toolName: c.name, input: JSON.stringify(c.input) })),
    finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
    usage,
    warnings: [],
  });
  const textStep = (text: string) => ({
    content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop" as const, raw: "stop" },
    usage,
    warnings: [],
  });

  it("offers only model-visible tools, runs them, and records a refused write tool", async () => {
    const box = newToolbox();
    const model = new MockLanguageModelV4({
      doGenerate: [
        toolStep([
          { name: "erp__get_invoice", input: { id: "INV-1" } },
          { name: "erp__post_resolution", input: { id: "INV-1" } },
        ]),
        textStep("The invoice total is $1,284.00."),
      ],
    });

    const result = await runToolLoop({ model, system: "You resolve invoices.", prompt: "Check INV-1", toolbox: box, maxSteps: 4 });

    const offered = (model.doGenerateCalls[0]!.tools ?? []).map((t) => t.name).sort();
    expect(offered).toEqual(["erp__get_invoice", "erp__get_vendor"]);
    expect(result.text).toContain("1,284.00");
    expect(result.steps).toBe(2);
    expect(result.stoppedAtLimit).toBe(false);
    const outcomes = result.calls.map((c) => `${c.ref} ${c.outcome}`);
    expect(outcomes).toHaveLength(2);
    expect(outcomes).toEqual(expect.arrayContaining(["erp:get_invoice ok", "erp:post_resolution refused"]));
    expect(result.calls.every((c) => c.caller === "model")).toBe(true);
    expect(result.usage.inputTokens).toBe(20);
  });

  it("stops at the step limit", async () => {
    const box = newToolbox();
    const again = toolStep([{ name: "erp__get_vendor", input: { id: "V1" } }]);
    const model = new MockLanguageModelV4({ doGenerate: [again, again, again, again] });

    const result = await runToolLoop({ model, system: "s", prompt: "p", toolbox: box, maxSteps: 2 });

    expect(result.steps).toBe(2);
    expect(result.stoppedAtLimit).toBe(true);
    expect(result.calls).toHaveLength(2);
  });
});

describe("mcpServerUrl", () => {
  it("uses MCP_<SERVER>_URL, else the in-cluster service", () => {
    expect(mcpServerUrl("erp-read", { MCP_ERP_READ_URL: "http://localhost:9000/mcp" })).toBe("http://localhost:9000/mcp");
    expect(mcpServerUrl("match-engine", {})).toBe("http://mcp-match-engine:8080/mcp");
  });
});
