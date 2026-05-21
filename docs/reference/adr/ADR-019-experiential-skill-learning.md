# ADR-019: Experiential skill learning — distilled lessons and verified skill library

**Status:** Draft
**Date:** 2026-05-20
**Author:** Agentbox team
**Supersedes:** n/a
**Related:** ADR-005 (Pluggable adapters), ADR-015 (MCP RuVector mandate), ADR-018 (Persistent code-interpreter MCP), PRD-008 (Code-as-harness integration), DDD-005 (Code-execution domain)

---

## TL;DR for newcomers

*Skip if you already know the distinction between storing task outcomes and distilling lessons from them.*

Agentbox's `hooks post-task --store-results true` already writes a record to RuVector when a task completes. That is necessary but not sufficient. A raw outcome record ("task X failed with error Y") tells the next agent what happened; it does not tell it what general rule to apply in future tasks of the same class. ExpeL (arxiv:2308.10144) demonstrates that agents improve continuously across task repetitions — without any parameter updates — by distilling trajectory-level lessons ("always validate the schema before writing to the adapter", "use `kernel.list_vars()` after a large data load to confirm the DataFrame landed") into a queryable natural-language insight store. Separately, Voyager (arxiv:2305.16291) shows that a growing library of verified executable skill functions — retrieved by semantic similarity at task start and composed to solve new sub-problems — produces 3.3× more unique task completions and 15.3× faster milestone achievement versus baselines. Both patterns write to RuVector under typed namespaces. Both gate writes on execution-grounded verification rather than LLM-judge confidence alone.

**If you remember only one thing:** hooks-post-task records what happened; ExpeL distils why it matters; Voyager builds a library of reusable code that has actually been proven to run.

---

## Context

### What hooks-post-task already does

`claude-flow hooks post-task --task-id <id> --success <bool> --store-results true` writes a record to the `patterns` namespace in RuVector with the task ID, success flag, summary, and (optionally) the trajectory. This is the foundation. The gap is what happens next.

### What it does not do

1. **Cross-run generalisation.** Individual outcome records do not accumulate into queryable rules. The next agent running a similar task receives no automatic briefing from the prior agent's experience unless it happens to land on the same key via semantic search — and the value it finds is an outcome record, not a distilled lesson with a generalisable rule and scope annotation.

2. **Executable skill primitives.** The `patterns` namespace stores natural-language patterns. There is no concept of a stored, versioned, verified Python function that an agent can retrieve and execute as a sub-routine without re-implementing it. `sparc:memory-manager` stores task plans but not executable code with assertions.

3. **Write-gate verification.** Any agent can write to the `patterns` namespace. There is no verification gate that checks whether the stored pattern actually improves task outcomes before accepting it.

### Why this matters now

With the persistent code-interpreter MCP (ADR-018) live, we can for the first time verify candidate skills by execution — run the function's assertions through the kernel MCP server and confirm they pass — rather than relying on an LLM judge to assess plausibility. This is the unlock that makes a Voyager-style verified skill library practical in agentbox without a separate evaluation harness.

### Evidence for the two patterns

| Paper | Year | arXiv | Headline result | Mechanism |
|---|---|---|---|---|
| ExpeL: LLM Agents Are Experiential Learners | 2023 | 2308.10144 | Monotonic accuracy improvement across task repetitions; no fine-tuning required | Distils reusable lessons from past trajectories; retrieves relevant insights at task start via similarity search |
| Voyager: An Open-Ended Embodied Agent | 2023 | 2305.16291 | 3.3× unique items, 15.3× faster tech-tree milestones vs SOTA | Ever-growing executable skill library; iterative prompting with environment feedback; self-verification loop |

Both patterns are inference-time only. Neither requires training infrastructure. Both write to an external store (skills/insights), not to model weights.

---

## Decision

This ADR adopts two complementary mechanisms, phased to match build cost and dependency ordering.

### Mechanism 1: ExpeL lesson-extractor (Phase 1, build cost S)

A hook post-task wrapper and a thin SKILL.md that, after any task trajectory is recorded, submits a structured critique-extraction prompt to the agent and writes 0–N `DistilledLesson` records to the `code-harness-lessons` namespace in RuVector.

**Lesson record fields:**

