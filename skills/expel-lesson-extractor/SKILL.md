---
name: expel-lesson-extractor
description: >
  Post-task experiential learning. After each completed task with an
  observable terminal outcome (success or explicit failure), distil 0-N
  generalisable lessons from the trajectory + ExecutionTraces and store
  them in RuVector namespace `code-harness-lessons` as ex:DistilledLesson
  records (memory_type=semantic, durable). Lessons are surfaced at task
  start by the skill-router for similar scopes. Confidence decremented on
  contradiction (LLM-judge sampled 1/10 retrievals, floor 0.3, archive
  below). Privacy filter applied to all trace evidence before write
  (per ADR-008 + ADR-019).
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

## OWL2 Ontology Classification

| Field | Value |
|---|---|
| OWL2 class | `ex:DistilledLesson` (subClassOf `ex:Memory`) |
| `memory_type` | `semantic` |
| TTL | none (durable — no expiry) |
| RuVector namespace | `code-harness-lessons` |
| `source_type` (RuVector discriminator) | `ex:DistilledLesson` |

Ontology declaration: `agentbox/ontology/code-harness.ttl`.
Full namespace table: `docs/developer/code-harness-multi-tier-memory.md`.

The `source_type` field on every RuVector entry is the multi-tier discriminator:
it identifies the OWL2 class of the stored record without requiring any schema
change to the `memory_entries` table. Semantic search on `code-harness-lessons`
returns only `ex:DistilledLesson` records; episodic traces live in a separate
namespace and are never mixed into lesson retrieval.

---

## DistilledLesson Record Schema

Every lesson written to RuVector has the following structure (stored as JSON
in the `value` field; the `rule` field is the string embedded by MiniLM for
HNSW semantic search):

```json
{
  "lesson_urn": "urn:agentbox:memory:<scope>:lesson-<sha256-12>",
  "ontology_type": "ex:DistilledLesson",
  "memory_type": "semantic",
  "rule": "IF <scope-condition> THEN <action-rule>",
  "scope": "<task-type or skill-name or '*'>",
  "evidence_trajectory_id": "<traj-id>",
  "evidence_traces": ["urn:agentbox:memory:<scope>:trace-<sha256-12>", "..."],
  "confidence": 0.7,
  "active": true,
  "version": 1,
  "source_agent": "<agent-session-id>",
  "created_at": "<ISO-8601>",
  "contradiction_count": 0
}
```

### Field definitions

| Field | Type | Constraints |
|---|---|---|
| `lesson_urn` | string | ADR-013 grammar: `urn:agentbox:memory:<scope>:lesson-<sha256-12>`. Minted via `management-api/lib/uris.js`. |
| `ontology_type` | string | Always `"ex:DistilledLesson"` — the multi-tier discriminator. |
| `memory_type` | string | Always `"semantic"` — signals durable, no-TTL storage tier. |
| `rule` | string | The generalisable rule in IF/THEN plain English. Max 200 characters. This is the value embedded by RuVector for HNSW semantic search. |
| `scope` | string | Task type or skill name this rule applies to, e.g. `"codeact"`, `"data-pipeline"`, `"cf-d1-pagination"`, `"*"`. |
| `evidence_trajectory_id` | string | Trajectory ID this lesson was extracted from. |
| `evidence_traces` | list[string] | At least one `trace_urn` referencing an `ex:ExecutionTrace` record that supports the rule. Required per PRD-008 §8 (lessons without grounding evidence are discarded). |
| `confidence` | float [0, 1] | Initial value ≥ `[features.expel_lesson_extraction].min_confidence` (default 0.6). |
| `active` | bool | False when confidence drops below `confidence_floor` (default 0.3); soft-deleted but retained for audit. |
| `version` | int | Incremented on contradiction-triggered update. |
| `source_agent` | string | Agent session ID (did:nostr pubkey + short session token). |
| `created_at` | string | ISO 8601 UTC timestamp. |
| `contradiction_count` | int | Times a subsequent trace has contradicted this lesson. |

### RuVector write call pattern

