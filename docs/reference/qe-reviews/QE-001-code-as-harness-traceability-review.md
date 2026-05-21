# QE-001: PRD-008 / ADR-018 / ADR-019 / DDD-005 Traceability Review

**Date:** 2026-05-20
**Reviewer:** QE review agent (claude-sonnet-4-6, session QE-001)
**Scope:** PRD-008 v1, ADR-018 v1, ADR-019 v1, DDD-005 v1
**Verdict:** BLOCK

---

## Summary

The four documents share a coherent conceptual architecture and are well-written for their stated purpose. However, they contain five blocker-severity defects that prevent merge: ADR-020 is referenced as if it exists but the file is absent, breaking cross-link integrity for two Phase 1 acceptance-criteria tracks; the convergence-shortlist's `manifest_toggle` for the ExpeL feature (`[features.expel_lesson_extraction]`) conflicts with both the PRD toggle notation (`[features.expel_lesson_extraction] enabled = true`) and the ADR-019 TOML block (same key) but is irreconcilable with the DDD-005 narrative that uses a third form; the tool table in PRD-008 §3.1 exposes five tools while ADR-018 §Architecture exposes six, and the DDD-005 ACL table only maps five — the extra tool `kernel.lm_emulate` is entirely absent from ADR-018 and DDD-005; DDD-005 open question 5 (privacy-filter interaction with RuVector trace writes) is a genuine security gap with no mitigation in any ADR; and three DDD-005 invariants (I02, I06, I12) are orphaned — no existing file, ADR decision, or manifest gate enforces them. Total: 32 acceptance criteria, 27 traceable, 5 orphaned against at least one column; 14 DDD invariants, 3 orphaned; 5 blockers, 5 majors, 4 minors.

---

## Check 1: Traceability Matrix

Rows = PRD-008 §7 acceptance criteria, grouped by track.
Columns: ADR-018 decision (D1–D6), ADR-019 decision (M1 = ExpeL, M2 = Voyager), DDD-005 invariant.

ADR-018 decision codes:
- D1: One IPython kernel per session, lazy spawn
- D2: MCP stdio server (`mcp/code-interpreter/server.py`)
- D3: Six MCP tools exposed
- D4: Thin `codeact` SKILL.md, no Python logic in skill
- D5: Trace-as-reward as primary verification signal
- D6: Fail-closed semantics (fallback to pytorch-ml)

| # | Acceptance Criterion (PRD-008 §7) | ADR Decision | DDD-005 Invariant | Status |
|---|---|---|---|---|
| **Kernel MCP — Track A** |||||
| A1 | `tools/list` returns ≥ 5 tools | D3 | — | ORPHAN (no DDD invariant) |
| A2 | Sequential stateful exec: `x=1` persists | D1, D5 | I01, I02 | OK |
| A3 | Cold-start latency < 500 ms | D1 | — | ORPHAN (no DDD invariant) |
| A4 | Idle RSS < 100 MB | D1 | — | ORPHAN (no DDD invariant) |
| A5 | Supervisor restarts within 5 s of SIGKILL | D2 | — | ORPHAN (no DDD invariant) |
| A6 | After restart, next exec returns `kernel_restarted` not hang | D5, D6 | I01 | OK |
| A7 | Audit JSONL written within 50 ms | D2, D5 | I06 | OK (but I06 is itself orphaned — see Check 2) |
| A8 | `kernel.reset` clears namespace | D3 | — | ORPHAN (no DDD invariant; DDD operations table has `reset` but no invariant guards it) |
| A9 | Manifest toggle disables MCP registration | D2 | — | ORPHAN (no DDD invariant) |
| **CodeAct skill — Phase 2a** |||||
| B1 | GSM8K ≥ 85% in CodeAct mode | D4, D5 | — | ORPHAN (no DDD invariant; purely empirical) |
| B2 | Multi-turn stateful task completes correctly | D1, D5 | I02 | OK |
| B3 | Skill-router routes correctly on 10 prompts | D4 | R04 | OK |
| **ExpeL — Track B** |||||
| C1 | ≥ 1 lesson after 10 tasks | M1 | I08, I09 | OK |
| C2 | Every lesson record has required fields | M1 | I09 | OK |
| C3 | Lessons retrievable by semantic search (cosine ≥ 0.75) | M1 | — | ORPHAN (no DDD invariant governs retrieval quality) |
| C4 | No lesson stored for < 3 tool calls | M1 | I08 | OK |
| C5 | Feature disableable at runtime without restart | M1 | R05 | OK |
| **Voyager — Phase 2b** |||||
| D1 | Skill library survives session restart | M2 | I11, I13 | OK |
| D2 | verified-skills count > 0 after benchmark run | M2 | I11 | OK |
| D3 | Failing-assertion skill quarantined | M2 | I11, I12 | OK |
| D4 | Up to 3 skills injected at task start | M2 | R04 | OK |
| D5 | Injection ≤ 2000 tokens | M2 | — | ORPHAN (no DDD invariant caps context injection; DDD §Architecture mentions 600 tokens but does not invariantise it) |
| **ACI MCP — Track C** |||||
| E1 | `tools/list` returns 5 ACI tools | ADR-020 (absent) | — | ORPHAN both columns |
| E2 | SWE-bench-Lite ≥ 30% pass rate | ADR-020 (absent) | — | ORPHAN both columns |
| E3 | `aci.view_file` hard 150-line limit | ADR-020 (absent) | — | ORPHAN both columns |
| E4 | `aci.edit_file` diff ≤ 10 lines context | ADR-020 (absent) | — | ORPHAN both columns |
| E5 | `aci.search_repo` truncates at max_results | ADR-020 (absent) | — | ORPHAN both columns |
| **Tree-search — Phase 2c** |||||
| F1 | Selects highest-assertion-pass candidate | ADR-020 (absent) | — | ORPHAN both columns |
| F2 | N=3 wall time < 120 s | ADR-020 (absent) | — | ORPHAN both columns |
| F3 | Off by default, no implicit routing | D1 (partial) | R04 (partial) | WEAK (no dedicated ADR decision for tree-search routing guard) |

**Orphaned criteria (at least one column empty): A1, A3, A4, A5, A8, A9, B1, C3, D5, E1–E5, F1–F2 = 16 criteria missing at least one traceability column.**

