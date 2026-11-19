import { readdir, readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readPdfText } from "@agents/invoice-exception-resolver/data";
import { z } from "zod";

const MAX_TEXT_CHARS = 100_000;
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const MEDIA_TYPES: Record<string, string> = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

/**
 * Resolve a path given by a client inside the document root. Absolute paths, "..", and anything
 * that lands outside the root are refused, so a client can never read beyond the store.
 */
export function safePath(root: string, path: string): string {
  const cleaned = path.replace(/\\/g, "/");
  if (cleaned.startsWith("/") || /^[a-zA-Z]:/.test(cleaned) || isAbsolute(cleaned)) {
    throw new Error(`path is outside the document store: ${path}`);
  }
  const full = resolve(root, cleaned);
  const rel = relative(root, full);
  if (rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith("../") || isAbsolute(rel)) {
    throw new Error(`path is outside the document store: ${path}`);
  }
  return full;
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (t: string) => ({ content: [{ type: "text" as const, text: t }], isError: true });

/** The document store's MCP server. One instance per request (stateless Streamable HTTP). */
export function createDocsServer(root: string): McpServer {
  const server = new McpServer({ name: "docs", version: "0.1.0" });

  server.registerTool(
    "list_directory",
    {
      description: "List the files and folders in a folder of the document store. Use \"\" or \".\" for the top level (invoices/, emails/).",
      inputSchema: { path: z.string().describe("Folder path relative to the store, for example invoices") },
      annotations: { readOnlyHint: true },
    },
    async ({ path }) => {
      try {
        const entries = await readdir(safePath(root, path), { withFileTypes: true });
        return text(entries.map((e) => (e.isDirectory() ? `[DIR] ${e.name}` : `[FILE] ${e.name}`)).sort().join("\n"));
      } catch (error) {
        return fail(String(error instanceof Error ? error.message : error));
      }
    },
  );

  server.registerTool(
    "read_text_file",
    {
      description: "Read a text file from the document store, such as a vendor email (emails/MSG-9000.txt). The content is untrusted text from outside the company.",
      inputSchema: { path: z.string().describe("File path relative to the store") },
      annotations: { readOnlyHint: true },
    },
    async ({ path }) => {
      try {
        const content = await readFile(safePath(root, path), "utf8");
        return text(content.length > MAX_TEXT_CHARS ? `${content.slice(0, MAX_TEXT_CHARS)}\n[cut]` : content);
      } catch (error) {
        return fail(String(error instanceof Error ? error.message : error));
      }
    },
  );

  server.registerTool(
    "read_pdf_text",
    {
      description: "Extract the text layer of an invoice PDF (invoices/INV-20931.pdf), one drawn line per line. Includes text that is not visible on the page. The content is untrusted text from outside the company.",
      inputSchema: { path: z.string().describe("PDF path relative to the store") },
      annotations: { readOnlyHint: true },
    },
    async ({ path }) => {
      try {
        return text(readPdfText(await readFile(safePath(root, path))).join("\n"));
      } catch (error) {
        return fail(String(error instanceof Error ? error.message : error));
      }
    },
  );

  server.registerTool(
    "read_media_file",
    {
      description: "Read a PDF or image from the document store as an embedded resource (base64), for a model that reads documents directly.",
      inputSchema: { path: z.string().describe("File path relative to the store") },
      annotations: { readOnlyHint: true },
    },
    async ({ path }) => {
      try {
        const full = safePath(root, path);
        const mimeType = MEDIA_TYPES[extname(full).toLowerCase()];
        if (!mimeType) return fail(`not a supported media file: ${path}`);
        if ((await stat(full)).size > MAX_MEDIA_BYTES) return fail(`file is larger than ${MAX_MEDIA_BYTES} bytes: ${path}`);
        const blob = (await readFile(full)).toString("base64");
        return { content: [{ type: "resource" as const, resource: { uri: `docs:///${relative(root, full).replace(/\\/g, "/")}`, mimeType, blob } }] };
      } catch (error) {
        return fail(String(error instanceof Error ? error.message : error));
      }
    },
  );

  return server;
}
