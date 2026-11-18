# General agents

Industry-neutral agents. They prove the platform end to end (durable runs, governed model calls, tool allow-lists, human review) on public data, and serve as the starting point for new agents.

| Agent | What it does | Status |
|---|---|---|
| [research-summarize](research-summarize/) | Answers a question from Wikipedia with a cited summary, revised on reviewer feedback until approved | Built; runs on k3d |

To start a new agent in any industry, copy `research-summarize/` ([steps](../README.md#adding-an-agent)).
