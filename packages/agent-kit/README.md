# agent-kit

Plumbing every agent shares, so each agent folder holds only its own logic.

| Import | Use from | Provides |
|---|---|---|
| `@agents/agent-kit` | activities, the worker | `createModels` (LiteLLM `fast`/`smart` clients through the AI SDK), `MODEL_CALL` (`maxRetries: 0`), `withHeartbeat`, `toActivityFailure`, `requireEnv`, `AgentRegistration`; MCP tools (`McpToolbox`, `runToolLoop`, `connectHttp`); skills (`loadSkills`, `skillsPrompt`, `skillVersions`) |
| `@agents/agent-kit/workflow` | workflow code only | `MODEL_CALL_OPTIONS` / `TOOL_CALL_OPTIONS` (timeouts and retry policies), `ReviewGate` and the `review` update, `failureTypeOf`, `FailureType` |

The split matters: workflow code is bundled into Temporal's deterministic sandbox, so it must not import the AI SDK or anything that does I/O.

## MCP tools

Agents reach external systems through MCP servers in the cluster ([ADR-0020](../../docs/adr/0020-mcp-tools-and-skills.md)). Create one `McpToolbox` per activity run and close it at the end:

```ts
const toolbox = new McpToolbox({ policy: agentConfig.tools, connect: (server) => connectHttp(server) });
try {
  // Workflow-driven call (the activity runs it on the workflow's behalf):
  const match = await toolbox.call("match-engine:run_match", { invoiceId }, "workflow");
  // Model-driven loop over read-only tools, at most 4 steps:
  const { text, calls } = await runToolLoop({ model: models.fast, system, prompt, toolbox, maxSteps: 4 });
} finally {
  await toolbox.close();
}
```

| Rule | How |
|---|---|
| Allow-list | `policy.allow` lists `server:tool` pairs. Other tools are dropped from `tools/list` and refused if called, with the non-retryable `ToolNotAllowed` failure |
| Write tools never reach the model | `policy.workflowOnly` pairs may be called by workflow or activity code, but are not offered to the model and are refused if it asks for them |
| Every call recorded | `toolbox.calls` holds a `ToolCallRecord` per call: `server:tool`, caller (`workflow`, `activity` or `model`), arguments, outcome (`ok`, `error`, `refused`), result size, duration. Results themselves are not kept. Return the records from the activity so they land in the workflow history |
| Results when you need them | `onResult(record, result)` receives each result that ran, for an activity that cites tool output as evidence |
| Tool errors vs. failures | A tool that reports an error returns `isError` and is recorded as `error`; the model sees the message. A transport failure throws and is retried by the activity's policy |
| Bounded loops | `runToolLoop` stops after `maxSteps` model steps and reports `stoppedAtLimit` |

Server addresses: `MCP_<SERVER>_URL` if set (for example `MCP_ERP_READ_URL`), else the in-cluster Service `http://mcp-<server>:8080/mcp`.

## Skills

A skill is a folder with a `SKILL.md`: front matter with `name`, `description` and a version (`version:` or `metadata.version:`), then instructions. `loadSkills(roots, names)` looks in each root in order (the agent's `skills/` first, then shared `packages/skills/`) and fails if one is missing. `skillsPrompt` turns them into system-prompt text; `skillVersions` gives `{ name: version }` to record on the run.

## Retries and failures

Temporal retries, not the AI SDK, so each attempt is visible in the workflow history:

| Failure type | Raised when | Retried? |
|---|---|---|
| `ModelCallFailed` | timeout, HTTP 429, 5xx | Yes: 2s, 4s, 8s… up to 1 min, 5 attempts |
| `GuardrailBlocked` | LiteLLM's prompt-injection guardrail rejected the input | No |
| `BudgetExceeded` | the agent's LiteLLM budget is used up | No |
| `Unauthorized` | the agent's key is missing or revoked | No |
| `InvalidRequest` | other 4xx from LiteLLM | No |
| `ToolNotAllowed` | a tool call outside the agent's allow-list (host or MCP `server:tool`), or a write tool requested by the model | No |

Model calls also heartbeat every 5 seconds (`withHeartbeat`) against a 20-second heartbeat timeout, so a call lost with its worker is retried in about 20 seconds rather than after the 3-minute call timeout.

## Human review

```ts
const review = new ReviewGate();                       // once, at the start of the workflow
const decision = await review.wait(draftVersion, "7 days");
// undefined → timed out; { approved: true } or { approved: false, feedback }
```

Callers send `review` as a Temporal **update**, so they get an answer: `{ accepted, draftVersion }`, or an error if the workflow isn't waiting or a rejection has no feedback.

Tests: [test/errors.test.ts](test/errors.test.ts), [test/mcp.test.ts](test/mcp.test.ts) (a real MCP server over the SDK's in-memory transport, and a mock model driving the tool loop), [test/skills.test.ts](test/skills.test.ts).
