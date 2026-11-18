# Agents

Agents are grouped by industry, then one folder per agent. Everything an agent needs lives in its folder: workflows, activities, tools, prompts and tests. Shared plumbing lives in [`packages/agent-kit`](../packages/agent-kit), and the single worker process in [`apps/worker`](../apps/worker) runs every agent, whatever its industry ([ADR-0013](../docs/adr/0013-consolidated-workloads.md), [ADR-0016](../docs/adr/0016-repository-structure.md)).

| Industry | Agents | Status |
|---|---|---|
| [general](general/) | Industry-neutral agents that prove the platform: [research-summarize](general/research-summarize/) | Built |
| [financial-services](financial-services/) | Five agents for brokerage, retirement and compliance work, with business cases ([ADR-0017](../docs/adr/0017-prototype-agent-portfolio.md)) | Planned |
| [manufacturing](manufacturing/) | Production, quality, maintenance and supply-chain work | To be defined |
| [healthcare](healthcare/) | Administrative and operational work for providers, payers and life sciences | To be defined |
| [technology](technology/) | Engineering, IT operations, support and security work | To be defined |

All agents use synthetic or public data only. To add an industry, create `agents/<industry>/` with a README listing its agents (copy [financial-services/README.md](financial-services/README.md)).

## Layout of an agent

```text
agents/<industry>/<agent-name>/
├── README.md                 # purpose, flow diagram, inputs/outputs, budget, how to run and demo it
├── business-case.md          # business purpose, value proposition, cost, risks and controls
├── package.json              # workspace package @agents/<agent-name>
├── tsconfig.json
├── src/
│   ├── agent.config.ts       # task queue, model alias per step, API-key variable, tool allow-list, limits
│   ├── index.ts              # registration the worker loads: { name, taskQueue, workflowsPath, createActivities }
│   ├── client.ts             # typed start / progress / review helpers for the API
│   ├── schemas.ts            # input and model-output Zod schemas
│   ├── types.ts              # progress and result types
│   ├── signals.ts            # queries and updates (progress, review)
│   ├── workflows/            # deterministic orchestration only (bundled by the worker)
│   ├── activities.ts         # every side effect: model calls (AI SDK → LiteLLM), tool calls
│   ├── tools/                # tool clients; the host allow-list is enforced here
│   └── prompts/              # prompt templates and PROMPT_VERSION
├── test/
│   ├── workflow.test.ts      # Temporal time-skipping test environment, activities mocked
│   └── tools.test.ts
└── evals/                    # promptfoo suite (planned, ADR-0009)
```

## Rules

- **Workflows are deterministic.** No network, clock, randomness or environment access in `workflows/`. Anything that touches the outside world is an activity. This is what lets Temporal replay a run after a crash. Workflow code imports only `@agents/agent-kit/workflow`, never the main `@agents/agent-kit` entry (which pulls in the AI SDK).
- **Models are called only through LiteLLM**, by alias (`fast`, `smart`), with the agent's own virtual key and budget. Agents never hold cloud credentials ([ADR-0005](../docs/adr/0005-llm-gateway-litellm.md)).
- **Temporal owns retries.** Model calls set `maxRetries: 0` (`MODEL_CALL`) and run inside `withHeartbeat`; activity errors go through `toActivityFailure` so guardrail blocks and budget errors aren't retried.
- **Invalid input fails the run** with `ApplicationFailure.nonRetryable`. Any other error thrown by workflow code makes Temporal retry the workflow task forever.
- **Tools are allow-listed** in `agent.config.ts`. Decisions that need a person use the `ReviewGate` from agent-kit (a Temporal update the caller gets an answer to).
- **Each agent has its own task queue.** That lets any agent move to its own Kubernetes Deployment later by changing manifests only.
- **Evals live with the agent** and gate pull requests ([ADR-0009](../docs/adr/0009-evals-promptfoo.md)).

## Adding an agent

1. Copy [`general/research-summarize/`](general/research-summarize/) to `agents/<industry>/<agent-name>/`, add it to the industry's README, rename the package, and change `agent.config.ts` (name, task queue, `LITELLM_KEY_<AGENT>` variable, tools, limits).
2. Add its folder to the root [`tsconfig.json`](../tsconfig.json) references, add it as a dependency of `apps/worker`, and list it in [`apps/worker/src/agents.ts`](../apps/worker/src/agents.ts).
3. Give it a budget in `AGENT_BUDGETS_USD` in [`scripts/lib/k8s.sh`](../scripts/lib/k8s.sh); the apply scripts create its LiteLLM key.
4. `pnpm install && pnpm test`, then `scripts/local/apply-k8s.sh`.
