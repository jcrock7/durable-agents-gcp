# Research and summarize agent

Answers a research question from Wikipedia with a short, cited summary, and waits for a person to approve it before it counts as done. The first prototype agent: it exercises every part of the platform (Temporal durability, LiteLLM routing and budgets, the prompt-injection guardrail, tool allow-lists and human-in-the-loop review) with no API keys beyond the platform's own.

## How it works

```text
question
   │
   ▼
plan queries ──► search Wikipedia ──► read articles ──► write draft ──► wait for review ──► result
 (fast model)    (up to 3 queries,     (up to 5, in      (smart model,    approve ─────────► approved
                  in parallel)          parallel)         cites [n])      reject + feedback ─► revise draft ─┐
                                                                               ▲                          │
                                                                               └──────────────────────────┘
                                                                          (up to 2 revisions; 7-day timeout)
```

| Step | Runs as | Model / tool |
|---|---|---|
| Plan queries | activity `planQueries` | `fast` (LiteLLM alias), structured output |
| Search | activity `searchWikipedia`, one per query, in parallel | Wikipedia search API |
| Read | activity `readArticle`, one per article, in parallel | Wikipedia extracts API (plain text, truncated to 6,000 characters) |
| Draft / revise | activity `writeDraft` | `smart`, structured output; citations checked against the real sources |
| Review | Temporal **update** `review` | a person: approve, or reject with feedback |

The workflow ([research.workflow.ts](src/workflows/research.workflow.ts)) only orchestrates; every model and tool call is an activity, so a step that finished is never repeated after a crash and a step that failed is retried by policy.

## What makes it durable

- **Crash anywhere, resume where it stopped.** Kill the worker mid-draft and the run continues on the next worker, with planning, searches and reads not repeated. Model calls heartbeat every 5 seconds, so a lost call is retried within about 20 seconds.
- **Retries belong to Temporal.** The AI SDK's own retries are off. Rate limits and server errors retry with backoff (5 attempts); a guardrail block, exhausted budget or bad key doesn't retry.
- **Waiting is free.** A run waiting for review holds no worker or memory, for up to 7 days.
- **Every step is recorded.** The Temporal UI shows each activity, its input, output, attempts and timing.

## Input and output

Input ([schemas.ts](src/schemas.ts)):

| Field | Default | |
|---|---|---|
| `question` | required | 10 to 500 characters |
| `maxSources` | 5 | 1 to 8 articles |
| `requireApproval` | `true` | `false` returns the first draft without review |

Result `status` ([types.ts](src/types.ts)):

| Status | Meaning |
|---|---|
| `approved` | A reviewer approved the draft |
| `auto_approved` | Run with `requireApproval: false` |
| `rejected` | Still rejected after 2 revisions |
| `expired` | Nobody reviewed it within 7 days |
| `blocked` | The prompt-injection guardrail rejected the question or a source; `reason` says why |
| `no_sources` | No readable articles matched |

The result also carries the summary, key points, sources (`[n]` → title and URL), the draft version, the reviewer and the prompt version.

## Limits and safety

All in [agent.config.ts](src/agent.config.ts):

- **Budget:** its own LiteLLM key, $2 per 30 days, models `fast` and `smart` only (`AGENT_BUDGETS_USD` in `scripts/lib/k8s.sh`). A run costs about 5 cents.
- **Tool allow-list:** the tools refuse any host except `en.wikipedia.org`.
- **Untrusted content:** article text goes to the model as data, with instructions to ignore anything in it that tries to change the rules, and the LiteLLM guardrail screens it before every model call.

## Run it

On k3d after `scripts/local/apply-k8s.sh`, or on GKE after `scripts/gke/apply-k8s.sh`. The commands use the Temporal CLI inside the Temporal pod, so nothing extra is installed:

```bash
T="kubectl -n agents exec temporal-0 -- temporal"

# Start
$T workflow start --task-queue research-summarize --type researchAndSummarize --workflow-id research-1 \
  --input '{"question":"How did the Apollo Guidance Computer influence modern computing?"}'

# Watch: stage, queries, sources, current draft
$T workflow query --workflow-id research-1 --name progress -o json | jq '.queryResult[0] | {stage, draftVersion, queries, sources}'
$T workflow query --workflow-id research-1 --name progress -o json | jq -r '.queryResult[0].draft.summary'

# Review: reject with feedback (a new draft follows), or approve
$T workflow update execute --workflow-id research-1 --name review \
  --input '{"approved":false,"feedback":"Add one sentence on rope core memory.","reviewer":"me"}'
$T workflow update execute --workflow-id research-1 --name review --input '{"approved":true,"reviewer":"me"}'

# Result
$T workflow result --workflow-id research-1 -o json | jq '.result | {status, draftVersion, sources}'
```

The `review` update is refused, with a reason, when the run isn't waiting for review or a rejection has no feedback. In the Temporal UI (`kubectl -n agents port-forward svc/temporal 8233:8233`, then http://localhost:8233) the run shows each step and its timing.

### Demo: kill the worker mid-run

```bash
$T workflow start --task-queue research-summarize --type researchAndSummarize --workflow-id research-crash \
  --input '{"question":"Why did the Byzantine Empire outlast the Western Roman Empire?"}'
sleep 5   # until progress shows "drafting"
kubectl -n agents delete pod -l app.kubernetes.io/name=worker --grace-period=0 --force
```

With `LOCAL_MODELS=mock`, set `MOCK_LATENCY_SECONDS=20` first so the draft call is still running when the pod dies.

Within about 30 seconds the replacement pod picks the run up. The history shows `writeDraft` with `attempt=2` and the last failure `activity Heartbeat timeout`; planning, searches and reads ran once.

```bash
$T workflow show --workflow-id research-crash -o json \
  | jq -r '.events[] | select(.activityTaskStartedEventAttributes) | "\(.eventTime[11:19]) attempt=\(.activityTaskStartedEventAttributes.attempt) \(.activityTaskStartedEventAttributes.lastFailure.message // "")"'
```

## Tests

```bash
pnpm test     # from the repo root: builds, then runs every test
```

- [test/workflow.test.ts](test/workflow.test.ts): the real workflow on Temporal's time-skipping test server with mocked activities: approval, revision, the revision limit, the 7-day expiry (skipped in about a second), guardrail blocks, no sources, invalid input.
- [test/tools.test.ts](test/tools.test.ts): Wikipedia parsing and truncation, which HTTP errors retry, the host allow-list, and source selection.

## Files

| Path | What |
|---|---|
| `src/agent.config.ts` | Task queue, models per step, allowed hosts, limits |
| `src/schemas.ts` | Input and model-output schemas (Zod) |
| `src/workflows/` | The deterministic workflow |
| `src/activities.ts` | Model and tool calls |
| `src/tools/wikipedia.ts` | Wikipedia API client and the host allow-list |
| `src/prompts/` | Prompts and `PROMPT_VERSION` |
| `src/signals.ts` | `progress` query and `review` update |
| `src/client.ts` | Typed start / progress / review helpers for the API |
| `src/index.ts` | What the worker registers |

Not yet: an eval suite (`evals/`, ADR-0009) and the web UI for review.