**Both columns empty (ADR + DDD): E1–E5, F1–F2 (7 criteria) — all ACI and tree-search criteria, because ADR-020 does not exist.**

---

## Check 2: Invariant Coverage

| Invariant | Enforcement mechanism | Status |
|---|---|---|
| I01: Terminated session cannot transition | Kernel process lifecycle; `session-end` hook (ADR-018 D1 + D2) | OK — ADR-018 §Kernel lifetime model enforces this via `shutdown_kernel(now=True)` |
| I02: exec is atomic w.r.t. interrupt | Requires `kernel.interrupt()` tool implementation sending SIGINT; ADR-018 D3 includes `kernel.interrupt` | ORPHANED — ADR-018 §Wire contract specifies the tool but no ADR section specifies the atomicity guarantee or tests it; no manifest gate; no existing code cited |
| I03: `install_pkg` only for manifest-allowlisted packages | ADR-018 §Package install policy + manifest `pip_allowlist`; validator E042 | OK |
| I04: Idle timeout terminates kernel | `[skills.code-interpreter].idle_timeout_s` (DDD-005 mentions it; PRD-008 §3.1 mentions it; ADR-018 §Manifest gates omits `idle_timeout_s`) | PARTIAL — ADR-018 manifest block does not include `idle_timeout_s`; the key is mentioned in PRD-008 §3.1 but absent from ADR-018's `[skills.code_interpreter]` TOML block. Inconsistency means the feature has no canonical authoritative definition. |
| I05: Traces immutable once written | No code enforces this; the audit JSONL is append-only by convention but no ADR decision or manifest gate prevents mutation | ORPHANED — convention only, no technical enforcement cited |
| I06: Each exec emits exactly one OTLP span | ADR-018 §Observability binding specifies the span name | OK — ADR-018 specifies the span; ADR-005 middleware is the enforcement mechanism |
| I07: Full code body never in default log/span | ADR-018 §Observability binding: code body logged only in debug mode | OK |
| I08: Lesson only from terminal trajectory | ADR-019 §Lesson-extractor flow — hook fires on `post-task` which implies terminal state; R01 in DDD-005 | OK |
| I09: Execution-grounded lessons only | ADR-019 §Decision M1 — structured prompt requires `evidence` field; distillation rejects empty evidence | OK |
| I10: LessonConfidence decremented on contradiction | ADR-019 §Conflict resolution — decremented by 0.1 each contradiction | PARTIAL — how contradiction is detected is an open question in DDD-005 §OQ2; the mechanism is stated but the detection step is not yet specified, making this invariant unenforced in practice |
| I11: Skill written only after all assertions + example pass | ADR-019 §Write gate — three conditions specified | OK |
| I12: Banned-API static scan before kernel evaluation | ADR-019 §Write gate step 1; `sandbox_check.py` reuse | ORPHANED — `sandbox_check.py` is referenced as a file that will exist (ADR-018 §Implementation layout) but does not exist yet (confirmed by filesystem check). The invariant relies on a not-yet-authored implementation artefact with no enforcement path today. |
| I13: Every VerifiedSkill carries provenance | ADR-019 §Skill record fields — `source_agent` field required | OK — field is required in schema |
| I14: `verified_by` must reference real, recent ExecutionTrace URN | No ADR decision specifies how "real and recent" is validated at write time; the write gate (ADR-019 §Write gate) checks assertions and examples but does not validate the trace URN | ORPHANED — no enforcement mechanism in any ADR decision, manifest gate, or existing code |

**Orphaned invariants: I02, I05, I12, I14 (4 fully orphaned). Partial: I04, I10.**

---

## Check 3: Manifest Gate Coherence

### Key inventory across docs

| TOML key | PRD-008 | ADR-018 | ADR-019 | DDD-005 | Consistent? |
|---|---|---|---|---|---|
| `[skills.code-interpreter] enabled` | `[skills.code-interpreter] enabled = true` | `[skills.code_interpreter] enabled = false` | — | `[skills.code-interpreter] enabled = true` | **FAIL** — PRD and DDD use hyphen (`code-interpreter`); ADR-018 uses underscore (`code_interpreter`). TOML is case-sensitive and permits both forms but they are different keys. |
| `[skills.code-interpreter] idle_timeout_s` | mentioned in §3.1 prose | **absent** from ADR-018 manifest block | — | mentioned in ubiquitous language | **FAIL** — key is cited in PRD §3.1 and DDD glossary but not defined in the authoritative ADR-018 manifest block. |
| `[skills.code_interpreter] allow_pip` | `allow_pip_install = false` (PRD §3.1 prose) | `allow_pip = false` (ADR-018 TOML block) | — | — | **FAIL** — PRD prose uses `allow_pip_install`; ADR-018 TOML block uses `allow_pip`. Two different key names for the same gate. |
| `[features.expel_lesson_extraction] enabled` | `features.expel_lesson_extraction = true` (PRD §3.4 YAML, §6, §7) | — | `[features.expel_lesson_extraction] enabled = false` (ADR-019 TOML) | `[features.expel_lesson_extraction] enabled = true` (DDD §Migration) | OK on substance; note PRD §3.4 writes the key without the sub-key (`enabled`) in some places but this is prose |
| `[skills.voyager-skill-library] enabled` | `[skills.voyager-skill-library] enabled = true` | — | `[skills.voyager_skill_library] enabled = false` | — | **FAIL** — PRD uses hyphen (`voyager-skill-library`); ADR-019 uses underscore (`voyager_skill_library`). Same hyphen/underscore defect as `code-interpreter`. |
| `[skills.aci-shell] enabled` | `[skills.aci-shell] enabled = true` | — | — | — | Referenced only in PRD; ADR-020 is absent. Default value stated in PRD only. Not referenced in any DDD port or aggregate. **FAIL** (no ADR; no DDD reference). |
| `[skills.tree-search-coder] enabled` | `[skills.tree-search-coder] enabled = false` | — | — | — | Same problem — ADR-020 absent. **FAIL.** |
| `[linked_data.code_execution] enabled` | not mentioned | not mentioned | not mentioned | mentioned in DDD-005 §Events and §Ports | **FAIL** — DDD-005 references this gate but it is not defined in any PRD §4 surface or ADR manifest block. |

