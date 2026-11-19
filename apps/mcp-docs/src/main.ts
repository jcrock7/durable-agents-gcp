// docs MCP server: read-only access to the document store over Streamable HTTP (stateless).
//   POST /mcp      MCP requests
//   GET  /healthz  liveness and readiness
// DOCS_ROOT: the store (default /docs, built into the image). PORT: default 8080.
// ALLOWED_HOSTS: comma-separated Host names accepted (DNS rebinding protection); default: any.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createDocsServer } from "./server.js";

const root = process.env.DOCS_ROOT ?? "/docs";
const port = Number(process.env.PORT ?? 8080);
const allowedHosts = (process.env.ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);

function hostAllowed(req: IncomingMessage): boolean {
  if (allowedHosts.length === 0) return true;
  const host = (req.headers.host ?? "").replace(/:\d+$/, "");
  return allowedHosts.includes(host);
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
    // Stateless server: no server-initiated streams or sessions to resume or delete.
    res.writeHead(405, { allow: "POST" }).end();
    return;
  }
  const server = createDocsServer(root);
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
http.listen(port, () => console.log(JSON.stringify({ level: "info", msg: "docs MCP server listening", port, root })));
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => http.close(() => process.exit(0)));
