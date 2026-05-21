# QE-002: Re-verification of QE-001 defects on PRD-008 / ADR-018 / ADR-019 / ADR-020 / DDD-005

**Date:** 2026-05-20
**Reviewer:** QE review agent (claude-sonnet-4-6, session QE-002)
**Scope:** Verification of 14 defects from QE-001 plus cross-doc consistency regression check
**Verdict:** PASS-WITH-CONDITIONS

---

## Summary

14 defects from QE-001. 10 fixed, 2 partial, 2 not fixed, 0 regressed. 2 new defects introduced by the fix-up pass (E01, E02).

The five blockers from QE-001 are reduced to zero blockers in the current state. The two not-fixed items are D08 (network contradiction) at major severity and D11 (Tree-of-Code rejection justification) at minor severity. Two new minor defects were surfaced: a span naming inconsistency in ADR-020 (E01) and a TOML key mismatch between ADR-018 and DDD-005 for the package allowlist (E02). No blocker remains.

---

## Per-defect verdict table

| ID | Severity (QE-001) | Verdict | Evidence (file:line or grep result) | Notes |
|---|---|---|---|---|
| D01 | blocker | FIXED | `docs/reference/adr/ADR-020-aci-mcp-tree-search.md` exists, Status: Proposed; wire contracts for E1–E5 and F1–F3 are fully specified | ADR-020 is `Proposed` (not `Accepted`), which is correct per the ADR-020 §Rollout section that makes acceptance gated on ADR-018 Phase 1 green. The file's existence resolves the broken cross-link. |
| D02 | blocker | FIXED | All five docs use `[skills.code_interpreter]` (snake_case); `grep -rE "skills\.[a-z]+-[a-z]"` over all five docs returns zero hits; `[skills.voyager_skill_library]` and `[features.expel_lesson_extraction]` are consistent across ADR-019, PRD-008, DDD-005 | Hyphen/underscore conflict fully resolved. Minor residual: DDD-005 I03 still uses key `[skills.code_interpreter].allowed_packages` but ADR-018 manifest block defines `pip_allowlist` — see E02. |
| D03 | blocker | FIXED | PRD-008 §7 A1 reads "exactly 6 tools matching ADR-018 §Wire contract (`kernel.exec`, `kernel.list_vars`, `kernel.inspect`, `kernel.reset`, `kernel.interrupt`, `kernel.install_pkg`)"; PRD-008 §3.1 tool table matches ADR-018 §Wire contract exactly; DDD-005 ACL table maps all 6 tools | `kernel.lm_emulate` removed from PRD tool table; `kernel.state` removed; PRD §11 cites CoC LMulator deferral. |
| D04 | blocker | FIXED | ADR-019 §Architecture "Privacy filter on RuVector write path" decision block present at line 207–213; DDD-005 OQ5 marked Closed at line 280 with specific mechanism (drop lesson on filter failure); `PrivacyFilterPort` also referenced in the lesson-extractor flow diagram at line 136 | Security blocker fully addressed. |
| D05 | blocker | FIXED | ADR-018 Status: `Draft`; ADR-019 Status: `Draft`; ADR-020 Status: `Proposed`; PRD-008 Status: `Draft v1`; all implementation file citations in ADR-018 and ADR-019 are clearly marked "(to be created in Phase 1 implementation)" | Self-contradictory `Accepted (Draft v1)` status eliminated. |
| D06 | major | FIXED | ADR-018 §Observability binding now has a complete table covering all 6 tools with span name, log fields, and metrics for each; span names follow `agentbox.mcp.code_interpreter.<op>` consistently; PRD-008 §9 span format description updated to `agentbox.mcp.<component>.<operation>` with examples matching ADR-018 | Old `agentbox.code-harness.*` scheme absent from all five docs. Residual: ADR-020 uses `agentbox.mcp.aci-shell.<tool>` (hyphen) while PRD-008 §9 example uses `agentbox.mcp.aci_shell.edit_file` (underscore) — see E01. |
| D07 | major | FIXED | ADR-018 §Rollout Phase 1 now reads: "Phase 1 acceptance is defined by PRD-008 §7 Track A criteria A1–A9. ADR rollout sections describe procedure (build, deploy, monitor), not thresholds." The bespoke acceptance criteria (p95 < 200 ms, etc.) are removed from ADR-018 §Rollout | Single source of truth restored to PRD-008 §7. |
| D08 | major | NOT FIXED | PRD-008 §8 risk row for pip install reads: "kernel has `JUPYTER_NO_NETWORK=1` set at spawn; `kernel.install_pkg` reads from a pre-built venv only; no public-mirror access in v1. If public-mirror egress is needed in future, gate behind `[skills.code_interpreter].allow_public_mirror = false`." ADR-018 §Sandbox reads: "no network access (the server sets `JUPYTER_NO_NETWORK=1` via the kernel environment)." The contradiction from QE-001 persists: PRD-008 §8 now aligns with ADR-018 on `JUPYTER_NO_NETWORK=1` but PRD-008 §10 OQ2 still says "policy for what can be on the operator allowlist is not yet specified" and implies pip install works somehow, even though JUPYTER_NO_NETWORK=1 blocks PyPI. The install-from-pre-built-venv model is stated in PRD-008 §8 but not yet in ADR-018 §Package install policy. ADR-018 §Package install policy still says packages are installed from the allow-list "via pip" with no mention of the pre-built venv model. | Partial progress: the explicit "pip mirror" claim is removed from PRD-008. The underlying contradiction remains: ADR-018 still implies pip is used at runtime while JUPYTER_NO_NETWORK=1 is set. |
| D09 | major | FIXED | PRD-008 §7 CodeAct criterion B2 now reads: "A three-step task — (1) `kernel.exec("vals = list(range(20))")`; (2) `kernel.exec("acc = []\nfor v in vals: acc.append(v*v)")`; (3) `kernel.exec("print(','.join(str(x) for x in acc))")` — returns stdout exactly `"0,1,4,9,16,25,36,49,64,81,100,121,144,169,196,225,256,289,324,361"`. Measurement: automated harness `tests/code-harness/multi-turn-fibonacci.sh`. Pass: byte-for-byte stdout match." | Concrete test with exact expected stdout present. |
| D10 | major | FIXED | ADR-019 §Architecture "Skill versioning" subsection present at lines 215–219 (immutable versions, monotonic `v<n>` suffix, archive to `code-harness-skills-archive` after 30 days); DDD-005 I15 present at line 190 ("VerifiedSkill records are immutable. A new version is written as a new URN with monotonically increasing version suffix (`urn:agentbox:skill:<scope>:<name>:v<n>`). Old versions are retained until archived."); DDD-005 OQ3 marked Closed at line 276 | Versioning invariant and mechanism fully specified. |
| D11 | minor | NOT FIXED | PRD-008 §5 lists PoE-World with a reclassification justification ("Reclassified from 'defer' ... because PoE-World's compositional-environment-modelling pattern has no observed use case in the current agentbox skill mix; reopen if a planning-time environment forecast use case emerges"). Tree-of-Code is absent from §5 entirely — it appears only as a source paper citation in §11 and in §3.6 prose ("ORPS and Tree-of-Code search patterns"). No explicit rejection of Tree-of-Code with justification is present | QE-001 flagged Tree-of-Code as implicitly rejected without justification. This has not been addressed. The QE-001 recommendation was to add "Tree-of-Code: Explicitly rejected because the paper's pattern is fully absorbed into the tree-search-coder skill design; no separate surface is needed." No such addition appears in §5. |
| D12 | minor | FIXED | ADR-018 §Manifest gates TOML block now includes `idle_timeout_s = 1800` with comment "# default 30 min; W044 warns if < 300"; W044 validator entry present | Key now canonical in the authoritative ADR location. |
| D13 | minor | FIXED | DDD-005 I05 now reads: "Trace records written to the audit JSONL are append-only (filesystem convention enforced by `O_APPEND` on file open). Trace evidence written to RuVector for lesson distillation uses URN keys with a write-once policy: collision-check before write via `memory_retrieve(key)` returning empty; if a duplicate URN is detected, the write is refused and a `TraceWriteCollision` event is emitted." | Both JSONL (O_APPEND) and RuVector (collision-check) semantics specified. `TraceWriteCollision` event defined in DDD-005 §Events. |
| D14 | minor | FIXED | PRD-008 §7 C3 criterion changed from "cosine ≥ 0.75" to "the corresponding seeded lesson appears in the top-3 results returned by `memory_search` with `namespace=code-harness-lessons`, `limit=5`. Pass: 5/5 queries hit top-3." — avoids requiring direct cosine score exposure; `tests/code-harness/lesson-retrieval-queries.json` cited as the committed query set. PRD-008 §7 B3 cites "10 prompts committed to `tests/fixtures/skill-router-prompts.json`" | Proxy metric replaces inaccessible cosine score. Fixture file references added for both C3 and B3. |

