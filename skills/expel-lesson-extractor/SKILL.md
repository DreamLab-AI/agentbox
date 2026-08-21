---
name: expel-lesson-extractor
description: >
  Fires as a post-task hook after a non-trivial completed task (3+ tool calls,
  observable terminal outcome) to distil 0-N generalisable IF/THEN lessons from
  the trajectory and store them in RuVector so they surface at the start of
  similar future tasks; also invocable manually to record a lesson after a
  complex or failed task. NOT for trivial (<3 tool calls) or interrupted tasks,
  and NOT a general memory-write tool — it writes only ex:DistilledLesson
  records to the code-harness-lessons namespace. Schema, gates, prompt, and
  contradiction/archive policy live in references/.
version: 0.1.0
related_skills:
  - codeact
  - voyager-skill-library
  - agentdb-memory-patterns
depends_on_mcps:
  - code-interpreter  # for ExecutionTrace evidence
---

# ExpeL Lesson Extractor

**Status: Phase 1 — active (ExpeL, build cost S, no kernel dependency for lesson
storage; kernel improves evidence quality but is not required).**

See: ADR-019 §Mechanism 1, PRD-008 §3.4 / §7 Track B, DDD-005 §DistilledLesson.
Multi-tier memory table: `docs/developer/code-harness-multi-tier-memory.md`.

---

## When to Use

Invoke automatically via `claude-flow hooks post-task` when
`[features.expel_lesson_extraction].enabled = true`. Do not invoke manually
for trivial one-liner tasks. The minimum threshold is tasks with **3 or more
tool calls** — below this the trajectory contains too little signal for
generalisation (PRD-008 §7 C4).

May also be invoked manually after a complex or failed task where the agent
wishes to record a specific lesson explicitly, bypassing the automatic
invocation threshold.

## When NOT to Use

- Tasks with fewer than 3 tool calls (trivial-task filter; no lesson stored).
- Tasks that were interrupted mid-trajectory (ExpeL distillation only runs
  on tasks with an observable terminal outcome — success or explicit failure).
- Contexts where `[features.expel_lesson_extraction].enabled = false`.
- When the privacy filter (PrivacyFilterPort, ADR-008) is unreachable — the
  lesson is **dropped**, not written without redaction. Fail-closed is the
  contract. Emit `LessonRedactionFailed` event and return.

---

## Mechanism at a glance

Post-task, the runtime calls `mcp/expel/distil.py` with the trajectory. It
privacy-filters the evidence, runs a templated extraction prompt to emit 0-N
IF/THEN rules, validates them against a write gate, and writes surviving
lessons to the `code-harness-lessons` RuVector namespace as
`ex:DistilledLesson` records. At the start of similar future tasks the lessons
are retrieved semantically and injected as a "Prior experience:" block.
Contradictions decay confidence over time and demote stale lessons to an
archive namespace.

All RuVector access is via `mcp__claude-flow__memory_*` only — never raw SQL,
never the `claude-flow memory *` CLI (both bypass the bge-small-en-v1.5
(384-dim, via Xinference) embedding pipeline and are invisible to HNSW search,
ADR-015).

---

## Reference index (load on demand)

| Topic | File |
|---|---|
| OWL2 classification, record schema, field definitions, write call pattern | [references/record-schema.md](references/record-schema.md) |
| Extraction prompt template and inputs | [references/extraction-prompt.md](references/extraction-prompt.md) |
| Write-gate steps and task-start retrieval/injection | [references/write-gate-and-retrieval.md](references/write-gate-and-retrieval.md) |
| Contradiction detection, conflict ranking, archive policy | [references/contradiction-and-archive.md](references/contradiction-and-archive.md) |
| Manifest gates, validator rules, hook registration, implementation notes | [references/manifest-and-hooks.md](references/manifest-and-hooks.md) |

---

## Related Files

- `mcp/expel/distil.py` — post-task handler implementation.
- `skills/voyager-skill-library/SKILL.md` — Phase 2 verified skill library.
- `skills/agentdb-memory-patterns/SKILL.md` — memory_type discriminator details.
- `ontology/code-harness.ttl` — OWL2 class declarations.
- `docs/developer/code-harness-multi-tier-memory.md` — namespace / class table.
- `docs/reference/adr/ADR-019-experiential-skill-learning.md` — canonical decision.
- `docs/reference/prd/PRD-008-code-as-harness-integration.md` §3.4 / §7 Track B.
- `docs/reference/ddd/DDD-005-code-execution-domain.md` §DistilledLesson aggregate.
- `tests/code-harness/lesson-retrieval-queries.json` — C3 acceptance test fixture.
