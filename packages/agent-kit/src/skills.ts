import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * A skill: a folder with a SKILL.md whose front matter names and versions it, and whose body is
 * instructions the agent loads for a step (ADR-0020).
 */
export interface Skill {
  name: string;
  version: string;
  description: string;
  /** The SKILL.md body, without front matter. */
  body: string;
  dir: string;
}

/** Read one skill folder. The front matter needs `name`, `description` and a version (`version:` or `metadata.version:`). */
export async function loadSkill(dir: string): Promise<Skill> {
  const path = join(dir, "SKILL.md");
  const text = (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) throw new Error(`${path}: missing front matter`);
  const meta = parseFrontMatter(match[1]!);
  const name = meta["name"];
  const description = meta["description"];
  const version = meta["version"] ?? meta["metadata.version"];
  if (!name || !description || !version) throw new Error(`${path}: front matter needs name, description and version`);
  return { name, description, version, body: match[2]!.trim(), dir };
}

/**
 * Load skills by name, looking in each root in order (the agent's own `skills/` first, then the
 * shared `packages/skills/`). Throws if a skill is missing, so a run never proceeds without the
 * instructions it was written for.
 */
export async function loadSkills(roots: readonly string[], names: readonly string[]): Promise<Skill[]> {
  const skills: Skill[] = [];
  for (const name of names) {
    let found: Skill | undefined;
    for (const root of roots) {
      const dir = join(root, name);
      if (await isFile(join(dir, "SKILL.md"))) {
        found = await loadSkill(dir);
        break;
      }
    }
    if (!found) throw new Error(`skill "${name}" not found in ${roots.join(", ")}`);
    if (found.name !== name) throw new Error(`skill folder "${name}" declares name "${found.name}"`);
    skills.push(found);
  }
  return skills;
}

/** The skills as a block of system-prompt text, each under its name and version. */
export function skillsPrompt(skills: readonly Skill[]): string {
  return skills.map((s) => `<skill name="${s.name}" version="${s.version}">\n${s.body}\n</skill>`).join("\n\n");
}

/** `{ name: version }` for the run's record, so a later edit to a skill never changes how an old run reads. */
export function skillVersions(skills: readonly Skill[]): Record<string, string> {
  return Object.fromEntries(skills.map((s) => [s.name, s.version]));
}

/** Minimal front matter: `key: value` lines, plus one level of nesting (`metadata:` then indented keys). */
function parseFrontMatter(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  let parent: string | undefined;
  for (const line of block.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const nested = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    const top = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (nested && parent) {
      out[`${parent}.${nested[1]}`] = unquote(nested[2]!);
    } else if (top) {
      const value = top[2]!.trim();
      parent = value === "" ? top[1] : undefined;
      if (value !== "") out[top[1]!] = unquote(value);
    }
  }
  return out;
}

function unquote(value: string): string {
  const v = value.trim();
  return /^(["']).*\1$/.test(v) ? v.slice(1, -1) : v;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