---

## Cross-doc consistency

### Check 1: TOML keys — snake_case only

PASS. `grep -rE "skills\.[a-z]+-[a-z]"` over all five docs returns zero hits. All keys use snake_case: `[skills.code_interpreter]`, `[skills.voyager_skill_library]`, `[skills.aci_shell]`, `[skills.tree_search_coder]`, `[features.expel_lesson_extraction]`. The hyphen/underscore blocker from QE-001 is fully resolved.

### Check 2: `[skills.code_interpreter]` present in all 4 target docs

PASS. Key `[skills.code_interpreter]` appears in:
- PRD-008: lines 97, 207, 279, 324, 352
- ADR-018: lines 134, 152, 157, 161, 185, 191, 288, 298, 322
- ADR-019: validator W043 references `skills.code_interpreter.enabled`
- DDD-005: lines 63, 109, 187, 254, 266

### Check 3: Tool table — exactly 6 tools in all docs

PASS. All five docs agree on the canonical 6-tool set: `kernel.exec`, `kernel.list_vars`, `kernel.inspect`, `kernel.reset`, `kernel.interrupt`, `kernel.install_pkg`. PRD-008 §7 A1 explicitly requires "exactly 6 tools matching ADR-018 §Wire contract" with all six named. DDD-005 ACL table maps all six. `kernel.lm_emulate` and `kernel.state` are absent from all.

