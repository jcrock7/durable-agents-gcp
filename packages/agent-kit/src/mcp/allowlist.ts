/**
 * Which MCP tools an agent may use, and which of those the model may see (ADR-0020).
 *
 * `allow` lists every `server:tool` pair the agent may call at all. `workflowOnly` lists the pairs
 * that change a system: the workflow may call them (after approval where its rules require), but
 * they are never offered to the model. Anything not in `allow` is dropped from `tools/list` and
 * refused if called.
 */
export interface ToolPolicy {
  allow: readonly string[];
  workflowOnly?: readonly string[];
}

export interface ToolRef {
  server: string;
  tool: string;
}

const REF = /^([a-z0-9][a-z0-9-]*):([A-Za-z0-9_.-]+)$/;

export function parseToolRef(ref: string): ToolRef {
  const match = REF.exec(ref);
  if (!match) throw new Error(`invalid tool reference "${ref}": expected "server:tool"`);
  return { server: match[1]!, tool: match[2]! };
}

export class AllowList {
  private readonly allowed: Set<string>;
  private readonly workflowOnly: Set<string>;

  constructor(policy: ToolPolicy) {
    for (const ref of [...policy.allow, ...(policy.workflowOnly ?? [])]) parseToolRef(ref);
    this.allowed = new Set(policy.allow);
    this.workflowOnly = new Set(policy.workflowOnly ?? []);
    for (const ref of this.workflowOnly) {
      if (!this.allowed.has(ref)) throw new Error(`workflow-only tool "${ref}" is not in the allow-list`);
    }
  }

  /** May the agent call this tool at all? */
  isAllowed(server: string, tool: string): boolean {
    return this.allowed.has(`${server}:${tool}`);
  }

  /** May the model see and call this tool? */
  isModelVisible(server: string, tool: string): boolean {
    const ref = `${server}:${tool}`;
    return this.allowed.has(ref) && !this.workflowOnly.has(ref);
  }

  /** The servers this agent uses. */
  servers(): string[] {
    return [...new Set([...this.allowed].map((ref) => parseToolRef(ref).server))].sort();
  }
}