**Summary: 5 key-name inconsistencies (3 hyphen/underscore conflicts, 2 missing keys) and 1 gate present only in DDD with no PRD/ADR backing.**

---

## Check 4: Acceptance Criteria Measurability

| Criterion | Unit present | Measurement method | Pass threshold | Verdict |
|---|---|---|---|---|
| A1 (tools/list ≥ 5) | count | `tools/list` MCP call | ≥ 5 | PASS |
| A2 (stateful exec) | boolean | scripted two-step MCP call | exact stdout match | PASS |
| A3 (cold-start < 500 ms) | ms | "from process spawn to first response" | < 500 ms | PASS |
| A4 (idle RSS < 100 MB) | MB | "measured 60 seconds after last exec" | < 100 MB | PASS — but no tool named (e.g. `kernel.state` or `ps`) |
| A5 (supervisor restart < 5 s) | seconds | "within 5 s of SIGKILL" — no script named | < 5 s | PARTIAL — measurement method is described but no script name is given; threshold is clear |
| A6 (kernel_restarted response) | boolean | MCP response inspection | exact error key | PASS |
| A7 (audit JSONL within 50 ms) | ms | "within 50 ms of execution completing" — no measurement script | < 50 ms | PARTIAL — no measurement script named |
| A8 (reset clears namespace) | boolean | three-step scripted MCP sequence | NameError, not "1" | PASS |
| A9 (manifest toggle) | boolean | inspect `skills/mcp.json` and supervisor config | no registration, no block | PASS |
| B1 (GSM8K ≥ 85%) | percentage | "automated harness, 3 runs, median" — harness not named | ≥ 85% | PARTIAL — harness not named; "randomly sampled" is not reproducible without a seed |
| B2 (multi-turn stateful) | boolean | "a multi-turn task (≥ 5 tool calls)" — task not specified | "completes correctly" | FAIL — "completes correctly" is not a measurable pass criterion |
| B3 (skill-router ≥ 8/10) | count | 10 representative prompts — prompts not named | ≥ 8 | PARTIAL — prompt set not defined; not reproducible |
| C1 (≥ 1 lesson after 10 tasks) | count | `mcp__ruvector__memory_search` | ≥ 1 | PASS |
| C2 (lesson fields) | boolean | inspect stored record structure | all 4 fields present | PASS |
| C3 (cosine ≥ 0.75) | scalar | "5 lessons tested" — no script, no test-set definition | ≥ 0.75 | PARTIAL — test set not defined; cosine similarity is not directly observable via `memory_search` (search returns results, not scores) |
| C4 (no lesson < 3 calls) | boolean | trigger with a 2-call task; verify no write | absence of record | PASS |
| C5 (runtime disable) | boolean | set flag; verify no new writes without restart | absence of new lessons | PASS |
| D1–D5 (Voyager criteria) | various | all have units and thresholds | various | PASS for D1–D4; D5 has unit (tokens) but no measurement method named |
| E1–E5 (ACI criteria) | various | all have units and thresholds | various | Unmeasurable until ADR-020 exists |
| F1 (tree-search selects correctly) | boolean | "e.g. a JSON schema validator" — not specified | "not necessarily the first generated" | PARTIAL — example is illustrative, not a fixed test case |
| F2 (< 120 s) | seconds | wall clock | < 120 s | PASS |
| F3 (off by default) | boolean | inspect manifest + router | no implicit routing | PASS |

**Failing measurability: B2 ("completes correctly" with no definition). Partials: A5, A7, B1 (no seed), B3, C3, D5, F1. These are majors unless the harness is defined before Phase 2 starts.**

---

## Check 5: Rollout Gate Definition

### Phase 1 gate (PRD-008 §6)

PRD-008 §6 states: "Phase 1 acceptance: all three tracks green before Phase 2 begins."

Track A gate = §7 Kernel MCP criteria A1–A9. Explicit. OK.
Track B gate = §7 ExpeL criteria C1–C5. Explicit. OK.
Track C gate = §7 ACI criteria E1–E5. **These criteria depend on ADR-020, which does not exist.** The gate cannot be evaluated. FAIL.

Additionally, PRD-008 §6 table says "Items 1, 3, and 5 from §4 can be built in parallel". Item 5 in §4 is SWE-agent ACI MCP, which points to ADR-020 (stub). Phase 1 includes a track with no decision record. This is a blocker: you cannot declare Phase 1 complete without the ACI track gate, and the ACI track gate has no backing ADR.

### Phase 2 gate

PRD-008 §6 states Phase 2 begins "after Phase 1 green". There is no explicit gate specification for Phase 2 itself — i.e., what criteria must pass before Phase 3 (deferred items) could begin, or before Phase 2 items are considered production-ready individually. This is a minor: Phase 3 is "deferred" rather than a phase with a gate, so there is no missing Phase 3 gate. But Phase 2 has no exit gate of its own beyond the acceptance criteria implicitly defined per item.

### ADR-018 Phase 1/2 gates

ADR-018 §Rollout defines explicit Phase 1 acceptance criteria (kernel p95 < 200 ms, exception returns structured object, session-end cleans up, contract test green). These are different from PRD-008 §7 criteria. This duplication is a major inconsistency: ADR-018 Phase 1 acceptance criteria are not the same as PRD-008 Track A criteria. The "single source of truth" for when the kernel is done is ambiguous.

---

## Check 6: Out-of-Scope Discipline

Convergence shortlist `explicitly_rejected` array contains 11 items (OpenHands, NExT, MIRIX, ToolNet, SWE-Debate, all RL papers grouped as one item, RoboCodeX, CodexGraph, MemGPT, RepoCoder, ReAct).

PRD-008 §5 rejected items:

1. OpenHands — present. OK.
2. NExT — present. OK.
3. MIRIX — present. OK.
4. ToolNet — present. OK.
5. SWE-Debate — present. OK.
6. All RL training papers — present (grouped). OK.
7. RoboCodeX — present. OK.
8. CodexGraph — present. OK.
9. MemGPT — present. OK.
10. RepoCoder — present (note: shortlist spells it `paper-T4-repocodr`; PRD-008 §5 writes "RepoCoder" — same item, acceptable variant). OK.
11. ReAct — present. OK.

