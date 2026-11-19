// Check the agent's MCP servers end to end, through the same allow-listed client the agent uses:
// list each server's tools, make one read call per server, and check that the allow-list holds.
// Makes no changes: the erp-write check puts a paid invoice "on hold", which the tool refuses
// (it only holds invoices in exception), so it proves the writer's grants without changing data.
//
// Server URLs come from MCP_<SERVER>_URL (scripts/local/mcp-verify.sh port-forwards and sets them).
// Usage: node dist/verify-mcp.js
import { ApplicationFailure } from "@temporalio/common";
import { connectHttp, McpToolbox, resultText } from "@agents/agent-kit";
import { agentConfig } from "./agent.config.js";

const checks: Array<[string, () => Promise<string>]> = [];
const check = (name: string, fn: () => Promise<string>) => checks.push([name, fn]);

const toolbox = new McpToolbox({ policy: agentConfig.tools, connect: (server) => connectHttp(server) });

check("tools listed per server (allow-listed only)", async () => {
  const tools = await toolbox.listTools();
  const byServer = new Map<string, string[]>();
  for (const t of tools) byServer.set(t.server, [...(byServer.get(t.server) ?? []), t.name]);
  const expected = new Set(agentConfig.tools.allow);
  const missing = [...expected].filter((ref) => !tools.some((t) => t.ref === ref));
  if (missing.length) throw new Error(`allow-listed tools not offered by their servers: ${missing.join(", ")}`);
  return [...byServer].map(([s, names]) => `${s}: ${names.length} (${names.sort().join(", ")})`).join("; ");
});

check("write tools hidden from the model", async () => {
  const visible = (await toolbox.listTools({ forModel: true })).map((t) => t.ref);
  const leaked = visible.filter((ref) => ref.startsWith("erp-write:"));
  if (leaked.length) throw new Error(`model can see ${leaked.join(", ")}`);
  return `${visible.length} tools visible to the model, none from erp-write`;
});

check("erp-read: get_invoice INV-20931", async () => {
  const result = await toolbox.call("erp-read:get_invoice", { invoice_id: "INV-20931" }, "activity");
  if (result.isError) throw new Error(resultText(result, 500));
  const text = resultText(result, 2_000);
  if (!text.includes("INV-20931")) throw new Error(`unexpected result: ${text.slice(0, 200)}`);
  return text.slice(0, 160);
});

check("erp-read: list_open_exceptions", async () => {
  const result = await toolbox.call("erp-read:list_open_exceptions", { limit: 200 }, "activity");
  if (result.isError) throw new Error(resultText(result, 500));
  // MCP Toolbox returns one text block (a JSON object) per row.
  const rows = resultText(result, 1_000_000).split("\n").filter(Boolean).map((line) => JSON.parse(line) as { id: string });
  if (rows.length === 0) throw new Error("no open exceptions: is the ERP seeded?");
  return `${rows.length} open exceptions, first ${rows[0]!.id}`;
});

check("erp-write: grants work, nothing changes", async () => {
  const result = await toolbox.call("erp-write:set_invoice_hold", { invoice_id: "INV-20000" }, "workflow");
  if (result.isError) throw new Error(resultText(result, 500));
  const text = resultText(result, 500);
  if (text.includes("on_hold")) throw new Error(`INV-20000 was put on hold: ${text}`);
  return `set_invoice_hold on a paid invoice changed nothing (${text || "no rows"})`;
});

check("erp-write: refused to the model", async () => {
  try {
    await toolbox.call("erp-write:post_resolution", {}, "model");
  } catch (error) {
    if (error instanceof ApplicationFailure && error.type === "ToolNotAllowed") return "refused with ToolNotAllowed";
    throw error;
  }
  throw new Error("the model was allowed to call erp-write:post_resolution");
});

check("docs: read_pdf_text invoices/INV-20931.pdf", async () => {
  const result = await toolbox.call("docs:read_pdf_text", { path: "invoices/INV-20931.pdf" }, "activity");
  if (result.isError) throw new Error(resultText(result, 500));
  const lines = resultText(result, 10_000).split("\n");
  return `${lines.length} lines; ${lines.slice(0, 3).join(" | ")}`;
});

check("docs: path traversal refused", async () => {
  const result = await toolbox.call("docs:read_text_file", { path: "../../etc/passwd" }, "activity");
  if (!result.isError) throw new Error("read outside the document store");
  return resultText(result, 200);
});

let failed = 0;
try {
  for (const [name, fn] of checks) {
    try {
      console.log(`ok    ${name}: ${await fn()}`);
    } catch (error) {
      failed++;
      console.log(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} finally {
  await toolbox.close();
}
console.log(`${checks.length - failed}/${checks.length} checks passed; ${toolbox.calls.length} tool calls recorded`);
process.exit(failed ? 1 : 0);
