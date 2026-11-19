# Technology agents

Agents for software and IT organizations: engineering, operations, support and security work. Typical fit for the platform: workflows that span several systems (tickets, repositories, cloud consoles), changes proposed as pull requests for review, and runs that must survive failures partway through.

Agents follow the [agent layout](../README.md#layout-of-an-agent), each with a `business-case.md` first. Selection and build order: [ADR-0019](../../docs/adr/0019-pattern-agent-portfolio.md). All agents use synthetic or public data, on repositories and clusters this project owns.

| Agent | Pattern | What it does | Tools ([ADR-0020](../../docs/adr/0020-mcp-tools-and-skills.md)) | Status |
|---|---|---|---|---|
| `cve-remediator` | Remediation by pull request | Finds a vulnerable dependency, upgrades it, runs the tests in a sandbox, opens a pull request with the evidence | GitHub MCP, OSV.dev, Trivy, custom `sandbox-runner` (throwaway pods under GKE Sandbox) | Planned, second to build |
| `finops-cost-sentinel` | Analysis and explanation | Explains cost changes, attributes spend, flags idle compute and GPU spend, proposes rightsizing behind an approval gate | MCP Toolbox for Databases (BigQuery billing export, FOCUS sample data), GitHub MCP | Planned, fourth |
| `incident-commander` | Monitor, diagnose, act | Correlates an alert with recent deploys and config changes, maps the blast radius, proposes a rollback a person approves, drafts the postmortem | Kubernetes, Prometheus and Grafana MCP servers; an open-source demo app with injected faults | Planned, last |