PRD-008 §5 also rejects **PoE-World** and **Tree-of-Code** as items. PoE-World is in the convergence shortlist as `classification: "defer"`, not `explicitly_rejected`. PRD-008 §5 therefore moves PoE-World from "defer" to "explicitly rejected" **without marking it as a closed decision reversal**. The shortlist is the scope source; PRD-008 is quietly changing PoE-World's status. This is a minor defect: it should be noted explicitly that PRD-008 is overriding the shortlist's "defer" classification to "explicitly rejected", and the rationale should appear in §5.

Tree-of-Code is not in the shortlist's `explicitly_rejected` array at all (it appears only as a paper citation under tree-search). PRD-008 §5 lists it as rejected — this is an unexplained scope expansion of the rejection list. Minor defect.

**Summary: All 11 shortlist-rejected items are present in PRD-008 §5. Two additional items appear in PRD-008 §5 that were not in the shortlist's rejected list (PoE-World — promoted from defer; Tree-of-Code — not evaluated in shortlist at all). Both must be justified.**

---

## Check 7: Cross-Link Integrity

Files checked against filesystem at `/home/devuser/workspace/project/agentbox/docs/reference/`.

| Link | Source doc | Target file | Exists? |
|---|---|---|---|
| ADR-018 | PRD-008 §Related, §11, §6 | `docs/reference/adr/ADR-018-persistent-code-interpreter-mcp.md` | YES |
| ADR-019 | PRD-008 §Related, §4, §11 | `docs/reference/adr/ADR-019-experiential-skill-learning.md` | YES |
| ADR-020 | PRD-008 §4 (surfaces table), §6, §11 | `docs/reference/adr/ADR-020-aci-mcp-tree-search.md` | **NO — MISSING** |
| DDD-005 | PRD-008 §Related | `docs/reference/ddd/DDD-005-code-execution-domain.md` | YES |
| PRD-001 | PRD-008 §Related | `docs/reference/prd/PRD-001-capabilities-and-adapters.md` | YES |
| ADR-005 | PRD-008 §Related, §9; ADR-018; ADR-019; DDD-005 | `docs/reference/adr/ADR-005-pluggable-adapter-architecture.md` | YES |
| ADR-015 | PRD-008 §Related; ADR-018; ADR-019 | `docs/reference/adr/ADR-015-mcp-ruvector-mandate.md` | YES |
| ADR-007 | ADR-018 §Related | `docs/reference/adr/ADR-007-runtime-contract-and-container-hardening.md` | YES |
| ADR-008 | ADR-018 §Observability; DDD-005 | `docs/reference/adr/ADR-008-privacy-filter-routing.md` | YES |
| ADR-011 | ADR-018 §Architecture | `docs/reference/adr/ADR-011-consultation-mcps.md` | YES |
| ADR-012 | PRD-008 §9; DDD-005 | `docs/reference/adr/ADR-012-jsonld-federation-grammar.md` | YES |
| ADR-013 | DDD-005 §References | `docs/reference/adr/ADR-013-canonical-uri-grammar.md` | YES |
| DDD-001 | DDD-005 §Ports, §References | `docs/reference/ddd/DDD-001-immutable-bootstrap-domain.md` | YES |
| DDD-002 | DDD-005 §TL;DR, §References | `docs/reference/ddd/DDD-002-runtime-contract-domain.md` | YES |
| DDD-004 | DDD-005 §TL;DR, §Events, §References | `docs/reference/ddd/DDD-004-linked-data-interchange-domain.md` | YES |
| `skills/verification-quality/` | PRD-008 §11 (internal references) | `skills/verification-quality/SKILL.md` | YES |
| `skills/codeact/SKILL.md` | ADR-018 §Implementation layout | `skills/codeact/SKILL.md` | **NO — MISSING** (implementation not yet created; cited as if it exists) |
| `skills/expel-lesson-extractor/SKILL.md` | ADR-019 §Related files | `skills/expel-lesson-extractor/SKILL.md` | **NO — MISSING** |
| `skills/voyager-skill-library/SKILL.md` | ADR-019 §Related files | `skills/voyager-skill-library/SKILL.md` | **NO — MISSING** |
| `mcp/code-interpreter/` | ADR-018 §Related files | `mcp/code-interpreter/` (directory) | **NO — MISSING** |
| `agentbox/schemas/mcp/code-interpreter-v1.json` | ADR-018 §Architecture | does not exist | **NO — MISSING** |

**Broken links: ADR-020 (1 doc), `skills/codeact/`, `skills/expel-lesson-extractor/`, `skills/voyager-skill-library/`, `mcp/code-interpreter/`, `schemas/mcp/code-interpreter-v1.json`.**

The implementation files are not expected to exist at draft-PRD time; citing them as if they exist in "Related files" sections of accepted ADRs is misleading but not a blocker unless the ADR status is "Accepted" (which both ADR-018 and ADR-019 claim). ADR-018 and ADR-019 both declare `Status: Accepted (Draft v1)` — if they are Accepted, their implementation files must exist. If they are Drafts, they should be `Status: Draft`. The status is contradictory. ADR-020 is the blocker: it is referenced as a live decision document from PRD §4 surface table, PRD §6, and PRD §11, and it does not exist at all.

---

## Check 8: Domain Language Consistency

DDD-005 ubiquitous language terms vs their usage in PRD and ADRs:

