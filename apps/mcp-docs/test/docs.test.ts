import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { writePdf } from "@agents/invoice-exception-resolver/data";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDocsServer, safePath } from "../dist/server.js";

let root: string;
let client: Client;

type Result = { content: Array<{ type: string; text?: string; resource?: { mimeType: string; blob: string } }>; isError?: boolean };
const call = async (name: string, path: string) => (await client.callTool({ name, arguments: { path } })) as Result;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "docs-"));
  await mkdir(join(root, "invoices"));
  await mkdir(join(root, "emails"));
  await writeFile(join(root, "invoices", "INV-1.pdf"), writePdf([{ text: "Invoice number: ABC-1", x: 50, y: 700 }], "Invoice"));
  await writeFile(join(root, "emails", "MSG-1.txt"), "Subject: Price change notice\n\nHello");
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createDocsServer(root).connect(serverSide);
  client = new Client({ name: "test", version: "1" });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client.close();
  await rm(root, { recursive: true, force: true });
});

describe("docs MCP server", () => {
  it("lists the four read-only tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["list_directory", "read_media_file", "read_pdf_text", "read_text_file"]);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
  });

  it("lists folders and reads text, PDF text and PDF bytes", async () => {
    expect((await call("list_directory", "")).content[0]!.text).toBe("[DIR] emails\n[DIR] invoices");
    expect((await call("read_text_file", "emails/MSG-1.txt")).content[0]!.text).toContain("Price change notice");
    expect((await call("read_pdf_text", "invoices/INV-1.pdf")).content[0]!.text).toBe("Invoice number: ABC-1");
    const media = await call("read_media_file", "invoices/INV-1.pdf");
    expect(media.content[0]!.resource!.mimeType).toBe("application/pdf");
    expect(Buffer.from(media.content[0]!.resource!.blob, "base64").subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("refuses paths outside the store and reports missing files as tool errors", async () => {
    for (const bad of ["../secret", "invoices/../../secret", "/etc/passwd", "C:/Windows/win.ini"]) {
      const result = await call("read_text_file", bad);
      expect(result.isError, bad).toBe(true);
      expect(result.content[0]!.text).toMatch(/outside the document store/);
    }
    expect((await call("read_text_file", "emails/missing.txt")).isError).toBe(true);
    expect((await call("read_media_file", "emails/MSG-1.txt")).isError).toBe(true);
  });

  it("safePath keeps paths inside the root", () => {
    expect(safePath(root, "invoices/INV-1.pdf")).toBe(join(root, "invoices", "INV-1.pdf"));
    expect(safePath(root, "./invoices")).toBe(join(root, "invoices"));
    expect(() => safePath(root, "..")).toThrow();
  });
});