| Field | Type | Description |
|---|---|---|
| `rule` | string | The generalisable rule in plain English; max 200 characters |
| `scope` | string | Task type or skill name this rule applies to (e.g. `"codeact"`, `"data-pipeline"`, `"*"`) |
| `evidence` | object | `{trajectory_id: string, observable_claim: string}` — what was observed that justified the rule |
| `confidence` | float 0–1 | Initial confidence; decremented on contradiction, incremented on corroboration |
| `source_agent` | string | Agent session ID that generated the lesson |
| `created_at` | ISO 8601 | Timestamp |
| `version` | int | Incremented when the record is updated in place |

The extraction prompt is a fixed template (shipped in `skills/expel-lesson-extractor/SKILL.md`). It takes the task summary, success flag, and the last 10 tool call entries from the trajectory as input, and produces a JSON array of lesson objects. The agent writes each non-empty result via `mcp__ruvector__memory_store` to namespace `code-harness-lessons`.

**Retrieval at task start.** The skill-router and `codeact` SKILL.md both include a pre-task step: `mcp__ruvector__memory_search(query="[task keywords]", namespace="code-harness-lessons", limit=5)`. Retrieved lessons are injected into the agent's context as a brief "prior experience" block before the main task prompt.

**Conflict resolution.** When multiple retrieved lessons conflict (e.g. one says "always reset the kernel before a data load", another says "preserve kernel state across loads for performance"), lessons are ranked by `confidence × recency_weight` where `recency_weight = exp(-days_old / 30)`. The top-ranked lesson is applied; lower-ranked conflicting lessons are noted as "alternative views" in the injected context block.

**Garbage collection.** A lesson's `confidence` is decremented by 0.1 each time a task that matched its `scope` completes and the agent explicitly notes the lesson did not apply or was incorrect (captured in the post-task critique prompt via a "lessons that misled me" field). When `confidence` drops below 0.2, the lesson is soft-deleted (marked `active: false`) but not removed from RuVector, to preserve the audit trail.

### Mechanism 2: Voyager verified skill library (Phase 2, build cost M, depends on ADR-018)

A skill plus `VerificationGate` that stores `VerifiedSkill` records containing executable Python functions in the `code-harness-skills` namespace in RuVector.

**Skill record fields:**

| Field | Type | Description |
|---|---|---|
| `name` | string | Snake-case function name; must be unique within the namespace |
| `signature` | string | Python function signature string, e.g. `"def normalise_dataframe(df: pd.DataFrame, cols: list) -> pd.DataFrame"` |
| `body_python` | string | Complete Python function body including imports; self-contained |
| `assertions` | list[string] | List of Python assertion statements that the function must satisfy; run via `kernel.exec` |
| `examples` | list[object] | At least one `{input_repr, expected_output_repr, description}` worked example |
| `verified_kernel_session` | string | Session ID of the kernel run that passed all assertions and examples |
| `verified_at` | ISO 8601 | Timestamp of successful verification |
| `scope` | string | Task domain(s) this skill applies to |
| `embed_text` | string | Plain-English description used for semantic embedding; this is the value RuVector embeds |
| `source_agent` | string | Agent that wrote the candidate |
| `usage_count` | int | Number of times retrieved and used; incremented post-task |
| `version` | int | Bumped when body is updated and re-verified |

**VerificationGate.** A candidate `VerifiedSkill` enters the `code-harness-skills` namespace only if all three conditions pass:

1. All assertions in `assertions` execute and pass via `kernel.exec` in a `KernelSession` (no exception, `assert` does not raise).
2. At least one entry in `examples` produces output matching `expected_output_repr` when the function is called with `input_repr`.
3. A static analysis pass (Python `ast.walk`) finds no direct BannedAPI calls — no `subprocess` calls, no socket creation, and no `os.system` / `os.popen` calls. Network calls are prohibited in v1 skills.

A candidate that fails any gate is logged to the `code-harness-skills-rejected` namespace with the failure reason, for auditing. The agent receives a structured failure response explaining which gate failed.

**Retrieval at task start.** `codeact`, `pytorch-ml`, and any skill that opts in includes a pre-task step: `mcp__ruvector__memory_search(query="[task description]", namespace="code-harness-skills", limit=3)`. Retrieved `VerifiedSkill` bodies are injected into context as available helper functions the agent may call directly via `kernel.exec` in its `KernelSession`.

**Multi-agent write ownership.** Any agent may submit a candidate `VerifiedSkill`. Provenance (source agent, session ID) is recorded in every skill record. There is no access-control gate on writes beyond the `VerificationGate` — the verification outcome is the trust signal, not agent identity.

---

## Architecture

### Lesson-extractor flow (Phase 1)

