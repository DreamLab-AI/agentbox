---
id: ADR-2020
title: Optional capabilities are manifest-gated and byte-identical-when-off; execution-gated tools are spend-capped and never auto-routed
date: 2026-08-31
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: f93586b9e52fda0d0b367881e2d2ff3014509faf
verified_paths: [agentbox.toml, skills/tree-search-coder/SKILL.md, services/agentbox-ops/src/bin/tree-search-cap.rs]
owner: jjohare
review_trigger: any new optional skill/feature block added to agentbox.toml, or any change to the tree-search-coder spend/route posture
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: legacy ADR-039 (system-manifest apply-class catalogue), ADR-020 (ACI MCP + execution-gated tree-search, Surface 2 spend/route posture); manifest mechanism in BASELINE-container ADR-2003
---

# ADR-2020 — Optional capabilities are manifest-gated and byte-identical-when-off; execution-gated tools are spend-capped and never auto-routed

## Re-verification — 2026-10-02 at caab741c6 (factrail landing, ADR-2121)

The factrail landing (ADR-2121, `b7fc2b0e5` + `caab741c6`) touched governed paths without touching this decision: `agentbox.toml` changes only inside `[features.jev_compaction]` (comments, `min_reduction_ratio` removed, five new keys). No hunk falls in code this record governs, so its claims and status axes stand unchanged.

## Re-verification — 2026-10-01 (dependency refresh)

No capability gate is newly enabled by this refresh. Updated AQE and built-in ComfyUI locks remain for disabled gates. Nix/package gates are preserved, manifest validation passes and all 73 catalogue paths resolve (16 existing advisory omissions remain).
Source anchor: `bce906199`. Existing status axes and deferred
work remain unchanged; this source/test receipt is not a new activation claim.

## Context

## Re-verification — 2026-09-30 (interim sidechain supervision)

Reviewed the new sidechain gate: enabled dominates mirror/faucet; faucet gates both its standalone Nix package and supervisor block. Setup defaults are off. Catalogue regression tests prove parent-off wins; manifest validation and Nix build pass. Shared JS/runtime dependencies remain shared, not a zero-footprint claim.
Source anchor: `d0fa1b80b`. Existing status axes and deferred work are unchanged;
this scoped source/test receipt does not assert a new running-image activation.

### Original context

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

### 2026-09-07 documentation and workflow pin re-verification

The governed manifest diff at `7bf2382c031d696b0b2f5eb466f7e6615c88cc2c`
adds only two comments distinguishing the consultant wire alias from the documented
weight variant. The invariants workflow replaces action version tags with exact
commit pins and retains the same checks. Neither diff changes this decision’s
runtime behaviour; existing implementation and activation qualifications remain.

