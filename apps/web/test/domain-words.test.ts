import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The No Hard-Coded Domain Rule (docs/design/agent-portal/agent-screen-guidelines.md): a shared component holds no
// domain word. Every label comes from the agent's vocabulary (src/vocab.ts, declared in the API's agent registry)
// or a neutral fallback. Domain words live only in src/domain/<agent>.tsx and the registry.
const SHARED = ["App.tsx", "AgentView.tsx", "CaseParts.tsx", "CaseTable.tsx", "CaseView.tsx", "Inspector.tsx", "Overview.tsx", "Sidebar.tsx", "StepStrip.tsx", "sheet.tsx", "vocab.ts"];
const DOMAIN_WORDS = /\b(invoices?|exceptions?|evidence|schedule a|vendors?|erp|purchase orders?|goods receipts?|cves?|vulnerabilit(y|ies)|incidents?|on-call)\b/i;

/** The text a user can read: string and template literals, and JSX text. Comments and identifiers are skipped. */
function visibleText(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const out: string[] = [];
  for (const m of code.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`|>([^<>{}]+)</g)) {
    const text = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    // Agent ids and import paths are identifiers, not words on screen.
    if (!text || /^[a-z0-9./-]+$/.test(text)) continue;
    out.push(text);
  }
  return out;
}

describe("shared components hold no domain words", () => {
  for (const file of SHARED) {
    it(file, () => {
      const hits = visibleText(readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8")).filter((t) => DOMAIN_WORDS.test(t));
      expect(hits).toEqual([]);
    });
  }

  it("catches a domain word typed into a component", () => {
    expect(visibleText(`<h2>Evidence</h2> const a = "Search by vendor";`).filter((t) => DOMAIN_WORDS.test(t))).toHaveLength(2);
  });
});