```
Task completes
    │
    ▼
claude-flow hooks post-task fires
    │
    ▼
expel-lesson-extractor hook calls the agent with:
    - task summary
    - success flag
    - last 10 tool calls from trajectory
    - extraction prompt template
    │
    ▼
Agent returns JSON array of lesson objects (may be empty)
    │
    ├── Empty array → done, no write
    │
    └── 1–N DistilledLesson records → for each:
            privacy filter (PrivacyFilterPort) applied first
            mcp__ruvector__memory_store(
                namespace="code-harness-lessons",
                key="lesson:<scope>:<uuid4_short>",
                value=<DistilledLesson JSON as plain-text for embedding>
            )
```

The extraction prompt is deterministic and templated; it is not a free-form generation request. The template constrains the agent to return only JSON matching the lesson schema, which reduces hallucination risk and makes write-gate validation cheap (JSON schema check only, no semantic judge).

### VerificationGate (Voyager) write-gate flow (Phase 2)

```
Agent proposes a candidate VerifiedSkill
    │
    ▼
VerificationGate (voyager-skill-library):
    │
    ├── Step 1: static AST scan (sandbox_check.py from ADR-018)
    │     BannedAPI detected → reject with "static-check-failed" reason
    │     NOTE: sandbox_check.py is a Phase 1 deliverable in ADR-018 §Implementation
    │     layout. Until shipped, all candidate-skill writes are blocked at this step.
    │
    ├── Step 2: kernel.exec(assertions joined with newlines) in KernelSession
    │     exception raised or assertion fails → reject with "assertion-failed" reason
    │
    ├── Step 2.5: validate verified_by URN
    │     memory_retrieve(verified_by URN) must return a real ExecutionTrace
    │     record younger than [skills.voyager_skill_library].max_evidence_age_s
    │     stale or missing → reject with "stale-evidence" reason
    │
    ├── Step 3: kernel.exec(example calls; compare repr output) in KernelSession
    │     mismatch → reject with "example-mismatch" reason
    │
    └── All pass →
            mcp__ruvector__memory_store(
                namespace="code-harness-skills",
                key="skill:<scope>:<name>:v<n>",   # n = monotonically incrementing version
                value=<embed_text — plain English description>
                # full record stored as structured JSON in value when parsed
            )
            # previous version (v<n-1>) retained; demoted to code-harness-skills-archive
            # after [skills.voyager_skill_library].archive_after_days
```

Note on embedding: `mcp__ruvector__memory_store` embeds the `value` string using MiniLM-L6-v2 (384-dim, same pipeline as all other RuVector writes). The `embed_text` field is crafted to be semantically rich so that similarity search on natural-language task descriptions lands on the right skill.

### Retrieval flow at task start

```
New task begins
    │
    ├── Search code-harness-lessons
    │     mcp__ruvector__memory_search(
    │         query="[task keywords]",
    │         namespace="code-harness-lessons",
    │         limit=5
    │     )
    │     → inject as "Prior experience:" block
    │
    └── Search code-harness-skills (if Phase 2 is live)
          mcp__ruvector__memory_search(
              query="[task description]",
              namespace="code-harness-skills",
              limit=3
          )
          → inject as "Available helper functions:" block
```

Both searches run in parallel. The injected context is bounded: lessons block ≤ 400 tokens, skills block ≤ 600 tokens (three function bodies). If the retrieved content exceeds this budget, it is truncated at natural boundaries (full lesson records, full function bodies) to avoid mid-record cuts.

### Privacy filter on RuVector write path

**Decision:** All `ExecutionTrace` evidence and `DistilledLesson` records are passed through the `PrivacyFilterPort` (ADR-008) before being written to RuVector. The filter applies the same PII / secret-pattern redaction policy as the audit-log export path. Redaction is mandatory, not configurable per-call — agents cannot opt out.

**Rationale:** Code executed by agents may contain secrets (API keys, credentials, paths to private files) in `stdout` or in variable representations. RuVector is a shared, multi-agent store; writing raw traces would create a data-leakage path. DDD-004 §L08 already requires privacy redaction before encoding for federation surfaces; this ADR aligns the lesson-distillation write path with that precedent.

**Failure mode:** If `PrivacyFilterPort` is unavailable at write time, the lesson is dropped (not written without redaction) and a `LessonRedactionFailed` event is emitted. Lesson distillation is best-effort by design — losing one lesson to a redaction outage is acceptable.

### Skill versioning