**2026-09-07 re-verified at `ee742ade5`.** Governed paths changed by `ee742ade5` (ADR-2082 orchestration proxy): agentbox.toml. The changes are additive — two new `[integrations.ruvector_external]` keys, their entrypoint env projection, one catalogue entry and two schema properties — and touch none of the sections this record governs; the decision and its invariant hold unchanged. Re-verified by `git diff 7bf2382c0..ee742ade5 -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-09-21 (`b680a7aeef604276af73e00e1eb5156f379530ae`)

Tripped by `agentbox.toml`; `skills/tree-search-coder/SKILL.md` and `services/agentbox-ops/src/bin/tree-search-cap.rs` are unchanged. The tree-search posture is intact at `HEAD` (`agentbox.toml:707-714`): `enabled = true` with the "explicitly invoked, never auto-routed" comment, `spend_cap_usd = 0.50`, `max_candidates = 5`, `per_branch_timeout_s = 60`. The blocks added since the previous anchor are themselves manifest-gated with an off path — `[features.jev_compaction]` (uninstalls the plugin and deletes the env key when off, `config/entrypoint-unified.sh:2083-2148`) and `[skills.routing]` (de-registers the hook when `router = "table"` or `hook = false`, `:2065-2078`) — so the gating law held for the new capabilities rather than being bypassed by them. `node scripts/agentbox-config-validate.js agentbox.toml` at `HEAD` → valid, 5 advisory warnings, no errors. Claim STILL TRUE.

## Re-verification — 2026-09-21 (`e57156a8ff72a4b84145b7de1d67d8d0c79fd41d`)

Tripped by `agentbox.toml` (`b680a7ae`, ADR-2094); `skills/tree-search-coder/SKILL.md` and `services/agentbox-ops/src/bin/tree-search-cap.rs` are unchanged since the previous anchor, so the `tree_search_coder` clauses stand untouched (re-read at HEAD: `max_candidates`, `per_branch_timeout_s`, `spend_cap_usd` and the "invoked, never auto-routed" comment are all present).

The diff adds a new capability, which makes this record the one being *tested* rather than merely disturbed. `[features.sovereign_system_one]` is gated, defaults `enabled = false`, and carries a `system-manifest.js` catalogue entry (`management-api/lib/system-manifest.js:215`, id `sovereign-system-one`, gate `features.sovereign_system_one`) with `apply_class: 'boot'` — which is the honest class: the consumer projection is an entrypoint re-read, and the record's own summary separates it from the REBUILD-class sidecar lifecycle. So the decision's procedural requirement was met by the new gate rather than bypassed.

**One caveat recorded honestly, not papered over.** The entrypoint emits `$_SSO_EXPORTS` unquoted into the expanding heredoc that generates `runtime-env.sh` (`config/entrypoint-unified.sh:2722`). With the gate off that variable is empty, so the *exported environment* is byte-identical to the pre-2094 state — every consumer resolves exactly what it did before — but the generated *file* gains three comment lines and one blank line. This is the same shape already in place for `$_MRN_EXPORTS` (ADR-2080) two dozen lines above, so it is an established pattern rather than a new departure, and it is inert. It is noted here because this record's Consequences explicitly say the byte-identical-when-off guarantee "must be re-checked whenever a new gate is added" — this is that re-check, and its result is: identical in effect, not identical in bytes, for the generated env file. `implementation_status` stays `partial` for the reason already recorded: that guarantee still has no build evidence.

Commands: `git diff b680a7ae..HEAD -- agentbox.toml skills/tree-search-coder/SKILL.md services/agentbox-ops/src/bin/tree-search-cap.rs`; `node scripts/agentbox-config-validate.js agentbox.toml` → `agentbox manifest valid (5 advisory warnings)`, none of them new. Claim STILL TRUE.

**2026-09-21 re-verified at `ab785f08c`.** Governed paths changed by the ADR-2105 kind move: agentbox.toml. The change is a kind-number relocation (colloquy 38100-38105 to 38410-38415, settlement 38110-38115 to 38420-38425) plus six numbers appended to `[sovereign_mesh.relay].allowed_kinds` and a comment above it; it touches no section this record governs. The decision and its invariant hold unchanged. Re-verified by `git diff e57156a8f..224afae65 -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-09-22 at d6b976271 (Sovereign Corpus landing)

**Governed changes:** `agentbox.toml`: `[vault]` gains the optional `repo` key (the vault repository root, exported as `VAULT_REPO`); `format` comments now state `obsidian` is the only value; one comment reworded ("logseq corpus" → "vault corpus"). **Decision unaffected** — none of these touches what this record decides. `verified_commit` moved to the landing commit. Gates at that commit: routing table current; forum e2e real mode 101/101 and stub 30/30 against this tree; management-api jest 88/88.

## Re-verification — 2026-09-26 at 6ea592ee0 (ADR-2111/2116 landing)

