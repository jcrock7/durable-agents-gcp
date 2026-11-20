// match-engine MCP server over Streamable HTTP (stateless), scaled by a HorizontalPodAutoscaler.
//   POST /mcp      MCP requests
//   GET  /healthz  liveness and readiness
// Reads ERP data through erp-read (MCP_ERP_READ_URL, default the in-cluster Service).
// TOLERANCE_PRICE_PCT / TOLERANCE_PRICE_CENTS / TOLERANCE_QUANTITY: default tolerance (2 / 5000 / 0).
// ALLOWED_HOSTS: comma-separated Host names accepted; default any. PORT: default 8080.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { connectHttp, McpToolbox } from "@agents/agent-kit";
import { ERP_READ_TOOLS, loadMatchInput } from "./load.js";
import { createMatchServer } from "./server.js";

const port = Number(process.env.PORT ?? 8080);
const allowedHosts = (process.env.ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
const tolerance = {
  pricePct: Number(process.env.TOLERANCE_PRICE_PCT ?? 2),
  priceCents: Number(process.env.TOLERANCE_PRICE_CENTS ?? 5000),
  quantity: Number(process.env.TOLERANCE_QUANTITY ?? 0),
};

// One long-lived erp-read session per process. If it breaks, start a new one and retry once.
let toolbox = newToolbox();
function newToolbox() {
  return new McpToolbox({ policy: { allow: ERP_READ_TOOLS }, connect: (server) => connectHttp(server) });
}
async function load(invoiceId: string) {
  try {
    return await loadMatchInput(toolbox, invoiceId);
  } catch (error) {
    if (error instanceof Error && error.name === "NotFoundError") throw error;
    const broken = toolbox;
    toolbox = newToolbox();
    void broken.close();
    return loadMatchInput(toolbox, invoiceId);
  }
}
// Keep the call log from growing forever in a long-running server.
setInterval(() => toolbox.calls.splice(0, toolbox.calls.length), 60_000).unref();

function hostAllowed(req: IncomingMessage): boolean {
  if (allowedHosts.length === 0) return true;
  return allowedHosts.includes((req.headers.host ?? "").replace(/:\d+$/, ""));
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? "/").split("?")[0];
  if (path === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  if (path !== "/mcp") {
    res.writeHead(404).end();
    return;
  }
  if (!hostAllowed(req)) {
    res.writeHead(403).end();
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, { allow: "POST" }).end();
    return;
  }
  const server = createMatchServer({ load, tolerance });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

const http = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    console.error(JSON.stringify({ level: "error", msg: "request failed", error: String(error) }));
    if (!res.headersSent) res.writeHead(500).end();
  });
});
http.listen(port, () => console.log(JSON.stringify({ level: "info", msg: "match-engine MCP server listening", port, tolerance })));
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    http.close(() => {
      void toolbox.close().finally(() => process.exit(0));
    });
  });
}