**Decision:** `VerifiedSkill` records are immutable. An updated skill is stored under a new URN `urn:agentbox:skill:<scope>:<name>:v<n>` where `<n>` monotonically increases. The previous version is retained (not deleted), but skill retrieval by name returns the highest-version record by default. Operators can pin a specific version via `?version=N` in the retrieval query.

**Garbage collection:** Skills below the highest version are demoted to a `code-harness-skills-archive` namespace after 30 days (manifest-gated by `[skills.voyager_skill_library].archive_after_days`).

### Contradiction detection

A new `ExecutionTrace` contradicts a `DistilledLesson` if (a) the lesson's `scope` (task-type or skill-name) matches the trajectory's, AND (b) the lesson's `rule` text contains an assertion that the trace falsifies. Falsification is detected by an LLM judge run at lesson-recall time (sampled 1/10 retrievals to bound cost). When detected, `confidence -= 0.1`; lessons below `[features.expel_lesson_extraction].confidence_floor` (default 0.3) are auto-demoted to the archive namespace.

### Namespace schema (RuVector)

Both namespaces are standard RuVector `memory_entries` rows. No schema migration is required. The structure is enforced at the application layer, not the database layer.

| Namespace | Key pattern | Value embedded for HNSW | Notes |
|---|---|---|---|
| `code-harness-lessons` | `lesson:<scope>:<short-uuid>` | The `rule` field (plain English) | `confidence` and `active` stored as JSON in value |
| `code-harness-skills` | `skill:<name>:<version>` | The `embed_text` field | Full record JSON inline in value; `body_python` is the authoritative source |
| `code-harness-skills-rejected` | `rejected:<name>:<timestamp>` | Rejection reason (plain English) | Audit trail only; never retrieved for task injection |

### Manifest gates

```toml
[features.expel_lesson_extraction]
enabled              = false  # set true to activate post-task lesson extraction
max_lessons_per_task = 5      # cap on lessons extracted per trajectory; prevents noise flood
min_confidence       = 0.6    # minimum confidence to store a lesson
confidence_floor     = 0.3    # lessons below this floor are auto-demoted to archive namespace
archive_after_days   = 30     # demote suppressed lessons to archive after this many days

[skills.voyager_skill_library]
enabled              = false  # set true; requires skills.code_interpreter.enabled = true
max_skill_body_lines = 80     # reject candidate skills exceeding this line count
archive_after_days   = 30     # demote superseded skill versions to archive namespace after N days
max_evidence_age_s   = 3600   # verified_by trace URN must reference a trace younger than this
```

Validator additions:

| Code | Condition |
|---|---|
| `E044` | `skills.voyager_skill_library.enabled = true` requires `skills.code_interpreter.enabled = true` (`VerificationGate` depends on `KernelSession` from kernel MCP) |
| `W043` | `features.expel_lesson_extraction.enabled = true` without `skills.code_interpreter.enabled = true` is accepted (`DistilledLesson` distillation does not require a `KernelSession`) but noted — lesson quality for code tasks is lower without `ExecutionTrace` grounding |

---

## Consequences

### Positive

- **Continuous improvement without fine-tuning.** ExpeL lessons accumulate across sessions and agent instances within the same RuVector namespace. A team of agents working on related tasks accrues shared experience that benefits every subsequent agent.
- **Executable skill reuse.** Voyager's verified function library eliminates the need for agents to re-implement well-worn helper functions (e.g. normalise a DataFrame, parse a TOML manifest, format a URN via `uris.js`). Retrieval is semantic; the agent does not need to know the function's name.
- **Execution-grounded verification.** The `VerificationGate` replaces LLM-judge confidence (which can be optimistic) with actual `ExecutionTrace` results from a live `KernelSession`. A `VerifiedSkill` candidate that claims to normalise a DataFrame but raises a `KeyError` on the example input is rejected before entering the library.
- **No new infrastructure.** Both mechanisms use only existing primitives: RuVector (ADR-015), hooks post-task, the kernel MCP (ADR-018), and `mcp__ruvector__memory_store/search`. There is no new server to operate.
- **Incremental rollout.** Phase 1 (ExpeL, build cost S) delivers value immediately without waiting for Phase 2 (Voyager, build cost M). Phase 2 is gated only on ADR-018 being live.

### Negative