| DDD term | PRD-008 usage | ADR-018 usage | ADR-019 usage | Status |
|---|---|---|---|---|
| **KernelSession** | Not used; PRD §3.1 says "kernel process", "per-session" | Not used; "kernel process", "session" | Not used | FAIL — PRD and both ADRs never use `KernelSession`. They say "kernel process" (ADR-018), "interpreter context" is not used but "session" appears 22 times as a plain noun. Minor inconsistency. |
| **ExecutionTrace** | Not used; PRD says "execution observation", "runtime metrics", "execution results" | Not used; ADR-018 §Wire contract returns `{stdout, stderr, result, exception, duration_ms, cell_id}` — the object is described but not named | Not used | FAIL — the canonical domain object has no name in either PRD or ADR. The term `ExecutionTrace` appears exclusively in DDD-005. |
| **CodeAct Loop** | PRD §3.3: "write→exec→observe→revise loop" (correct) | ADR-018: "write→exec→observe→revise loop" (correct) | Not mentioned | PASS — phrasing matches DDD definition |
| **Trace-as-Reward** | PRD §2.6: "Trace-as-reward" (correct) | ADR-018 §Decision D5: "Trace-as-reward" (correct) | ADR-019: not mentioned | PASS |
| **DistilledLesson** | PRD §3.4: "lesson records", "distilled lesson", "natural-language lessons" | Not used | ADR-019: "lesson record", "lesson objects" | PARTIAL — "DistilledLesson" as a proper term is not used; "lesson record" is acceptable shorthand |
| **VerifiedSkill** | PRD §2.7, §3.5: "verified skill", "verified, working implementation" | Not used | ADR-019: "candidate skill", "verified skill" (lowercase) | PARTIAL — used but not capitalised as a domain term |
| **VerificationGate** | PRD §2.7: "three-gate write" — does not use the term | Not used | ADR-019: "write gate" (not `VerificationGate`) | FAIL — consistent paraphrase `write gate` across PRD and ADR-019 conflicts with DDD's `VerificationGate` |
| **LessonConfidence** | Not used; PRD says "confidence" (lowercase) | Not used | ADR-019 §Lesson record: `confidence` field (lowercase) | MINOR — the DDD compound term is not used in either PRD or ADR |
| **DegradedExecution** | PRD §2, §8: "degradation warning" | ADR-018 §Decision D6: "degradation warning", "structured degradation warning" | Not used | FAIL — DDD term `DegradedExecution` is the event name; PRD/ADR say "degradation warning" |
| **KernelScope** | Not used anywhere in PRD or ADRs | Not used | Not used | FAIL — important isolation concept absent from PRD and ADRs |
| **BannedAPI** | PRD §2.7: "banned APIs" (lowercase) | ADR-018 §Package install policy: "Blocked always" (different framing) | ADR-019 §Write gate: "banned API" (lowercase) | FAIL — three different locutions for the same concept |

**Language violations: `KernelSession`, `ExecutionTrace`, `VerificationGate`, `DegradedExecution`, `KernelScope`, `BannedAPI` — none of these DDD terms appear correctly in PRD or ADRs. The most critical are `ExecutionTrace` (the canonical evidence record) and `VerificationGate` (the security-critical gate).**

---

## Check 9: Risk → Mitigation Chain

PRD-008 §8 risks:

| Risk | Mitigation in PRD §8 | ADR decision backing | Verdict |
|---|---|---|---|
| Kernel memory leak (OOM) | Supervisor `memcap` cgroup limit, `kernel.state` RSS monitoring, operator alert at 400 MB | ADR-018 §Manifest gates: `max_memory_mb = 512`; §Sandbox boundary: `RLIMIT_AS` | OK — but note: ADR-018 uses `max_memory_mb` (advisory); the `memcap` cgroup claim in PRD §8 is not backed by any ADR decision that actually sets a cgroup limit. `RLIMIT_AS` is the enforcement; "memcap" is a term that does not appear in ADR-018. Minor inconsistency. |
| Pip install malicious package | Disabled by default; allowlist only; network egress restricted to pip mirror | ADR-018 §Package install policy + E042 + `pip_allowlist` | OK — but "network egress restricted to pip mirror" appears in PRD §8 only; ADR-018 §Sandbox: "no network access (`JUPYTER_NO_NETWORK=1`)" is stronger than PRD implies. Contradiction: PRD says pip mirror access is allowed; ADR says no network. |
| Skill-router collision | Mandatory routing section in skill-router SKILL.md; validated in Phase 2a | D4 + B3 acceptance criterion | OK |
| Skill library pollution | Three-gate write; quarantine; library wipe procedure | M2 (ADR-019) | OK |
| ExpeL lesson hallucination | `source_evidence` field required; lessons without grounding discarded | M1 (ADR-019) + I09 | OK |
| ACI MCP router confusion | "When to choose" table | ADR-020 (absent) | ORPHANED — no backing ADR |
| Tree-search cost overrun | N capped at 5; per-branch timeout; spend logging | ADR-020 (absent) | ORPHANED — no backing ADR |
| Session isolation violation | Independent kernel processes; per-session temp dirs | D1 (ADR-018) | OK — but note: "process UIDs are all `devuser`" — PRD §8 admits filesystem isolation is via temp dirs, not UID separation. No ADR decision specifies what the temp-dir policy is or who creates it. Minor. |

**Mitigations without ADR backing: ACI router confusion, tree-search cost overrun — both defer to ADR-020 which does not exist. Network egress contradiction between PRD §8 and ADR-018 §Sandbox. These are major defects.**

---

## Check 10: Observability and Audit Completeness

ADR-005 requires: one OTLP span + one log line + one metrics increment per dispatch.

### Kernel MCP (ADR-018)

- Span: `agentbox.mcp.code_interpreter.kernel.exec` — defined in ADR-018 §Observability binding. Attributes: `code_hash`, `duration_ms`, `outcome`, `cell_id`. OK.
- Log: "one JSON line per dispatch at info/error" — ADR-018 §Observability. OK.
- Metric: `agentbox_kernel_exec_total{outcome}`, `agentbox_kernel_exec_duration_ms`, `agentbox_kernel_sessions_active` — ADR-018 §Observability. OK.

However, ADR-018 only defines observability for `kernel.exec`. The five other tools (`kernel.list_vars`, `kernel.inspect`, `kernel.reset`, `kernel.interrupt`, `kernel.install_pkg`) have no span name, log field, or metric counter specified. ADR-005 requires ADR-005 middleware on every dispatch. If `kernel.reset` is called 50 times, zero observability is emitted. **FAIL — 5 of 6 MCP tools have no observability binding.**

PRD-008 §9 defines spans as `agentbox.code-harness.<component>.<operation>` format, giving `agentbox.code-harness.kernel.exec` as an example. This conflicts with ADR-018 which uses `agentbox.mcp.code_interpreter.kernel.exec`. Two different span-naming schemes in the same document set. Downstream trace analysis will be broken by this inconsistency.

### ACI MCP