```python
# value must be the rule text (embedded for HNSW) + full JSON as a single
# plain-text string that encodes both the semantic hook and the structured record
value = f"{record['rule']} | " + json.dumps(record)

mcp__ruvector__memory_store(
    namespace="code-harness-lessons",
    key=f"lesson:{scope}:{short_uuid}",
    value=value,
    # source_type is the OWL2 class IRI — the multi-tier discriminator
    source_type="ex:DistilledLesson",
    upsert=True,
)
```

---

## Extraction Prompt Template

The extraction prompt is deterministic and templated. It takes three inputs:

1. **task_summary** — one-paragraph description of what the task attempted.
2. **success** — boolean terminal outcome.
3. **tool_calls** — last 10 tool call entries from the trajectory (tool name +
   truncated stdout/stderr, privacy-filtered before passing to the prompt).

The prompt constrains the LLM to return only JSON matching the lesson schema,
which makes write-gate validation cheap (JSON schema check only, no semantic
judge).

```
SYSTEM: You are a post-task lesson extractor. Analyse the trajectory below and
emit 0-N generalisable rules in the form "IF <scope-condition> THEN
<action-rule>". Rules must be scope-specific (cite the task type or skill),
must reference a concrete observed outcome from the trajectory (stdout,
assertion result, test pass/fail), and must be concise (max 200 characters per
rule). Output a JSON list of objects with fields: rule, scope, evidence_claim
(one sentence citing the observed outcome). Output an empty list [] if no
generalisable rule can be grounded in the trajectory.

USER:
task_summary: {{task_summary}}
success: {{success}}
tool_calls:
{{tool_calls_json}}
```

The agent runtime calls `mcp/expel/distil.py` with the trajectory data;
`distil.py` formats this prompt, calls the LLM, validates the JSON response,
applies privacy filtering, and writes the lessons.

---

## Write Gate

Before any lesson is written, the following checks must pass in order:

1. **Trajectory length gate**: `len(trace_urns) >= 3`. Fewer than 3 traces
   → no lesson stored (PRD-008 C4). Exit cleanly.
2. **Privacy filter gate**: Pass the trajectory evidence through
   `PrivacyFilterPort` (ADR-008). If the filter is unavailable, **drop the
   lesson** and emit `LessonRedactionFailed` event. Never write unfiltered
   evidence to RuVector.
3. **LLM extraction gate**: Call the extraction prompt. If the LLM returns
   an empty list `[]`, no lesson is stored. This is a normal outcome for
   trajectories with no generalisable signal.
4. **Evidence grounding gate**: Each extracted lesson must have a non-empty
   `evidence_traces` list containing at least one real trace URN. Lessons
   without grounded evidence are discarded (not stored).
5. **Confidence gate**: Discard lessons where initial confidence would be
   below `[features.expel_lesson_extraction].min_confidence` (default 0.6).
6. **Volume cap**: At most `[features.expel_lesson_extraction].max_lessons_per_task`
   (default 5) lessons are written per trajectory invocation. Excess lessons
   are discarded by rank (lowest-confidence first).

All checks run before any write to RuVector. There is no partial write.

---

## Retrieval at Task Start

The skill-router and `codeact` SKILL.md both include a pre-task step. Agents
implementing this skill must run the following search at task start before
the main task prompt:

```python
results = mcp__ruvector__memory_search(
    query=task_keywords,  # Derived from task description
    namespace="code-harness-lessons",
    limit=5,
)
# Filter to active=True lessons only (inactive lessons have confidence < floor)
active = [r for r in results if '"active": true' in r.get("value", "")]
```

Inject retrieved lessons into the agent context as a **"Prior experience:"
block** before the main task prompt. Budget: ≤ 400 tokens total for this
block. If retrieved content exceeds the budget, truncate at natural lesson
record boundaries (never mid-record).

```
Prior experience (from code-harness-lessons):
1. [scope: cf-d1-pagination, confidence: 0.8]
   IF Cloudflare D1 paginated query THEN cursor on rowid not LIMIT/OFFSET
2. [scope: kernel-timeout, confidence: 0.7]
   IF data load >25 min THEN chunk into kernel.exec calls every 10 min
...
```

---

## Contradiction Detection

Contradiction detection runs **sampled** (1 in 10 retrievals) to bound cost,
per ADR-019 §Contradiction detection.

