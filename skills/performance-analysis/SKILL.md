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

## Quick Start

```bash
# Detect bottlenecks in the current swarm
npx claude-flow bottleneck detect

# Generate an HTML report with full metrics
npx claude-flow analysis performance-report --format html --include-metrics

# Detect and auto-apply fixes at a tighter threshold
npx claude-flow bottleneck detect --fix --threshold 15
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
  `bottleneck detect` options, the metric taxonomy, output format, common
  patterns, and MCP integration (JSON result shapes).
- [`references/reporting.md`](references/reporting.md) —
  `analysis performance-report` formats, sections, examples, and a sample report.
- [`references/optimisation-and-operations.md`](references/optimisation-and-operations.md) —
  `--fix` catalog, expected performance impact, continuous monitoring, CI/CD
  integration, custom scripts, best practices, and troubleshooting recipes.

## Related
- `npx claude-flow swarm monitor` — real-time monitoring
- `npx claude-flow token usage` — token optimisation analysis
- `npx claude-flow cache manage` — cache optimisation
- `npx claude-flow agent metrics` — agent performance metrics
- [Swarm Monitoring](../swarm-orchestration/SKILL.md) · [Memory Management](../memory-management/SKILL.md)

---

**Version**: 1.1.0 · **Last Updated**: 2026-07-28 · **Maintainer**: Claude Flow Team
