# General agents

Industry-neutral agents. They prove the platform end to end (durable runs, governed model calls, tool allow-lists, human review) on public data, and serve as the starting point for new agents.

| Agent | What it does | Status |
|---|---|---|
| [research-summarize](research-summarize/) | Answers a question from Wikipedia with a cited summary, revised on reviewer feedback until approved | Built; runs on k3d |
| [invoice-exception-resolver](invoice-exception-resolver/) | Works three-way-match exceptions: evidence, cited proposal, vendor follow-up, approval before anything changes what is paid. Template for the MCP-and-skills agents ([ADR-0019](../../docs/adr/0019-pattern-agent-portfolio.md)) | Designed; next to build |
| `audit-evidence-collector` | Collects IT general controls evidence (access reviews, change approvals, deploy records), tests it against control rules, assembles an audit packet | Planned |

To start a new agent in any industry, copy `research-summarize/` ([steps](../README.md#adding-an-agent)).