### Check 4: Span naming

PARTIAL — see E01. All spans in ADR-018, PRD-008, and DDD-005 consistently use `agentbox.mcp.code_interpreter.<op>` (snake_case component). PRD-008 §9 example for ACI uses `agentbox.mcp.aci_shell.edit_file` (snake_case). However, ADR-020 §Observability table at line 169 specifies `agentbox.mcp.aci-shell.<tool>` (hyphen in component segment). This is an inconsistency between ADR-020 and PRD-008 for the ACI span name.

### Check 5: Status fields

PASS. ADR-018: `Status: Draft`. ADR-019: `Status: Draft`. ADR-020: `Status: Proposed`. PRD-008: `Status: Draft v1`. DDD-005: `Status: Draft`. All correct per the agreed convention.

### Check 6: Privacy filter on lesson write path (D04)

PASS. ADR-019 §Architecture "Privacy filter on RuVector write path" decision block is explicit, complete, and includes the failure mode (drop lesson, not write without redaction, emit `LessonRedactionFailed` event). DDD-005 OQ5 is marked Closed with the specific resolution. The lesson-extractor flow diagram shows `privacy filter (PrivacyFilterPort) applied first` before the `mcp__ruvector__memory_store` call.

### Check 7: Skill versioning (D10)

PASS. ADR-019 §Architecture "Skill versioning" subsection is present and complete: immutable records, monotonic version number (`v<n>` suffix), archive to `code-harness-skills-archive` after `archive_after_days`. DDD-005 I15 present and consistent. DDD-005 OQ3 marked Closed.

### Check 8: Invariant enforcement — I02, I05, I10, I12, I14

PASS. All five previously orphaned or partially-orphaned invariants now have technical enforcement cited:

- I02: Enforced by MCP server dispatch handler blocking until completion or SIGINT; `kernel.interrupt` sends SIGINT; `KernelInterruptedError` raised; tested by `tests/code-harness/kernel-interrupt.sh`.
- I05: JSONL uses `O_APPEND` on file open; RuVector uses URN collision-check via `memory_retrieve` before write; `TraceWriteCollision` event emitted on collision. JSONL and RuVector semantics distinguished correctly.
- I10: Contradiction detection via sampled LLM judge (1/10 retrievals); `confidence -= 0.1`; floor 0.3 triggers archive. Detection mechanism specified in ADR-019 §Contradiction detection; DDD-005 OQ2 closed with this resolution.
- I12: `sandbox_check.py` is explicitly noted as a Phase 1 deliverable; until shipped, candidate-skill writes are blocked at runtime by ADR-019 §VerificationGate. Enforcement path is clear (not notional).
- I14: Enforced by ADR-019 §VerificationGate step 2.5; `verified_by` URN resolved via `memory_retrieve`; must be younger than `max_evidence_age_s`; stale/missing rejects with `stale-evidence` reason.

### Check 9: B2 measurability (D09)

PASS. PRD-008 §7 CodeAct criterion B2 (renumbered from the B2 in QE-001 to item 2 under "CodeAct skill (Phase 2a)") provides: an explicit three-step task body using `vals = list(range(20))` and list-comprehension squares, exact expected stdout (`"0,1,4,9,16,25,36,49,64,81,100,121,144,169,196,225,256,289,324,361"`), and named harness file `tests/code-harness/multi-turn-fibonacci.sh`. Pass condition is byte-for-byte stdout match.

### Check 10: Cross-link integrity

