import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpCallResult, McpConnection, McpToolInfo } from "./types.js";

/**
 * Where an MCP server listens: `MCP_<SERVER>_URL` if set (for example MCP_ERP_READ_URL), otherwise
 * the in-cluster Service `mcp-<server>` on port 8080 at path /mcp (platform/mcp/<server>).
 */
export function mcpServerUrl(server: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = `MCP_${server.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_URL`;
  return env[key] ?? `http://mcp-${server}:8080/mcp`;
}

/** Open a session with an MCP server over Streamable HTTP. */
export async function connectHttp(server: string, url = mcpServerUrl(server)): Promise<McpConnection> {
  return connectTransport(server, new StreamableHTTPClientTransport(new URL(url)));
}

/** Open a session over any MCP transport. Tests use the SDK's in-memory transport. */
export async function connectTransport(server: string, transport: Transport): Promise<McpConnection> {
  const client = new Client({ name: `agent-kit/${server}`, version: "0.1.0" });
  await client.connect(transport);
  let cached: McpToolInfo[] | undefined;
  return {
    async listTools() {
      if (!cached) {
        const tools: McpToolInfo[] = [];
        let cursor: string | undefined;
        do {
          const page = await client.listTools(cursor ? { cursor } : undefined);
          for (const t of page.tools) {
            tools.push({ name: t.name, description: t.description, inputSchema: t.inputSchema as Record<string, unknown> });
          }
          cursor = page.nextCursor;
        } while (cursor);
        cached = tools;
      }
      return cached;
    },
    async callTool(name, args, signal) {
      const result = await client.callTool({ name, arguments: args }, undefined, signal ? { signal } : undefined);
      return result as McpCallResult;
    },
    async close() {
      await client.close();
    },
  };
}