- **Lesson noise risk.** If the extraction prompt produces low-quality lessons (false generalisations from a single edge-case trajectory), they will degrade future task quality until their confidence decays below threshold. Mitigation: `min_confidence = 0.6` default, `max_lessons_per_task = 5` cap, and the garbage-collection mechanism. Operators should treat the first 50 lessons as calibration data.
- **Skill namespace pollution.** A permissive write policy (any agent can submit) combined with a verification gate that is purely syntactic/execution-based (not semantic quality) could allow technically-correct but poorly-written skills to accumulate. Mitigation: `usage_count` tracks retrieval frequency; a future cleanup sweep can demote skills with zero usage after 30 days.
- **Context injection budget.** Injecting up to 1,000 tokens of lessons + skills into every task context costs tokens on every invocation. Operators running high-frequency, low-complexity tasks may want to disable retrieval for those task classes via `scope` filtering.
- **Phase 2 depends on ADR-018.** If the kernel MCP is never enabled (e.g. in a resource-constrained deployment), the Voyager `VerificationGate` cannot function (no `KernelSession` available for assertion execution). Phase 1 (ExpeL) is fully independent of this constraint.

### Neutral

- The existing `patterns` namespace (hooks post-task raw outcomes) is not modified or deprecated. It coexists with `code-harness-lessons`. Agents may search both namespaces depending on context.
- The `reasoning_patterns` namespace in RuVector (ReasoningBank) is not superseded. Lessons in `code-harness-lessons` are task-level, code-execution-domain observations; ReasoningBank entries are architectural and meta-level decision patterns. They serve different retrieval queries.

---

## Alternatives considered

### Free-form notes file in `/workspace`

- **Pros:** Trivially simple to implement; no infrastructure.
- **Cons:** Not semantically searchable; drifts without maintenance; invisible to other agents (file-based memory is explicitly prohibited by the workspace CLAUDE.md memory policy); no schema enforcement.
- **Rejected.**

### Vector-only memory (status quo — raw outcome records in `patterns`)

- **Pros:** Already live; no new build work.
- **Cons:** Stores outcomes, not distilled rules; no `DistilledLesson` or `VerifiedSkill` primitives; no `VerificationGate`; no `LessonConfidence` tracking or garbage collection. The gap this ADR addresses is precisely what the status quo lacks.
- **Rejected as complete solution;** retained as the Phase 0 foundation.

### MIRIX multi-tier memory (arxiv: mirix)

- **Pros:** Richer memory taxonomy (episodic, semantic, procedural, multimodal tiers).
- **Cons:** Large-cost infrastructure extension to RuVector's schema; procedural memory (the most relevant tier) is covered by Voyager at M cost; episodic and multimodal tiers have no current agentbox demand. Explicitly rejected in the convergence shortlist.
- **Rejected.**

### ToolNet adaptive skill routing (arxiv: toolnet)

- **Pros:** Learns edge weights between tasks and tools from telemetry; adapts routing dynamically.
- **Cons:** skill-router is static by design for predictability and auditability; adaptive routing adds operational complexity and latency; no measured accuracy benchmark for a 89-skill catalogue of agentbox's shape; explicitly rejected in the convergence shortlist.
- **Rejected.**

### Storing skill bodies as raw file artefacts in `/workspace/skills/`

- **Pros:** Human-readable; no embedding pipeline dependency.
- **Cons:** No semantic search; no `VerificationGate` integration with the kernel MCP `KernelSession`; no `LessonConfidence` or usage tracking; no cross-session visibility to agents whose workspace bind mount differs.
- **Rejected.**

---

## Rollout

### Phase 1 — ExpeL lesson-extractor (S build cost, no dependencies)

Deliverables:
- `skills/expel-lesson-extractor/SKILL.md` with extraction prompt template, lesson schema, and retrieval instructions.
- Hook registration in `claude-flow hooks post-task` to call the extractor when `[features.expel_lesson_extraction].enabled = true`.
- `code-harness-lessons` namespace auto-created on first write (RuVector creates namespaces on demand).
- Retrieval guidance added to `skills/codeact/SKILL.md`, `skills/skill-router/SKILL.md` pre-task search steps.
- Validator rule E044 precondition checked (W043 if kernel not enabled).

Acceptance criteria:
- A completed task with `enabled = true` produces at least one lesson record retrievable by `mcp__ruvector__memory_search(namespace="code-harness-lessons", query="...")` within the same session.
- A lesson with `confidence < 0.2` is not returned in search results.
- Extraction prompt produces valid JSON on 95 % of trajectory inputs tested against a batch of 20 historical task records.