**Review trigger fired** ("any new optional skill/feature block added to agentbox.toml"). New since `d6b976271`: `[skills.routing].cascade`/`cascade_cutoff` (ADR-2095 addendum) and `label_log`/`label_embeddings_url` (ADR-2110), both `false`; `[claude_code]` (ADR-2116, a posture projection rather than an optional package); six `[features.jev_compaction]` keys (ADR-2093 amendment); `[toolchains].agentic_qe` flipped to `false`; `[resources.tmpfs]` sizes. Each new gate carries a catalogue entry with an honest apply class (`skill-router-cascade`, `routing-teacher-labels`, `claude-code-permissions`, all `boot`; `agentic_qe` stays `rebuild`), and `node scripts/ci/check-manifest-catalogue.js` → PASS, 69 gate paths. Off-state: cascade and label-log inline nothing into the hook command when off, and `label_log=false` strips any prior Stop registration (`config/entrypoint-unified.sh`, `_SR_CASCADE` / `_RL_HOOK` blocks). The `agentic_qe=false` flip drops `agenticQePkg` from the package set (`flake.nix:550`) and the entrypoint now also removes the `agentic-qe` entry from the host-mounted `.mcp.json` (`ENABLE_AGENTIC_QE` else-branch), which closes a residue the "gate omits its process" claim did not cover before. `tree-search-coder` files did not move. Claim STILL TRUE.

## Re-verification — 2026-10-02 (`a48ea407a24185f7a4f654a35e66805778acbec8`)

Tripped by ADR-2078 (pods signer signs as the sovereign identity). `agentbox.toml` changes only in `[integrations.solid_pod_rs]`: `sign_requests` false→true and the comment block above it (ADR-2078). It touches no section, key or phase this record governs, and the decision holds unchanged.
Re-verified by `git diff be358df7b..a48ea407a -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-10-02 (`f7465412de3d0d7a25fc1b6b2c8a72775490616d`)

Tripped by the `sidestr:dreamlab-txbt4` seal. `agentbox.toml` adds the `[sidechain.dreamlab-txbt4]` table, with `enabled = false`. No other key changed. The new table follows this record's rule: off by default, catalogued (`check-manifest-catalogue` PASS, 76 gate paths), and dominated by its parent gate `[sidechain].enabled` (`tests/config/sidechain-mirror.test.cjs`). **Decision unaffected.** `verified_commit` moves to the seal commit. Gates at that commit:

- the manifest validator is valid;
- `check-manifest-catalogue` passes;
- `tests/config/sidechain-genesis.test.sh` passes 7/7 and `sidechain-producer-gates.test.sh` 7/7.

## Re-verification — 2026-10-02 (`6db0ffc8df1e708047c210353f730d1f0427553d`)

Tripped by ADR-2097 (the sidestr payment rail). `agentbox.toml` gains one block, `[payments.sidestr]`, after `[skills.payment_router]`; no existing key moves. This fires the review trigger ("any new optional … block"), so the check is against the decision itself:

- The block is a runtime gate inside the always-on management-api, like `[payments.consumer]`. It adds no Nix package and no supervised program; `sidestr-agent` was already baked under `[sidechain]`. Package and supervisor gating therefore have nothing to omit.
- With the block off, every route it governs answers 503.
- Its spend is capped per payment and per payer per day, and the cap is enforced by spend-policy on `POST /v1/chain/pay`.
- Payments are explicitly invoked only; nothing routes to that endpoint automatically.

The decision holds unchanged. Re-verified by `git diff f7465412d..6db0ffc8d -- <verified_paths>`.

## Re-verification — 2026-10-02 (`e434a7a596a3a0518c51b7da107d6e0831891910`)

Tripped by the sidechain health and witness change. `agentbox.toml` changed only in `[voice]`: `enabled` false → true, with a comment, so that the descriptive sidecar state matches the four running agentbox-voice containers (CY-A2, `scripts/ci/check-declared-vs-running.js`). No other key moved. No gate was added. `[voice]` is still descriptive and consumed by no boot path, so ADR-2020's byte-identical-when-off rule is not engaged. `check-manifest-catalogue` passes (77 gate paths). Decision and status unchanged.

## Re-verification — 2026-10-02 (`e020264b54c6872ca98995c1adda18b8451a39af`)

Tripped by ADR-2097 (the rail keyed by chain). `agentbox.toml` changes only inside `[payments.sidestr]` (ADR-2097): its comment block, `chain_id` now `sidestr:dreamlab-txbt4`, and `producer_url` dropped in favour of the chain's derived port. The block still adds no package or supervised program, stays capped, and is explicitly invoked only. Nothing else this record governs is touched, and the decision holds unchanged.
Re-verified by `git diff e434a7a59..e020264b54c6872ca98995c1adda18b8451a39af -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-10-03 (`055c06ff69b2f53bf38a67d254c048bb03599fc8`)

