// Write the synthetic ERP to a folder:
//   seed.sql      schema, grants and data for Postgres (scripts/local/erp-load.sh loads it)
//   docs/         the document store: invoices/*.pdf and emails/*.txt (built into the docs MCP server image)
//   labels.json   the expected answer for each seeded exception, for evals. Never loaded into the ERP.
//
// Usage: node dist/data/cli.js [out-dir] [seed]     (default: data/out, seed 20931)
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { documents } from "./documents.js";
import { generateErp } from "./generate.js";
import { seedSql } from "./sql.js";

const outDir = resolve(process.argv[2] ?? "data/out");
const seed = Number(process.argv[3] ?? 20931);

const data = generateErp(seed);
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "seed.sql"), seedSql(data));
await writeFile(join(outDir, "labels.json"), `${JSON.stringify(data.labels, null, 2)}\n`);
for (const [path, content] of documents(data)) {
  const file = join(outDir, "docs", path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}
console.log(
  `synthetic ERP (seed ${seed}) written to ${outDir}: ${data.vendors.length} vendors, ${data.items.length} items, ` +
    `${data.purchaseOrders.length} POs, ${data.invoices.length} invoices, ${data.exceptions.length} open exceptions, ` +
    `${data.messages.length} messages`,
);
