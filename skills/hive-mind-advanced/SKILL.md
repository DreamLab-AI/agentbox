---
name: hive-mind-advanced
description: "Queen-led multi-agent coordination in Claude Flow — one strategic queen directs specialized workers through structured voting and shared persistent memory. Use when a task needs formal consensus (majority, weighted, or Byzantine fault tolerance) and cross-agent collective memory, not just topology-based swarming."
version: 1.0.0
category: coordination
tags: [hive-mind, swarm, queen-worker, consensus, collective-intelligence, multi-agent, coordination]
author: Claude Flow Team
---

# Hive Mind Advanced Skill

Queen-led hierarchical multi-agent coordination: a strategic queen coordinator
directs specialized worker agents through collective decision-making
(majority / weighted / Byzantine consensus) and a shared, persistent collective
memory. This is the most structured coordination model in Claude Flow — reach for
it when decisions need formal voting and agents need to share knowledge across a
session.

## Quick path

```bash
# 1. Initialize
npx claude-flow hive-mind init

# 2. Spawn a swarm against an objective (pick a queen type + consensus)
npx claude-flow hive-mind spawn "Build microservices architecture" \
  --queen-type strategic --max-workers 8 --consensus weighted --claude

# 3. Monitor
npx claude-flow hive-mind status
npx claude-flow hive-mind metrics
npx claude-flow hive-mind memory
```

Queen types: `strategic` (research/planning), `tactical` (implementation),
`adaptive` (optimisation/dynamic). Consensus: `majority`, `weighted` (queen 3x),
`byzantine` (2/3 supermajority). Memory persists to RuVector PostgreSQL
(pgvector/HNSW) in production, SQLite locally.

## When to use

Use the Hive Mind when the work genuinely needs:
- **Formal consensus** on critical decisions (architecture choice, tech stack,
  release readiness) — not just parallel task execution.
- **Collective memory** shared across agents and resumable sessions.
- **Queen-led hierarchy** — a coordinator that decomposes objectives and assigns
  specialized workers (researcher, coder, analyst, tester, architect, reviewer,
  optimizer, documenter).

## When not to use

- Topology-based agent coordination (mesh, hierarchical, star, ring) **without**
  formal voting → `swarm-advanced` is simpler.
- A structured development lifecycle (spec, architecture, TDD, review, deploy)
  → `sparc-methodology` (17 development modes).
- Full development + quality-engineering pipelines → `build-with-quality`.
- Cloud-based swarm deployment / workflow automation → `flow-nexus-swarm`.
- GitHub-specific PR review coordination → `github-code-review`.

## Reference material

Detailed guidance lives in `references/` — load the file for the task at hand:

- **[references/architecture.md](references/architecture.md)** — architecture
  patterns, worker specialization, collective memory system, RuVector PostgreSQL
  backend, consensus mechanisms.
- **[references/operations.md](references/operations.md)** — init / spawn /
  monitor commands, session management, consensus building, collective-memory
  operations, task distribution, auto-scaling, and integration with Claude Code /
  SPARC / GitHub.
- **[references/performance-and-config.md](references/performance-and-config.md)** —
  memory & database optimisation, benchmarks, hive/memory config schemas, hooks
  integration, and best practices per queen type.
- **[references/api-and-cookbook.md](references/api-and-cookbook.md)** —
  troubleshooting (memory / performance / consensus), advanced topics (custom
  workers, neural training, multi-hive, export/import), the `HiveMindCore` /
  `CollectiveMemory` / `HiveMindSessionManager` API reference, worked examples,
  and skill progression.

## Related skills

- `swarm-advanced` — general swarm coordination (no consensus required)
- `consensus-mechanisms` — distributed decision making
- `memory-systems` — advanced memory management
- `sparc-methodology` — structured development workflow
- `github-code-review` — repository PR review and coordination

---

**Skill Version**: 1.0.0
**Last Updated**: 2026-07-28
**Maintained By**: Claude Flow Team
**License**: MIT
