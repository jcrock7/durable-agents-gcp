# agent-kit

Plumbing every agent shares, so each agent folder holds only its own logic.

| Import | Use from | Provides |
|---|---|---|
| `@agents/agent-kit` | activities, the worker | `createModels` (LiteLLM `fast`/`smart` clients through the AI SDK), `MODEL_CALL` (`maxRetries: 0`), `withHeartbeat`, `toActivityFailure`, `requireEnv`, `AgentRegistration` |
| `@agents/agent-kit/workflow` | workflow code only | `MODEL_CALL_OPTIONS` / `TOOL_CALL_OPTIONS` (timeouts and retry policies), `ReviewGate` and the `review` update, `failureTypeOf`, `FailureType` |

The split matters: workflow code is bundled into Temporal's deterministic sandbox, so it must not import the AI SDK or anything that does I/O.

## Retries and failures

Temporal retries, not the AI SDK, so each attempt is visible in the workflow history:

| Failure type | Raised when | Retried? |
|---|---|---|
| `ModelCallFailed` | timeout, HTTP 429, 5xx | Yes: 2s, 4s, 8s… up to 1 min, 5 attempts |
| `GuardrailBlocked` | LiteLLM's prompt-injection guardrail rejected the input | No |
| `BudgetExceeded` | the agent's LiteLLM budget is used up | No |
| `Unauthorized` | the agent's key is missing or revoked | No |
| `InvalidRequest` | other 4xx from LiteLLM | No |
| `ToolNotAllowed` | a tool call outside the agent's host allow-list | No |

Model calls also heartbeat every 5 seconds (`withHeartbeat`) against a 20-second heartbeat timeout, so a call lost with its worker is retried in about 20 seconds rather than after the 3-minute call timeout.

## Human review

```ts
const review = new ReviewGate();                       // once, at the start of the workflow
const decision = await review.wait(draftVersion, "7 days");
// undefined → timed out; { approved: true } or { approved: false, feedback }
```

Callers send `review` as a Temporal **update**, so they get an answer: `{ accepted, draftVersion }`, or an error if the workflow isn't waiting or a rejection has no feedback.

Tests: [test/errors.test.ts](test/errors.test.ts).