Tripped by custody X-1 step 1 (W0 `custody/w0-bypasses` and W1 `custody/w1-role-accounts`). `agentbox.toml` gains only `[security].role_isolation = false` with its comment (ADR-2122); no other key moved. This is a new gate, so the byte-identical-when-off re-check is due. Result: **identical in effect, not identical in bytes**, the shape already recorded here for ADR-2094. With the flag off the boot executes today's statements and `exec supervisord -c /etc/supervisord.conf` (`tests/config/role-isolation-boot.test.sh`). The image does gain inert role passwd and group lines, `/etc/supervisord.roles.conf`, `/etc/agentbox/role-secrets.tsv`, `/etc/agentbox/role-accounts.json` and a root-owned `/run/secrets` tmpfs. The tmpfs is the one change visible in both modes: devuser can no longer rename `/run/secrets`. The flag is boot-class by design (ADR-2122), so these ship ungated. `implementation_status` stays `partial` for the reason already recorded.
Re-verified by `git diff 0919dc39a..055c06ff6 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.

## Re-verification — 2026-10-03 (`d3ff8e9a876e6b026b543f8824487e002e04cfa0`)

Tripped by the G-5 Q15 correction (`custody/w8-key-split`). `agentbox.toml` changed only in the trailing comments of two allowlist entries: `b41654017f…2f7a` is relabelled as the operator's NIP-07 31403 decision signer (it is `[sovereign_mesh.operator].pubkey_hex`), not visionclaw-server, and the `11ed6422…663c` entry in `[interaction_plane.proxy]` notes that its Podkey-vault copy is to be replaced by K_browser. No key, value, table or list member moved. `node scripts/agentbox-config-validate.js agentbox.toml` is valid with the same 5 advisory warnings as `origin/main` (`0919dc39a`). Decision and status unchanged.

## Re-verification — 2026-10-03 (`3b54129631067277f6363309b01cce485faa027a`, custody integration head)

Tripped by the custody integration (`custody/integration`: W0, W1, W5, W3, W7a, W8, W2, W9 and
the integration resolutions, ADR-2122). Since `d3ff8e9a8` the governed paths changed as follows. `agentbox.toml` gains `[security].role_isolation = false` with its comment (`49961f88c`, ADR-2122); no other key changes.
The new key defaults to off. Off, the boot is today's, which `tests/config/role-isolation-boot.test.sh` shows. It is identical in effect, in the record's sense. The decision holds. Re-verified by `git log d3ff8e9a8..3b5412963 -- <verified_paths>`
and the integration gates. Nix was not evaluated in this container; the image is unverified
until the owner's rebuild.

## Re-verification — 2026-10-03 (`f93586b9e52fda0d0b367881e2d2ff3014509faf`, custody W2b/W4)

Tripped by `f93586b9e` (custody W2b and W4: the at-rest migrate/revert and the sidechain state move). `agentbox.toml` changes only in the comment above `[security].role_isolation = false`: it no longer says the identity port and the custody migration are absent, and names what is built (W3, W2b, W4) and what is owed (W3b). No key or value moves. No capability gate or spend cap moves. The decision holds. Re-verified by `git log 3b5412963..f93586b9e -- <verified_paths>`.
