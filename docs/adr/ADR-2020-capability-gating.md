---
id: ADR-2020
title: Optional capabilities are manifest-gated and byte-identical-when-off; execution-gated tools are spend-capped and never auto-routed
date: 2026-08-31
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 1b43b70ff09b971b440c9964743402aec45ef515
verified_paths: [agentbox.toml, skills/tree-search-coder/SKILL.md, services/agentbox-ops/src/bin/tree-search-cap.rs]
owner: jjohare
review_trigger: any new optional skill/feature block added to agentbox.toml, or any change to the tree-search-coder spend/route posture
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: legacy ADR-039 (system-manifest apply-class catalogue), ADR-020 (ACI MCP + execution-gated tree-search, Surface 2 spend/route posture); manifest mechanism in BASELINE-container ADR-2003
---

# ADR-2020 — Optional capabilities are manifest-gated and byte-identical-when-off; execution-gated tools are spend-capped and never auto-routed

## Context

The box ships a growing set of optional capabilities (`code_interpreter`,
`codeact`, `aci_shell`, `tree_search_coder`, `dream_machine`, …). Two forces:
an operator must be able to turn any of them off and get a provably clean
runtime; and execution-gated tools that spend money or fan out N candidates
must not silently drain budget or be reached by automatic routing. Prior art:
the system-manifest apply-class catalogue (ADR-039) and the Surface-2 spend/route
posture from the ACI/tree-search work (ADR-020).

## Decision

Every optional capability is gated by an `agentbox.toml` block that gates **both**
the Nix package set and the supervisor block, each carrying a system-manifest
apply-class. A disabled gate is intended to omit its executable package and supervised process.
Instructional files are still copied with the skills tree; byte identity and zero
footprint require separate build evidence. The
N-candidate execution-gated `tree_search_coder` additionally requires an enforced
per-invocation `spend_cap_usd` plus `max_candidates`/`per_branch_timeout_s`
ceilings, and is **never wired into automatic routing** — it is explicitly
invoked only. The governing invariants live in
`docs/GOVERNANCE-capabilities.md`.

## Consequences

- Turning a capability off is a one-line `enabled = false` edit with a defined
  apply-class, and the operator can trust the off-state is footprint-free.
- Explicit routing and a spend cap are required policy, and the cap is now an
  enforced runtime limiter: every branch must be admitted by `tree-search-cap
  reserve` before dispatch and settled after (`services/agentbox-ops/src/bin/tree-search-cap.rs`).
  Absence of every automatic route is still established by the skill's own
  declaration, not by a mechanism.
- Cost: activation of a gate requires an image rebuild (nix-baked package +
  supervisord), so toggling is not hot; and the byte-identical-when-off
  guarantee must be re-checked whenever a new gate is added.

## Verification

At `cbe7335b9`, `agentbox.toml`: `[skills.code_interpreter]` (:535),
`[skills.codeact]` (:551), `[skills.aci_shell]` (:579),
`[skills.tree_search_coder]` (:621) carrying `max_candidates = 5`,
`per_branch_timeout_s = 60`, `spend_cap_usd = 0.50` and the inline comment
"explicitly invoked, never auto-routed" (:624), and `[dream_machine]` (:1560).
`skills/tree-search-coder/SKILL.md` frontmatter is orchestration-only and states
"NEVER auto-routed; only ever invoked explicitly". Manifest apply-class mechanism
defined in ADR-2003.