PASS for the previously broken link. ADR-020 file now exists. All `Related:` references in all five docs resolve to actual files (verified against QE-001 cross-link table — only ADR-020 was missing; all others were confirmed present in QE-001). ADR-020 itself links to PRD-008, ADR-018, ADR-019, DDD-005, ADR-005, ADR-008, ADR-012, ADR-013, ADR-015 — all exist.

Residual concern: PRD-008 §4 surface table rows 5 and 6 still say "ADR-020 (stub)". The "(stub)" label is now misleading since ADR-020 is a full Proposed ADR with complete wire contracts. This is a minor documentation polish issue, not a traceability failure.

---

## New defects

### E01 — MINOR
**File:** `docs/reference/adr/ADR-020-aci-mcp-tree-search.md` §Observability, line 169
**Defect:** ADR-020 §Observability table specifies the ACI span as `agentbox.mcp.aci-shell.<tool>` (hyphen in the component segment). PRD-008 §9 specifies all spans follow `agentbox.mcp.<component>.<operation>` with snake_case within each segment, and its example is `agentbox.mcp.aci_shell.edit_file` (underscore). The hyphen/underscore inconsistency in the component segment of the ACI span name was not caught in the D06 fix (which focused on the code_interpreter spans). Downstream trace analysis querying for `agentbox.mcp.aci_shell.*` will miss spans emitted as `agentbox.mcp.aci-shell.*`.
**Severity:** Minor (same pattern as the resolved D02/D06 defects; affects trace query correctness).
**Required fix:** Change ADR-020 §Observability span name from `agentbox.mcp.aci-shell.<tool>` to `agentbox.mcp.aci_shell.<tool>` to match PRD-008 §9 and the `[skills.aci_shell]` TOML key.
**Owner:** ADR-020 author

### E02 — MINOR
**File:** `docs/reference/ddd/DDD-005-code-execution-domain.md` §Aggregates KernelSession, line 109; `docs/reference/adr/ADR-018-persistent-code-interpreter-mcp.md` §Manifest gates, line 189
**Defect:** DDD-005 I03 reads "install_pkg only succeeds if the package name appears in the `[skills.code_interpreter].allowed_packages` manifest list." ADR-018 §Manifest gates defines the key as `pip_allowlist` (not `allowed_packages`). These are different TOML keys. The implementation will read `pip_allowlist`; DDD-005 I03 references `allowed_packages`. This is the same class of key-name inconsistency as the D02 blocker from QE-001, but it escaped the fix pass.
**Severity:** Minor (the authoritative definition is in ADR-018; DDD-005 is inconsistent with it; no config validator will catch this since the validator uses ADR-018's key).
**Required fix:** Change DDD-005 I03 to reference `[skills.code_interpreter].pip_allowlist` to match ADR-018 §Manifest gates.
**Owner:** DDD-005 author

---

## Verdict

PASS-WITH-CONDITIONS

Zero blockers remain. The two not-fixed items are D08 (major: pip install mechanism vs. JUPYTER_NO_NETWORK=1 contradiction in ADR-018 §Package install policy) and D11 (minor: Tree-of-Code absent from PRD-008 §5 rejection list without justification). Two new minor defects were introduced: E01 (ACI span naming hyphen/underscore) and E02 (DDD-005 I03 uses `allowed_packages` instead of `pip_allowlist`).

---

## Recommendations

**Sign-off conditions for PASS:**

1. **D08 (major) — ADR-018 §Package install policy**: Clarify that `kernel.install_pkg` installs from a pre-built venv (not via live pip to PyPI) when `JUPYTER_NO_NETWORK=1` is set. The prose must state: packages in the frozen stack are pre-installed at server startup from a locked requirements file; `kernel.install_pkg` for allowlisted extras installs from a local venv pre-populated at image build time; `JUPYTER_NO_NETWORK=1` is therefore consistent with pip-based install because no outbound network call is made at runtime. Update PRD-008 §10 OQ2 to mark it closed with this resolution.

2. **E01 (minor) — ADR-020 span naming**: Change `agentbox.mcp.aci-shell.<tool>` to `agentbox.mcp.aci_shell.<tool>` in ADR-020 §Observability table.

3. **E02 (minor) — DDD-005 I03**: Change `[skills.code_interpreter].allowed_packages` to `[skills.code_interpreter].pip_allowlist` in DDD-005 I03.

4. **D11 (minor) — PRD §5**: Add Tree-of-Code to the rejection list with justification (e.g. "Explicitly rejected: the paper's pattern is fully absorbed into the tree-search-coder skill design in ADR-020; no separate surface is needed").

Items 1–4 are all single-doc, single-paragraph edits. None requires cross-doc coordination. D08 is the highest-risk item — the install mechanism is a security-relevant decision and must be unambiguous in the authoritative ADR before Phase 1 ships.