When a `DistilledLesson` is retrieved at task start AND the sample check
fires AND the current trajectory completes:

1. Call the LLM judge with the lesson's `rule` and the trajectory's
   observable outcomes (privacy-filtered).
2. Judge answers: "Does this trajectory's outcome contradict the rule?
   Answer JSON: {\"contradicts\": bool, \"reason\": string}".
3. If `contradicts: true`: decrement `confidence -= 0.1`;
   increment `contradiction_count`. Update the lesson record via
   `mcp__ruvector__memory_store` with `upsert=true`.
4. If `confidence < [features.expel_lesson_extraction].confidence_floor`
   (default 0.3): set `active = false`, move to `code-harness-lessons-archive`
   namespace via a compensating `memory_store` + note in the original record.

Conflict ranking at retrieval time: when multiple active lessons conflict,
rank by `confidence × recency_weight` where
`recency_weight = exp(-days_old / 30)`. Apply the top-ranked lesson; include
lower-ranked conflicting lessons as "alternative views" in the context block.

---

## Archive Policy

| Condition | Action |
|---|---|
| `active = false` AND older than `[features.expel_lesson_extraction].archive_after_days` (default 30) | Move to `code-harness-lessons-archive`; retain original for audit |
| `contradiction_count >= 5` AND `confidence >= floor` | Flag for manual review; do not auto-archive |
| Lesson references a `VerifiedSkill` URN that no longer resolves | Flag as stale; decrement confidence by 0.05 |

Archive is a compensating write (store to archive namespace, mark original
`active=false`). RuVector MCP does not support delete; the original record is
retained with `active=false` to preserve audit trail.

---

## Manifest Gates

```toml
[features.expel_lesson_extraction]
enabled              = false  # set true to activate post-task lesson extraction
max_lessons_per_task = 5      # cap on lessons extracted per trajectory; prevents noise flood
min_confidence       = 0.6    # minimum confidence to store a lesson
confidence_floor     = 0.3    # lessons below this floor are auto-demoted to archive namespace
archive_after_days   = 30     # demote suppressed lessons to archive after this many days
```

Validator rules:
- `W043`: `features.expel_lesson_extraction.enabled = true` without
  `skills.code_interpreter.enabled = true` is accepted (lesson distillation
  does not require a KernelSession) but noted — lesson quality for code tasks
  is lower without ExecutionTrace grounding.
- `E044`: if `skills.voyager_skill_library.enabled = true`, then
  `skills.code_interpreter.enabled = true` is also required (Voyager's
  VerificationGate needs a KernelSession).

---

## Hook Registration

The lesson extractor is invoked via the post-task hook mechanism defined in
`/home/devuser/.claude/CLAUDE.md` §Auto-Learning Protocol. The hook calls
`python3 mcp/expel/distil.py` with the following arguments:

```bash
python3 /opt/agentbox/mcp/expel/distil.py \
  --trajectory-id "$TASK_ID" \
  --outcome "$TASK_SUCCESS" \
  --trace-urns "$TRACE_URNS_COMMA_SEPARATED"
```

The hook fires only when `[features.expel_lesson_extraction].enabled = true`.
The `distil.py` script exits 0 on success (lessons written or cleanly skipped),
exits 1 on unrecoverable error (LessonRedactionFailed, write failure).

---

## Implementation Notes

- The implementation lives at `mcp/expel/distil.py`. See that file for the
  full handler including privacy-filter integration, LLM call, and RuVector
  write logic.
- Lessons are written to RuVector using `mcp__ruvector__memory_store` only.
  Never use raw SQL. Never use `claude-flow memory *` CLI commands. Both
  bypass the MiniLM embedding pipeline and produce entries invisible to HNSW
  semantic search (ADR-015 mandate).
- The `value` field passed to `memory_store` must be plain-text with the
  `rule` field appearing first (it is the primary semantic signal for
  embedding). The full JSON record is appended after a ` | ` separator so
  that the structured fields are retrievable on exact key lookup.
- URNs are minted via `management-api/lib/uris.js`. Never construct URNs with
  ad-hoc string formatting in application code.

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