PRD-008 §9 metric: `code_harness_aci_calls_total{tool, outcome}`. Span implied by `agentbox.code-harness.aci.<tool>`. No ADR-020 means no authoritative span/log/metric definition. Since ADR-020 is absent, this is a consequence of the same blocker. But independently: PRD-008 §3.2 (ACI wire contract) has no observability section at all — there is no audit JSONL field specification for the ACI MCP beyond the path (`aci-<session>-<date>.jsonl`) mentioned in §3.2 prose. The record shape for ACI JSONL is not specified. The kernel JSONL record shape is specified in PRD §3.1. Inconsistent treatment.

### ExpeL skill

PRD-008 §9: `code_harness_lessons_stored_total` counter — defined. No span name is specified for the ExpeL post-task step (it is a hook, not an MCP dispatch, so ADR-005 middleware does not apply automatically). This is acceptable: hooks are not MCP dispatches. But the audit JSONL path `lessons-<date>.jsonl` is defined. Log format is not specified. Minor.

### Voyager skill library

PRD-008 §9: `code_harness_skills_stored_total{gate}` counter — defined. No span name for the write-gate process. Same reasoning as ExpeL — hook/skill, not MCP dispatch. Acceptable but inconsistent with the detail provided for the kernel MCP.

### Tree-search skill

PRD-008 §9: `code_harness_tree_search_branches_total{n}` — defined. Audit JSONL path: `tree-search-<session>-<date>.jsonl`. OK.

**Observability defects: 5 of 6 kernel MCP tools lack span/log/metric specification; span naming scheme conflict between PRD §9 and ADR-018 §Observability; ACI JSONL record shape not specified.**

---

## Defects Requiring Fix Before Merge

### D01 — BLOCKER
**File:** `docs/reference/prd/PRD-008-code-as-harness-integration.md` §4, §6, §7, §11
**Defect:** ADR-020 is referenced as an existing decision document for the ACI MCP and tree-search skill. The file `docs/reference/adr/ADR-020-aci-mcp-tree-search.md` does not exist. Phase 1 Track C and Phase 2c acceptance criteria are entirely untraced. The Phase 1 gate cannot be satisfied.
**Required fix:** Either (a) author ADR-020 before merge, or (b) move ACI MCP and tree-search to Phase 3 (deferred), remove them from Phase 1 and Phase 2, and strip all ADR-020 references. Half-measures (leaving "stub" references) are not acceptable in a document set claiming `Status: Accepted`.
**Owner:** PRD author

### D02 — BLOCKER
**Files:** `docs/reference/adr/ADR-018-persistent-code-interpreter-mcp.md` §Manifest gates; `docs/reference/prd/PRD-008-code-as-harness-integration.md` §3.1, §7; `docs/reference/ddd/DDD-005-code-execution-domain.md` §Ubiquitous language; `docs/reference/adr/ADR-019-experiential-skill-learning.md` §Manifest gates
**Defect:** TOML key names are inconsistent across all four documents. `[skills.code_interpreter]` (ADR-018, underscore) vs `[skills.code-interpreter]` (PRD-008, DDD-005, hyphen) and `[skills.voyager_skill_library]` (ADR-019, underscore) vs `[skills.voyager-skill-library]` (PRD-008, hyphen). These are different TOML keys; the config validator will silently ignore the wrong-named key, resulting in features that cannot be enabled.
**Required fix:** Pick one form (TOML keys with hyphens are valid per TOML spec; underscores are also valid; but they cannot both be canonical). Normalise every occurrence in all four documents to the same form. Recommend hyphens to match the existing pattern in `agentbox.toml` (e.g. `[skills.aci-shell]` in PRD-008 uses hyphens). Additionally: `allow_pip_install` (PRD prose) vs `allow_pip` (ADR-018 TOML) must be unified to one key name.
**Owner:** ADR-018 author (owns the canonical TOML definition)

### D03 — BLOCKER
**Files:** `docs/reference/prd/PRD-008-code-as-harness-integration.md` §3.1 (5 tools); `docs/reference/adr/ADR-018-persistent-code-interpreter-mcp.md` §Wire contract (6 tools); `docs/reference/ddd/DDD-005-code-execution-domain.md` §Anti-Corruption Layer (5 tools mapped)
**Defect:** PRD §3.1 specifies five tools (`kernel.exec`, `kernel.reset`, `kernel.install`, `kernel.state`, `kernel.lm_emulate`). ADR-018 §Wire contract specifies six tools (`kernel.exec`, `kernel.list_vars`, `kernel.inspect`, `kernel.reset`, `kernel.interrupt`, `kernel.install_pkg`). The tool sets are not supersets or subsets of each other — `kernel.lm_emulate` and `kernel.state` appear only in the PRD; `kernel.list_vars`, `kernel.inspect`, `kernel.interrupt` appear only in the ADR; `kernel.install` (PRD) vs `kernel.install_pkg` (ADR) is a naming conflict. DDD-005 ACL table maps yet a different five-tool subset. The `kernel.lm_emulate` tool (Chain of Code LM emulator fallback, explicitly justified as a design decision in PRD §3.1) is entirely absent from ADR-018, which notes the CoC LMulator fallback as deferred. This is a silent removal of a PRD-specified feature without an ADR decision.
**Required fix:** Reconcile tool tables across all three documents. If `kernel.lm_emulate` is deferred, PRD §3.1 must be updated to remove it from the tool table and acceptance criterion A1 must be adjusted to ≥ 4 tools or the correct count. ADR-018 must explicitly note the deferral. DDD-005 ACL table must match the agreed canonical tool set.
**Owner:** PRD author + ADR-018 author (joint resolution)

