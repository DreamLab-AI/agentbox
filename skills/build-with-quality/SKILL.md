---
name: build-with-quality
description: "Implement features with tests and quality gates, debug hard bugs, and stress-test designs. Use when building a feature with TDD/EDD, chasing a stubborn multi-function bug (feedback-loop-first), interrogating a design before coding, or running a coverage/security/accessibility quality-gate pass. Supersedes agentic-qe, reasoningbank-*, and pair-programming."
license: MIT
metadata:
  version: 1.2.0
  author: Claude Flow
  tags: [meta-skill, development, qa, edd, tdd, bdd, adr, ddd, agents, quality-gates, evidence, sona, hnsw, coverage, security, accessibility, chaos-testing]
  mcp_server: false
  supersedes: [agentic-qe, reasoningbank-intelligence, reasoningbank-agentdb, pair-programming]
---

# Build with Quality — Unified Meta-Skill

A development + quality-engineering meta-skill: implement features with EDD/TDD,
debug hard bugs feedback-loop-first, stress-test designs before coding, and run a
coverage/security/accessibility/chaos quality-gate pipeline. Combines
[Claude Flow V3](https://github.com/ruvnet/claude-flow/tree/main/v3) with
[Agentic QE](https://github.com/proffesor-for-testing/agentic-qe) — one cohesive
system in place of several specialized skills.

## Pointers (progressive disclosure)

- **Activation prompt (start here):** [BUILD-WITH-QUALITY-PROMPT.md](./BUILD-WITH-QUALITY-PROMPT.md) — copy-paste to spin up.
- **Worked examples:** [USAGE-EXAMPLES.md](./USAGE-EXAMPLES.md) — 5 complete project examples.
- **EDD loop:** [EDD-PROTOCOL.md](./EDD-PROTOCOL.md) — Expectation-Driven Development, evidence categories, anti-fox separation.
- **Debugging:** [DEBUGGING-PROTOCOL.md](./DEBUGGING-PROTOCOL.md) — feedback-loop-first protocol, design interrogation, **Diagram-Driven Diagnosis** (complex multi-function bug / suspected parallel implementations), and **Reasoning Without a Runtime (Static-Oracle Mode)** (implementing from a spec or restoring a stub with no shell/compiler/test runner).
- **Agents catalog:** [references/agents.md](./references/agents.md) — 114+ agents by domain.
- **Methodologies:** [references/methodologies.md](./references/methodologies.md) — DDD, ADR (+ ruflo ADR tooling), TDD.
- **Quality gates & workflow:** [references/quality-gates-and-workflow.md](./references/quality-gates-and-workflow.md) — gate thresholds and the 5-phase flow.
- **Architecture:** [references/architecture.md](./references/architecture.md) — learning system, memory, model routing, consensus, MCP/CLI execution, config.
- **BHIL traceability:** [references/bhil-traceability.md](./references/bhil-traceability.md) — PRD→SPEC→ADR→TASK artifact chain, AI-native ADR types, eval/guardrail specs.
- **Migration:** [references/migration.md](./references/migration.md) — moving off agentic-qe / reasoningbank-* / pair-programming.
- **Empirical tuning:** to optimize any part of this skill against a measurable reward rather than by intuition, use the `skill-tuning` skill (SkillOpt loop + held-out A/B). The Static-Oracle Mode section was produced by that loop.

## When to use

- Implementing a feature that warrants tests and quality gates (TDD/EDD).
- Chasing a stubborn, multi-function bug — use the feedback-loop-first protocol.
- Interrogating a design before writing code.
- Running a coverage / security / accessibility / chaos quality-gate pass.

## When not to use

- A quick code change that does not need quality gates or swarm coordination — edit files directly with Claude Code.
- GitHub-specific PR review without the full quality pipeline — use `github-code-review`.
- Standalone documentation validation and alignment — use `docs-alignment`.
- SPARC methodology orchestration without quality-engineering agents — use `sparc-methodology`.
- Simple unit test generation without the full agent system — write tests directly or use the TDD workflow in `sparc-methodology`.

## Quick start

**Option 1 — Copy-paste prompt (recommended).** Take the prompt from
[BUILD-WITH-QUALITY-PROMPT.md](./BUILD-WITH-QUALITY-PROMPT.md) and fill in:
```markdown
Build with Quality skill.
Project: [NAME] | Stack: [TECH] | Task: [DESCRIPTION]
Methodology: DDD + ADR + TDD (EDD design-time first)
Quality: 85% coverage, security scan, WCAG AA
```

**Option 2 — CLI.**
```bash
claude-flow skill build-with-quality "implement user authentication with JWT"
# or, lower level:
npx claude-flow@alpha swarm init --topology hierarchical-mesh --strategy specialized
npx claude-flow@alpha agent spawn --type architect
npx claude-flow@alpha agent spawn --type coder
npx claude-flow@alpha agent spawn --type test-strategist
npx claude-flow@alpha task create --type "implementation" --quality-gates true
```

**Option 3 — MCP tools (when available).**
```javascript
mcp__claude-flow__swarm_init { topology: "hierarchical-mesh", maxAgents: 100, strategy: "specialized" }
mcp__claude-flow__agent_spawn { type: "architect" }
mcp__claude-flow__agent_spawn { type: "coder" }
mcp__claude-flow__agent_spawn { type: "test-strategist" }
mcp__claude-flow__task_orchestrate { task: "[PROJECT]", strategy: "parallel" }
```

**Option 4 — Task tool (Claude Code).** TinyDancer routes the model optimally:
```javascript
Task({ prompt: "Implement user authentication with JWT, following TDD", subagent_type: "coder", model: "sonnet" })
Task({ prompt: "Generate tests for auth module with 95% coverage", subagent_type: "tester", model: "haiku" })
```

MCP is preferred when `mcp__claude-flow__*` tools are available; otherwise fall back
to the `npx claude-flow@alpha` CLI. See
[references/architecture.md](./references/architecture.md) for the detection logic
and the per-agent coordination hooks.

## Methodology at a glance

- **EDD** — the design-time conversation layer between human intent and AI
  implementation. Captures qualitative expectations, ordering invariants, systemic
  properties, and explicit counter-examples ("must NOT happen") that TDD assertions
  and BDD templates can't. 7-step loop: formulate → implement → produce evidence →
  audit → challenge → iterate → stabilize. Executed evidence required (command, raw
  output, timestamp, git SHA); narrative evidence is auto-rejected. `evidence-producer`
  and `evidence-auditor` must be different agents on different model families. Full
  playbook: [EDD-PROTOCOL.md](./EDD-PROTOCOL.md). EDD runs **before** TDD/BDD, then
  hands proven scenarios off to them for permanent regression coverage — it does not
  replace them.
- **DDD / ADR / TDD** — bounded contexts and tactical patterns; graph-backed ADRs
  with `depends_on`/`amends`/`supersedes`; Red-Green-Refactor with TDD agents that
  also stabilize proven EDD expectations into tests. See
  [references/methodologies.md](./references/methodologies.md).

## Related skills (complementary)

These work **alongside** build-with-quality:
- `sparc-methodology` — higher-level orchestration framework
- `swarm-orchestration` / `swarm-advanced` — lower-level swarm primitives
- `verification-quality` — truth scoring and rollback
- `github-*` — GitHub-specific integrations
- `hive-mind-advanced` — specialized Byzantine consensus features

## License

MIT