### Phase 2 — Voyager verified skill library (M build cost, requires ADR-018 kernel live)

Deliverables:
- `skills/voyager-skill-library/SKILL.md` with candidate submission instructions, write-gate description, and retrieval flow.
- Write-gate Python module reusing `sandbox_check.py` from ADR-018's `mcp/code-interpreter/` and the kernel MCP's `kernel.exec` tool.
- `code-harness-skills` and `code-harness-skills-rejected` namespaces.
- Retrieval guidance in `codeact` SKILL.md.
- Validator rule E044.

Acceptance criteria:
- A well-formed candidate `VerifiedSkill` with passing assertions stores successfully and is retrievable.
- A candidate with a failing assertion is rejected by the `VerificationGate` with a structured `{ok: false, reason: "assertion-failed", detail: "..."}` response.
- A candidate containing `subprocess.run` (a BannedAPI) is rejected by the static scan before assertions run.

### Rollback

- **Phase 1:** Set `[features.expel_lesson_extraction].enabled = false`. Existing lesson records remain in RuVector but are no longer written to or retrieved. No skill behaviour changes.
- **Phase 2:** Set `[skills.voyager_skill_library].enabled = false`. Existing skill records remain. The `codeact` SKILL.md pre-task search step for `code-harness-skills` produces empty results (search on an inactive namespace returns zero rows, not an error).
- In both cases, emptying the namespace (`DELETE FROM memory_entries WHERE namespace = 'code-harness-lessons'`) is the nuclear rollback; it is reversible only if the trajectory records in `patterns` are intact (lesson re-extraction is possible from stored trajectories).

---

## Open questions

1. **Lesson schema versus ReasoningBank.** The `reasoning_patterns` namespace in RuVector serves a similar purpose (stored architectural insights). Should `code-harness-lessons` merge into `reasoning_patterns`, or remain distinct? The distinction by namespace is intentional for now (lessons are code-execution-domain, reasoning patterns are architectural) but the retrieval query at task start searches both — a unified schema would simplify the retrieval layer.

2. **Skill body language.** Python only for v1 is the recommendation. A `body_shell` field for verified Bash functions would be useful (e.g. a function that normalises a git diff for review), but the static analysis for shell is significantly harder. Defer unless demand emerges.

3. **Multi-agent skill ownership.** The current design allows any agent to write any skill. Should there be a "trusted agent" concept where only agents whose session ID is in a whitelist can write skills with `scope = "*"`? Risk is low in practice (verification gate is the trust signal) but worth revisiting if namespace pollution becomes a problem.

4. **Lesson quality calibration.** The extraction prompt template is fixed in v1. Prompt quality directly determines lesson quality. Should there be a feedback loop where lesson confidence scores feed back into prompt improvement? This begins to resemble RLHF and is probably out of scope; but operators should plan to review the lesson namespace manually during the first 30 days.

5. **ExpeL and Voyager interaction.** A lesson might say "use the `normalise_dataframe` function from the skill library". If that skill is later deprecated or re-versioned, the lesson is stale. The lesson garbage-collection mechanism does not currently check for referenced skill existence. A cross-namespace integrity check would address this.

---

## Related files

- `skills/expel-lesson-extractor/SKILL.md` — extraction prompt template, `DistilledLesson` schema (to be created in Phase 1 implementation)
- `skills/voyager-skill-library/SKILL.md` — candidate submission, `VerificationGate`, retrieval (to be created in Phase 2 implementation)
- `agentbox.toml` — `[features.expel_lesson_extraction]` and `[skills.voyager_skill_library]` blocks
- `mcp/code-interpreter/sandbox_check.py` — reused by Voyager write gate (see ADR-018)
- `scripts/agentbox-config-validate.js` — E044, W043
- `docs/reference/prd/PRD-008-code-as-harness-integration.md`
- `docs/reference/ddd/DDD-005-code-execution-domain.md`
- `docs/reference/adr/ADR-005-pluggable-adapter-architecture.md`
- `docs/reference/adr/ADR-015-mcp-ruvector-mandate.md`
- `docs/reference/adr/ADR-018-persistent-code-interpreter-mcp.md`

## References

- ExpeL: LLM Agents Are Experiential Learners — Zhao et al. 2023 — https://arxiv.org/abs/2308.10144
- Voyager: An Open-Ended Embodied Agent with Large Language Models — Wang et al. 2023 — https://arxiv.org/abs/2305.16291
- RuVector HNSW semantic search — internal; ADR-015