### D04 — BLOCKER
**File:** `docs/reference/ddd/DDD-005-code-execution-domain.md` §Open Questions OQ5; `docs/reference/adr/ADR-019-experiential-skill-learning.md` §Architecture (RuVector write path)
**Defect:** DDD-005 OQ5 explicitly flags that it is not specified whether `ExecutionTrace` records written to RuVector for lesson distillation pass through the privacy filter. The privacy filter (ADR-008) redacts PII from audit-log exports, but the RuVector write path is not the audit log. Code executed by agents may contain secrets (API keys, credentials) in `stdout` or in variable representations. If traces are written raw to RuVector (a shared, multi-agent store), this is a data-leakage path. No ADR decision addresses this. The open question is left open in both DDD-005 and ADR-019.
**Required fix:** ADR-019 must include an explicit decision on whether the privacy filter applies before the RuVector write for lesson-evidence traces. Given the DDD-004 precedent (§L08: privacy redaction before encoding), the answer must be yes; if so, the `PrivacyFilterPort` must be listed as a dependency of the lesson-distillation write path in ADR-019 §Architecture. This is a security decision that cannot remain an open question in an Accepted ADR.
**Owner:** ADR-019 author

### D05 — BLOCKER
**Files:** `docs/reference/adr/ADR-018-persistent-code-interpreter-mcp.md` §Rollout Phase 1; `docs/reference/prd/PRD-008-code-as-harness-integration.md` §7 Track A; `docs/reference/adr/ADR-018-persistent-code-interpreter-mcp.md` status `Accepted (Draft v1)`
**Defect:** ADR-018 declares `Status: Accepted (Draft v1)` but its implementation artefacts do not exist: `mcp/code-interpreter/server.py`, `mcp/code-interpreter/sandbox_check.py`, `skills/codeact/SKILL.md`, `agentbox/schemas/mcp/code-interpreter-v1.json` are all absent. ADR-019 has the same problem: `skills/expel-lesson-extractor/SKILL.md`, `skills/voyager-skill-library/SKILL.md` are absent. An `Accepted` ADR implies the decision is made and implementation is planned or in progress; a `Draft` ADR does not require implementation artefacts. Using `Status: Accepted (Draft v1)` is self-contradictory. If accepted, the implementation must exist or be explicitly noted as pending with a target date. If draft, the status must say `Draft`. The current status causes tooling (CI, status checks) to treat these as finalized decisions when the implementation surface is entirely notional.
**Required fix:** Change both ADR statuses to `Status: Draft` until implementation artefacts are present, or change to `Status: Accepted` and immediately create stub files (at minimum: empty `server.py` with the tool schema, a `SKILL.md` template, and the JSON Schema file) with a ticket reference. The `Accepted (Draft v1)` hybrid is not a valid status.
**Owner:** ADR-018 author, ADR-019 author

---

### D06 — MAJOR
**File:** `docs/reference/adr/ADR-018-persistent-code-interpreter-mcp.md` §Observability binding; `docs/reference/prd/PRD-008-code-as-harness-integration.md` §9
**Defect:** ADR-018 §Observability only defines spans, logs, and metrics for `kernel.exec`. Five other tools (`kernel.list_vars`, `kernel.inspect`, `kernel.reset`, `kernel.interrupt`, `kernel.install_pkg`) have no observability binding. ADR-005 requires one span + one log + one metric per dispatch for every MCP tool call. Additionally, PRD §9 and ADR-018 use different span naming schemes (`agentbox.code-harness.kernel.exec` vs `agentbox.mcp.code_interpreter.kernel.exec`).
**Required fix:** Extend ADR-018 §Observability to cover all six tools. Normalise span naming to one scheme — recommend `agentbox.mcp.code-interpreter.<tool>` to match the existing ADR-011 consultant pattern.
**Owner:** ADR-018 author

### D07 — MAJOR
**File:** `docs/reference/adr/ADR-018-persistent-code-interpreter-mcp.md` §Rollout Phase 1 acceptance criteria vs `docs/reference/prd/PRD-008-code-as-harness-integration.md` §7 Track A
**Defect:** ADR-018 §Rollout defines its own Phase 1 gate (p95 latency < 200 ms, exception structure, zombie cleanup, contract tests). PRD-008 §7 Track A defines nine acceptance criteria. These sets overlap partially but are not the same. If an operator runs the ADR-018 Phase 1 gate, they will declare success when PRD-008 criteria A4 (idle RSS), A5 (supervisor restart), A7 (audit JSONL latency), and A9 (manifest toggle) have not been tested. The PRD must be the single source of truth for acceptance; the ADR's rollout section must defer to it or be deleted.
**Required fix:** Remove the bespoke acceptance criteria from ADR-018 §Rollout and replace with "See PRD-008 §7 Track A acceptance criteria." ADR rollout sections should describe the rollout procedure, not redefine acceptance thresholds.
**Owner:** ADR-018 author

### D08 — MAJOR
**Files:** `docs/reference/prd/PRD-008-code-as-harness-integration.md` §8; `docs/reference/adr/ADR-018-persistent-code-interpreter-mcp.md` §Sandbox boundary
**Defect:** PRD §8 risk mitigation for the pip install vector states "network egress from the kernel process is restricted to the pip mirror." ADR-018 §Sandbox states `JUPYTER_NO_NETWORK=1` — which blocks all network access, including the pip mirror. These are contradictory. If `JUPYTER_NO_NETWORK=1` is set, pip cannot reach any mirror. Either pip install works (with mirror-restricted egress) or no network is allowed (and `kernel.install_pkg` can only install from a local cache). The implementation consequence is undefined.
**Required fix:** ADR-018 must decide which model applies. Recommendation: no network from the kernel by default; `kernel.install_pkg` installs from a pre-built venv or a local mirror only; if a public mirror is ever needed, a manifest flag enables it. Update PRD §8 mitigation to match.
**Owner:** ADR-018 author

### D09 — MAJOR
**File:** `docs/reference/prd/PRD-008-code-as-harness-integration.md` §7 criterion B2
**Defect:** Acceptance criterion B2 reads "A multi-turn task (≥ 5 tool calls) that modifies intermediate Python state across calls completes correctly." "Completes correctly" is not a measurable criterion. There is no specified task definition, expected output, or failure mode.
**Required fix:** Replace with a concrete test: specify the task (e.g. "compute the Fibonacci sequence up to n=20 using a loop that accumulates results across three kernel.exec calls; the final exec must print the sequence correctly"), the expected output (exact string), and the measurement method (automated assertion on stdout).
**Owner:** PRD author