**2026-09-05 re-verified at 08e817f39.** Governed paths changed by `385027e71` (explicit gate declarations in `agentbox.toml`) and `205d370ba` (the `tree-search-cap` limiter), which rewrote `skills/tree-search-coder/SKILL.md` from an advisory cap to an enforced one. The decision still holds and is now backed by a mechanism. Re-checked at HEAD: `agentbox.toml:534` `[skills.code_interpreter]`, `:550` `[skills.codeact]`, `:578` `[skills.aci_shell]`, `:620` `[skills.tree_search_coder]` with `max_candidates = 5` (`:625`), `per_branch_timeout_s = 60` (`:626`), `spend_cap_usd = 0.50` (`:627`) and the "invoked, never auto-routed" comment at `:623`; `[dream_machine]` at `:1668` (the previously cited `:1560` has drifted, as have all four skill-block line numbers). `skills/tree-search-coder/SKILL.md:9` still states "NEVER auto-routed; only ever invoked explicitly". **Record correction made by this pass:** the Consequences bullet claimed "the inspected orchestration-only skill does not establish a runtime limiter". A limiter now exists — `services/agentbox-ops/src/bin/tree-search-cap.rs` requires `reserve` before every branch dispatch and `settle` after, refusing with `EXIT_REFUSED = 3` (`:32`) on spend, candidate count or wall clock, holding each reservation under a file lock so concurrent branches cannot jointly exceed the cap — so that bullet has been corrected in place and `tree-search-cap.rs` added to `verified_paths` as the file the enforcement claim now depends on. `implementation_status` stays `partial`: the byte-identical-when-off guarantee still has no build evidence, and no automatic-route absence proof exists beyond the skill's own declaration. Commands: `git diff 89301ec7..HEAD -- agentbox.toml skills/tree-search-coder/SKILL.md`, `grep -n '^\[skills\.' agentbox.toml`, `grep -n 'EXIT_REFUSED\|reserve' services/agentbox-ops/src/bin/tree-search-cap.rs`.

## Closeout extension — 2026-09-04

CP-01/07/08. Owner remains jjohare with capability/runtime maintainers. Tree-search is an orchestration-only skill; the named cap fields were not found consumed by a limiter in the inspected runtime paths. The flake copies the skills tree independently of per-capability execution gates.

Implementation status changes to partial for the broader guarantee; existing conventions and manifest policy remain accepted. **Acceptance condition:** Prove package/process/registration/execution off-states independently and bind them to build/runtime identity. Exercise the real executor with concurrent and in-flight cost reservations, candidate/time limits and explicit invocation checks. Reopen on lint, registry, build, routing or executor changes. See the [capability review](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/capability-instructions-and-enforcement.md) and [source/fixture receipt](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/evidence/skill-lint-probes.json). No provider, model orchestration or image rebuild ran.

## Acceptance progress — 2026-09-05

- **Implemented**
  - The declared cap fields are now consumed by an enforced limiter: `agentbox_ops::cost_cap` (`services/agentbox-ops/src/cost_cap/mod.rs` + `ledger.rs`), exposed as the `tree-search-cap` binary (`reserve` | `settle` | `status` | `reset` | `config`).
  - **Why Rust, not JS.** No JS dispatcher routes tree-search — `management-api/` and `mcp/servers/` contain no invocation path for it (only `scripts/agentbox-config-validate.js`'s W051/W052 *validation* and `management-api/lib/system-manifest.js`'s gate catalogue). The skill is orchestration-only and runs as a sequence of short-lived tool calls, so the enforcement boundary is a callable limiter with durable, lock-guarded state; that belongs in `services/agentbox-ops`, beside the existing `token_audit` cost accounting it sits alongside rather than duplicating (`token_audit` reports historical transcript spend; `cost_cap` gates prospective spend).
  - **Reserve before dispatch, settle after.** A branch's estimated cost is held against the run's budget for its whole lifetime, so concurrent and in-flight reservations cannot jointly exceed `spend_cap_usd`. `settle` releases the hold on **both** the success and the failure path; a double settle is refused as `unknown_reservation`. An unsettled hold expires at `per_branch_timeout_s` and is charged its **full estimate**, so a crashed branch can never hand back budget it may have spent.
  - **Concurrency safety.** Every check-and-admit is a read-modify-write of the JSON ledger performed while holding an exclusive `flock` (rustix) — one atomic step across threads *and* processes, never a read-then-write.
  - **All three declared ceilings enforced**, plus the manifest gate itself: `spend_cap_usd`, `max_candidates` (only granted reservations consume a slot), `per_branch_timeout_s` (`guard_branch` mid-branch and expiry at `reserve`), and `enabled = false` → every reservation refused. Refusals are typed (`spend_cap_exceeded`, `candidate_limit_exceeded`, `branch_timeout`, `capability_disabled`, …) and exit `3`.
  - **Documented default.** An absent block or field falls back to `spend_cap_usd = 0.50`, `max_candidates = 5`, `per_branch_timeout_s = 60`, with the inferred field named in `CapConfig.defaulted`. There is no unlimited mode — an absent cap is 0.50 USD, never infinity.
  - **Skill wired to the limiter.** `skills/tree-search-coder/SKILL.md` and `references/algorithm.md` §Enforced cost cap make reserve-before-dispatch and settle-after-completion mandatory steps of the algorithm; `references/exemplars.md` exemplar 3 now shows the limiter's refusal payload instead of an agent-side cost check.
- **Tests and results**
  - `cargo test -p agentbox-ops --offline` → **157 passed, 0 failed** (lib) plus 1 doc-test, including 17 `cost_cap` cases: under-cap succeeds; single over-cap refused; exactly-at-cap admitted and the next cent refused; in-flight holds block a second branch; release on both success and failure paths; double settle refused; **8 concurrent threads at 0.20 against a 0.50 cap admit exactly 2**; 12 threads at 0.15 against 1.00 admit exactly 6; candidate ceiling enforced independently of spend; per-branch wall clock enforced; abandoned reservation expires and is charged at estimate; overrun actual cost tightens remaining budget; disabled capability refuses; negative/non-finite amounts refused; runs accounted independently; the real `agentbox.toml` still declares an enforceable cap.
  - `bash tests/capability/tree-search-cap.test.sh` → **13 passed, 0 failed** — the cross-**process** contract, which is what the real dispatch path looks like: **10 concurrent `tree-search-cap reserve --estimate 0.20` processes against a 0.50 cap admit exactly 2 and refuse 8 with exit 3**, outstanding holds measured at 0.40 ≤ cap; failure-path release; the 6th candidate refused at `max_candidates = 5`; an absent manifest block enforcing the documented 0.50 default; a disabled gate refusing.
- **Receipts** — `docs/estate-closeout/2026-09-05/adr-2020-cost-cap.json`
- **Remaining** — the other half of this ADR is untouched: byte-identical-when-off / zero-footprint build evidence for a disabled gate's package and supervised process, bound to build and runtime identity, still needs an image rebuild to establish. The never-auto-routed property remains an instruction in the skill description and routing tables, not a mechanical block. No provider, model orchestration or image rebuild ran.
- **Governed paths changed** — `services/agentbox-ops/src/cost_cap/{mod.rs,ledger.rs,mod_tests.rs}` (new), `services/agentbox-ops/src/bin/tree-search-cap.rs` (new), `services/agentbox-ops/src/lib.rs`, `services/agentbox-ops/Cargo.toml` (new bin target + `toml` dependency), `tests/capability/tree-search-cap.test.sh` (new), `skills/tree-search-coder/SKILL.md`, `skills/tree-search-coder/references/{algorithm.md,exemplars.md}`, `docs/estate-closeout/2026-09-05/adr-2020-cost-cap.json` (new).

### Re-verification 2026-09-05

Re-verified at `verified_commit` 89301ec7c911eab270c00a0cf81596d0d4f15535, on the
uncommitted working tree above that SHA; re-run at the landing commit. The
staleness was `agentbox.toml` drift, so the manifest half is what was re-checked.
`verified_paths` is emptied for the landing commit to repopulate.

- **The spend cap is still declared and enforceable.** `agentbox.toml:620-627`
  `[skills.tree_search_coder]` reads `enabled = true`, `max_candidates = 5`,
  `per_branch_timeout_s = 60`, `spend_cap_usd = 0.50` — unchanged in value from the
  previous verification, so the cross-process contract test's assumption still holds.
- **Never-auto-routed is still declaration, not mechanism.** The comment at
  `agentbox.toml:621-623` states "Slow path — explicitly invoked, never
  auto-routed"; enforcement remains the skill description plus routing tables. That
  is unchanged and is still the weaker half of this ADR's Invariant.
- **Manifest-gate breadth.** 21 `[skills.*]` blocks now exist in `agentbox.toml`.
  Each is a boot gate; none of them carries build-time off-state evidence.
- **Validator coverage confirmed.** `scripts/agentbox-config-validate.js:1283-1350`
  enforces this ADR's posture at config time: `E052` (`:1329`) requires
  `code_interpreter.enabled` when `tree_search_coder.enabled`, `W051` (`:1336`)
  warns above `max_candidates = 5`, `W052` (`:1340-1341`) treats an absent or zero
  `spend_cap_usd` as a hard-error advisory — "the tree-search skill has no
  default-unlimited mode". Note a pre-existing defect found while re-verifying: the
  code `E052` is used twice in this validator for two unrelated rules — the
  tree-search dependency at `:1329` and an SRI-hash format check at `:1103`. Not
  fixed here; recorded so a future reader is not misled by a duplicate code.

`implementation_status` stays `partial` for the reason already recorded: the
byte-identical-when-off half still needs an image rebuild to establish package and
supervised-process absence for a disabled gate. Diagram AB-15.1 carries that as a
`DIVERGENCE:` note rather than asserting the property holds.

## Landing re-verification — 2026-09-05 (ddd1f1ec8)

Governed paths changed in the landing commit: agentbox.toml: a new `[skills.podcast_ingest]` section (ADR-2057) only; every section this record governs is untouched, which is this decision applied (a formerly ungated program now has a manifest gate and a catalogue entry, 60 gate paths resolve). Decision unaffected; `verified_commit` moved to the landing commit.

## Landing re-verification — 2026-09-06 (796d85fcf)

Governed paths changed in the Wave 3 landing commit: agentbox.toml. The changes are the ones recorded by the Wave 3 records landed in that commit (ADR-2061, 2064, 2065, 2066, 2068, 2069, 2070, 2072, the proposed 2071/2073–2078) and the ADR-2018 recall diagnosis; none alters this record's decision. Gates at the landing commit: management-api 81 suites / 1290 tests, exposure gate PASS, catalogue 60 paths, config validation clean. `verified_commit` moved to the landing commit.
