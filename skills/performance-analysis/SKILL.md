---
name: performance-analysis
version: 1.1.0
description: "Performance analysis, bottleneck detection, and optimisation for Claude Flow swarms. Use when profiling swarm performance, diagnosing slow agents, or tuning topology and resource allocation."
category: monitoring
tags: [performance, bottleneck, optimisation, profiling, metrics, analysis]
author: Claude Flow Team
---

# Performance Analysis Skill

Identify bottlenecks, profile swarm operations, generate performance reports, and
apply optimisation recommendations for Claude Flow swarms.

## When To Use
- Profiling swarm performance or diagnosing slow agents
- Detecting communication / processing / memory / network bottlenecks
- Generating performance reports (json/html/markdown) for review or CI/CD
- Tuning topology, concurrency, caching, and resource allocation

## When Not To Use
- CUDA GPU kernel profiling → use the **cuda** skill
- Full dev pipelines with quality gates and testing → use **build-with-quality**
- Truth scoring and automatic rollback of bad changes → use **verification-quality**
- General swarm orchestration without a performance focus → use **swarm-advanced**
- AgentDB vector-search performance tuning → use **agentdb-vector-search**

Claude Code only: the `mcp__claude-flow__*` tool call below needs the
claude-flow MCP server registered (already wired in this container). On Codex
/ GPT-6 Astra: use the CLI form instead.

## Quick Start

Verified against the deployed CLI (`claude-flow performance --help` and
`claude-flow performance bottleneck --help`, ruflo v3.38.21) — there is no
top-level `bottleneck` or `analysis` command; both live under `performance`:

```bash
# Detect bottlenecks in the current swarm (quick pass; -d full for deep analysis)
claude-flow performance bottleneck -d full

# View/export metrics (there is no `analysis performance-report`; use metrics)
claude-flow performance metrics -t 24h -f prometheus

# Run optimisation recommendations and apply them
claude-flow performance optimize --apply
```

From Claude Code (MCP):
```javascript
mcp__claude-flow__bottleneck_analyze({ timeRange: "1h", threshold: 20, autoFix: false })
```

## Core Capabilities
1. **Bottleneck detection** — communication, processing, memory, and network,
   with real-time profiling and severity-ranked output.
2. **Report generation** — executive summary, metrics, bottleneck analysis, and
   prioritized recommendations in json/html/markdown.
3. **Optimisation** — `--fix` applies topology, caching, concurrency, priority,
   and resource optimisations; review before applying.

## References
Load these on demand for the full detail:

- [`references/bottleneck-detection.md`](references/bottleneck-detection.md) —
  `performance bottleneck` options, the metric taxonomy, output format, common
  patterns, and MCP integration (JSON result shapes).
- [`references/reporting.md`](references/reporting.md) —
  `performance metrics` formats, sections, examples, and a sample report.
- [`references/optimisation-and-operations.md`](references/optimisation-and-operations.md) —
  `performance optimize` catalog, expected performance impact, continuous monitoring, CI/CD
  integration, custom scripts, best practices, and troubleshooting recipes.

## Related
Verified against `claude-flow --help` (ruflo v3.38.21) — `swarm monitor`,
`token`, and `cache` are not real top-level or subcommands in this build:
- `claude-flow performance metrics` — real-time and historical metrics (no `swarm monitor` exists)
- `claude-flow agent metrics` — agent performance metrics
- `claude-flow performance benchmark` — benchmark suites (wasm/neural/memory/search)
- [swarm-advanced](../swarm-advanced/SKILL.md) · [agentdb-memory-patterns](../agentdb-memory-patterns/SKILL.md)

---

**Version**: 1.1.0 · **Last Updated**: 2026-07-28 · **Maintainer**: Claude Flow Team