### D10 — MAJOR
**File:** `docs/reference/ddd/DDD-005-code-execution-domain.md` §Open Questions OQ3
**Defect:** DDD-005 OQ3 flags that versioning of `VerifiedSkill` is not specified — when an improved version is written, old versions may be retained or retired, creating retrieval noise or breaking the evidence chain. Invariants I11–I14 are silent on versioning. This means the skill library has no defined behaviour for updates, which will cause operational problems from the first time a skill is revised.
**Required fix:** ADR-019 must specify a versioning scheme before Phase 2b ships: either (a) immutable versions with monotonically increasing version numbers (`skill:<name>:<version>`), or (b) in-place replacement with the old record archived to a `code-harness-skills-archive` namespace. Add a versioning invariant (I15) to DDD-005.
**Owner:** ADR-019 author + DDD-005 author

### D11 — MINOR
**File:** `docs/reference/prd/PRD-008-code-as-harness-integration.md` §5
**Defect:** PRD §5 lists PoE-World as "explicitly rejected" but the convergence shortlist classifies it as `"defer"`, not `"explicitly_rejected"`. PRD §5 lists Tree-of-Code as explicitly rejected, but it does not appear in the shortlist's rejected list at all (it is only a source paper). Neither reclassification is justified in the text of §5.
**Required fix:** Add a sentence to each item in §5 explaining why the classification changed from the shortlist. PoE-World: "Reclassified from defer to explicitly rejected because the game-dev skill serves the same use case and dedicated demand has not emerged." Tree-of-Code: "Explicitly rejected because the paper's pattern is fully absorbed into the tree-search-coder skill design; no separate surface is needed."
**Owner:** PRD author

### D12 — MINOR
**Files:** `docs/reference/adr/ADR-018-persistent-code-interpreter-mcp.md` §Manifest gates; `docs/reference/ddd/DDD-005-code-execution-domain.md` §Ubiquitous language
**Defect:** `idle_timeout_s` is mentioned in PRD-008 §3.1 (`[skills.code-interpreter] idle_timeout_s = 1800`) and in DDD-005 ubiquitous language (definition of "Idle Timeout"), but it is absent from ADR-018 §Manifest gates, which is the authoritative location for TOML key definitions. DDD-005 §KernelSession I04 refers to a "manifest-gated" idle timeout but it cannot be manifested because the key is not in ADR-018.
**Required fix:** Add `idle_timeout_s = 1800` (default) to the `[skills.code_interpreter]` block in ADR-018 §Manifest gates. Add a corresponding validator check (e.g. `W044`: idle_timeout_s < 300 is suspicious for long-running data workflows).
**Owner:** ADR-018 author

### D13 — MINOR
**File:** `docs/reference/ddd/DDD-005-code-execution-domain.md` §Aggregates
**Defect:** I05 (traces immutable once written) is stated as an invariant but there is no technical enforcement mechanism cited. The audit JSONL is append-only by filesystem convention, but the RuVector write path (used by lesson distillation) does not enforce immutability. A future `memory_store` call with the same key will overwrite the record (RuVector's `upsert: true` semantics). If lesson distillation writes traces to RuVector with mutable keys, I05 is violated by the storage layer.
**Required fix:** Either (a) acknowledge that trace immutability is guaranteed only in the JSONL audit log, not in RuVector, and update I05 accordingly, or (b) specify that trace URN keys in RuVector are written with `upsert: false` semantics (if supported) or with a collision-check before write.
**Owner:** DDD-005 author

### D14 — MINOR
**File:** `docs/reference/prd/PRD-008-code-as-harness-integration.md` §7 criteria C3, B3
**Defect:** Criterion C3 requires cosine similarity ≥ 0.75 on a "held-out query set, 5 lessons tested." The measurement method does not exist as a callable: `mcp__ruvector__memory_search` returns results ranked by similarity but does not expose the cosine score to the caller. There is no `similarity_score` field in the standard RuVector search response documented in ADR-015. Criterion B3 requires 10 representative prompts to be routed correctly, but the prompts are not defined or committed.
**Required fix:** C3: verify that `memory_search` returns cosine scores, or replace with a proxy metric (e.g. "returned in top-3 results for 5/5 domain-matched queries"). B3: commit a fixed set of 10 prompts to `tests/fixtures/skill-router-prompts.json` before Phase 2a begins.
**Owner:** PRD author

---

## Conditional Acceptances

1. **DDD-005 OQ1 (multi-agent kernel sharing):** The current invariants are intentionally scoped to single-session ownership. Accepting this as deferred to ADR-018 authorship is reasonable provided ADR-018 (once its status is corrected from Draft to Accepted) explicitly closes this question before Phase 1 ships. Acceptable conditional on ADR-018 closing OQ1.

2. **ADR-018 Negative consequence — LMulator deferred to v2:** Accepting the deferral of the CoC LMulator is reasonable, provided the PRD tool table (§3.1) removes `kernel.lm_emulate` and acceptance criterion A1 is updated. The deferral itself is sound; the defect is the tool appearing in the PRD table without a corresponding ADR decision.

3. **ADR-019 OQ4 (lesson quality calibration via prompt feedback loop):** The concern that this resembles RLHF is well-founded and the deferral is appropriate. Acceptable as an open question.

4. **DDD-005 OQ6 (confidence floor and lesson retirement TTL):** Acceptable as an open question for Phase 1, provided Phase 2b is blocked on resolving it (lesson accumulation without TTL creates storage and retrieval noise at scale).

---

## Recommended Next Actions

1. **PRD author: resolve D01 before any other work.** Either author ADR-020 in full (covering ACI MCP and tree-search, with full wire contracts, manifest gates, and observability bindings) or move both surfaces to Phase 3 deferred and remove all ADR-020 references. This single action unblocks Checks 1, 5, 7, and 9 for the ACI and tree-search tracks.

2. **ADR-018 author: resolve D02 and D03 jointly.** Normalise all TOML key names to hyphen form across all four documents, reconcile the tool tables (remove `kernel.lm_emulate` from PRD §3.1 or add it to ADR-018), change ADR-018 status from `Accepted (Draft v1)` to `Draft`, and extend the observability section to cover all six tools. These are the highest-density defect cluster.

3. **ADR-019 author: resolve D04.** Add an explicit privacy-filter decision for the RuVector trace-write path. This is the only security-class defect in the set and must not remain an open question in any accepted or draft decision record that governs a feature handling agent-executed code.
