---
id: ADR-2131
title: Diagram review runs on a ledgered cadence with a gated, budget-capped Gemini audit
date: 2026-10-06
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: e2b49adfc22f60123a33c85fb9f456782c557b39
verified_paths: [skills/sealmap-review/scripts/review-cadence.cjs, skills/sealmap-review/scripts/external-review.cjs, skills/sealmap-review/scripts/review-context.cjs, skills/sealmap-review/scripts/merge-findings.cjs, skills/sealmap-review/run-cron.sh, skills/sealmap-review/crontab, schema/agentbox.toml.schema.json]
owner: jjohare
review_trigger: the first month of real Gemini spend (compare ledger cost with the estimate); a change to Gemini or Z.AI pricing; a GLM model change behind [consultants.zai]; a second corpus joining repos
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: ADR-2130 (external review is a transport outside [model_routing]; seal review is cross-family); ADR-2057 (a supervised program gated on a manifest key); ADR-2053 (Z.AI egress); ADR-039 (honest apply classes); ADR-2122 (a program holds a role only when it holds a secret file)
---

# ADR-2131 — Diagram review runs on a ledgered cadence with a gated Gemini audit

## Scoped source check — 2026-11-09

Shared composition changes add gated StatCraft (rebuild-class catalogue),
update pinned VisionCraft/dependency packages, and replace the bounded .local
tmpfs with a named volume. Nested OpenCode/code-server volumes retain their
identities. Codex remote startup stays manual; the removed feature flag is
not written. This does not widen listeners, authority or retrieval geometry.
The local-home migration fixture, 26 persistence/delivery tests, 25 supervisor
checks, 13 boot checks, manifest validation and port/listener gates pass.
See [local storage migration](../developer/local-home-storage.md). Runtime
acceptance remains separate; existing status axes and open limitations remain.

## Amendment — quality findings consumer, 2026-11-03

The cadence and merge reports now hand unverified findings to VisionCraft
(ADR-2165), the independent successor to build-with-quality. Only the named
consumer changes here; selection, accounting witnesses, reservations, settlements
and paid-review policy retain their existing contracts. Source naming does not
assert a new cadence deployment or a paid run.


## Amendment — budget scope and interrupted shard processing, 2026-11-03

Verified in source and offline tests at `becd1f77c2c6f6aa72c90914bcfff45988ca63d8`.
Two external-review hypotheses reproduced as failing regressions: an explicit
`--repo` omitted other repositories' spend, and malformed output from a later
shard prevented earlier successful shards from settling. Both are repaired.
Activation remains staged; these checks do not establish live deployment.

1. `--repo` selects work, while Gemini's monthly cap uses all resolved configured
   or discovered repositories plus explicit invocation repositories, deduplicated
   by canonical path. Previously observed repositories stay in scope even after
   exclusion, corpus disappearance or checkout removal.
2. A monthly private witness outside the reviewed working trees records canonical
   repository paths and ledger prefix lengths/SHA-256 hashes under
   `$XDG_STATE_HOME/sealmap-review/` (default `~/.local/state/sealmap-review/`).
   The append-only JSONL ledgers remain the only spend records. A valid append can
   settle a reservation for less than its estimate; ledger rewinds, rewrites,
   disappearance and unreadable/corrupt witness state make accounting inconclusive
   and stop paid work. A 0600 file is atomically persisted in a 0700 directory
   after each reservation, before generation, and after settlement. Status and
   dry runs read without updating the witness. Preserve this state across rebuilds.
3. Per-shard generation and all manifest, findings, lens and usage processing
   share the failure boundary. Successful shards settle against their retained
   per-shard evidence before subsequent calls. A later shard failure retains its
   estimated charge and error; it cannot cause a completed shard to be purchased
   again merely because the combined report failed. Witness persistence failure
   after a success stops further calls without charging a second settlement.

The witness detects ordinary Git rollback after observation. It cannot reconstruct
history already missing at first adoption or constrain an operator able to alter
both the ledger and private state. This is local conservative accounting, not
provider invoice reconciliation. Recovery preserves evidence and restores the
observed prefix; deleting history or the witness is not a supported reset.

Validation: all 89 `skills/sealmap-review/scripts/*.test.cjs` checks passed,
including later malformed manifest and usage results, configured/discovered scope,
alias deduplication, actual Git checkout rollback, equal-length rewrite, missing
remembered checkout, settlement refunds and failed witness persistence. The six
witness controls passed again after adding the symlink-parent containment guard.
The cron configuration suite passed 21 checks; syntax and whitespace checks passed.
All provider responses were offline fakes; no paid model calls were made.

## Amendment — review evidence and unresolved work, 2026-11-03

Source and offline tests verified at `7bfaa18a2`. This amendment replaces the
previous consequence that triage Markdown alone was the open queue. It changes
no provider endpoint, credential scope, manifest schedule, pricing or budget.
Activation remains staged until the rebuilt image is observed running this code.

1. **Keep outcomes distinct.** Model output remains an unverified hypothesis.
   Malformed/incomplete findings, ambiguous triage verdicts and truncated replies
   are inconclusive. An empty review requires an explicit first-line
   `NO_FINDINGS` response and successful transport completion; quoted examples
   cannot satisfy it. Rejection requires counterevidence, not a failed setup.
2. **Preserve the observation.** Exact diagrams-only packs, replies and manifests are
   retained under `docs/review/runs/`, including partial runs. Source-bearing
   triage prompts/replies stay in gitignored `.diagram-review/triage/` with
   0700 directories, 0600 files and a checked ignore rule before source writes.
   The ledger carries path/hash references; these bytes are private evidence,
   not part of the publishable report corpus. New finding origins
   record full corpus revision, tracked dirty state, pack/scope hashes, register
   mode, model/provider, run identifier and prompt hash. Pre-call source snapshots
   remain distinct from later repository changes. A changed paid-review pack
   does not settle its reservation as a successful audit.
3. **Compare only comparable reviews.** Direct claim matches count as agreement
   only for matching pack bytes, topic scope and register mode, with recognised
   distinct model families. Filenames and transitive similarity are insufficient.
   Historical findings without provenance remain readable and uncorroborated.
   Numbered reruns are selected in date/sequence order. Agreement ranks claims;
   it establishes neither their truth nor an independent semantic verification.
4. **Retain open triage.** Per-topic results and hashes in the existing ledger
   reconstruct the queue; earlier Markdown re-author lists import as open
   hypotheses. Quiet ticks retain flags without spending again. Editing a flagged
   topic triggers a check against current cited-source snapshots, not an empty
   diff. Only a subsequent unambiguous NO clears it; clipped or unavailable
   context remains pending. A paid audit refuses shards with pending flags.
   An empty queue is not a source-fidelity certificate.
5. **Refuse unknown accounting.** Missing history is distinct from unreadable or
   corrupt history. Torn rows, invalid costs and unavailable accounting stop paid
   work. Diagnostic status remains readable and reports the uncertainty. Raw
   history is preserved for evidence-based repair; deleting it to reopen budget
   is not recovery. Complete EOF rows without a newline can still be appended.
6. **Use one disposition validator.** `review-cadence.cjs receipts` delegates
   `init`, `check` and `summary` to the Sealmap Rust `review` CLI. It preserves
   exit codes and treats an unavailable binary as unavailable. Adjacent hashed
   receipts leave original findings intact and distinguish source, tested,
   merged, published, adopted and deployed evidence. Scheduled hypothesis
   generation needs no receipt to exist. No extra database or JavaScript
   disposition validator is introduced.

Validation: `node --test skills/sealmap-review/scripts/*.test.cjs` passed 76
checks; the final quoted-sentinel regression rerun passed all six integrity
checks. `tests/config/diagram-review-cron.test.sh` passed 21 checks and the estate
skill lint passed. Provider responses in tests are fakes: this is not a live
GLM/Gemini run or proof of deployment. The generic skill-creator validator rejects
the skill's unchanged `compatibility` and `related_skills` frontmatter extensions;
the repository's own skill validator accepts them.

The shared investigation method remains
[`build-with-quality/references/review-evidence.md`](../../skills/build-with-quality/references/review-evidence.md);
[`review-receipts.md`](../../skills/sealmap-review/references/review-receipts.md)
describes the concrete receipt workflow. Runtime consumer release/pin verification
belongs to the Sealmap integration checkpoint, separately from these source tests.

## Scoped re-verification — 2026-10-31

Reviewed the governed-path delta since the previous verification: only the
operator user-cron gate, devuser supervisor block, rebuild-class catalogue entry
and its boolean schema registration changed. Existing capability, identity,
storage and network contracts are unchanged. Preflight, manifest validation,
25 role-isolation supervisor checks and the user-cron schema regression pass.
This does not promote any activation status or claim a live role-isolation rehearsal.

## Re-verification — 2026-10-29 at 3b498088e (ADR-2153 cutover)

Reviewed the governed-path diff from this record's previous verification to
`3b498088e5a35e78158a9eb8d6f0266996d31f82`. Shared manifest, schema, supervisor and bootstrap changes
are scoped to the owned session plane: AoE and its token consumers retire,
provider provisioning moves, and session status hooks are added. Other named
capability sections and their status axes retain their existing claims.
Validation: session-plane tests (44 unit, 15 integration), manifest projector
suite and Clippy for both crates, proxy selftest (zero failures/skips), hook
registration (12), role-supervisor isolation (25), boot projection (13), and
manifest catalogue/declared-state checks pass locally. This does not claim new
runtime acceptance of this record's unrelated capabilities.

## Context

`sealmap-review` is run by hand. The expensive step, Gemini 3.8 Flash at high thinking over a 140k to 630k token pack, is the one nobody should run on a whim, and the drift it should catch accumulates unseen between runs. GLM on Z.AI is cheap enough to watch every change. Without a rule the choice is a forgotten corpus or an unbounded bill. Local numbering: this repo's last record is ADR-2130 and the host's ledger stops at ADR-2128, so 2131 is free in both.

## Decision

A manifest section `[diagram_review]` gates `[program:diagram-review-cron]`. The shipped `agentbox.toml` sets `enabled = true` (owner decision 2026-10-06), so the program is baked at the next rebuild; the flake's default for a manifest without the section is off: supercronic over `skills/sealmap-review/crontab`, a template that `run-cron.sh` renders at boot from the manifest schedules into `/run/agentbox`. When disabled the flake emits no program block. The runner is `skills/sealmap-review/scripts/review-cadence.cjs`:

- **Repos are discovered, never named in the manifest.** `repos = []` means scan `$WORKSPACE` to depth 3 for `docs/diagrams/<area>/NN-*.md`, skipping `.tmp`, `node_modules`, `target`, dot-directories and linked git worktrees (a `.git` file pointing into `…/worktrees/…`; submodules are still found), one entry per realpath. The manifest is public and the corpora are private, so extra and excluded paths live in the gitignored `config/diagram-review.local`.
- **Change is detected per source repository.** Each cited path is resolved from the corpus root by realpath (a workspace symlink and the real path are one file) and attributed to the innermost git toplevel that owns it (a nested submodule is its own repository, not a gitlink bump in its parent). The ledger keeps a map of last-seen commits per repository. A missing sibling or a dangling link is a logged skip.
- **Reviews are sharded by area** (large areas split at 150k tokens). The pack-hash skip, the change thresholds, the interval and the budget apply per shard; the Gemini gate takes changed shards most-changed first, within budget.

- **Triage (GLM, daily).** A topic is a candidate when a file in its `sources:` changed since the commit recorded for that file's repository by the last triage, computed per file and unioned over the window, with no narrower rule: symbol, region, call-flow and line-overlap narrowing each lost real changes in the sealmap evidence programme, and only per-file flagging kept recall 1.0. One bounded call per candidate asks whether the topic is now wrong; unsure or failed means yes. Output is `docs/review/<date>-triage.md`. Topics are never edited.
- **GLM review (nightly, 02:47 UTC, after the 01:00 dream window).** GLM is effectively free, so both GLM passes run daily (triage 05:17); the per-shard pack-hash skip keeps unchanged shards at no cost, and repeated identical skips are ledgered once. The Gemini gate is read on this tick, and its per-shard interval still limits Gemini to one audit a week per shard. The critical and premortem lenses with GLM as reviewer, per shard, skipped when the shard's pack sha256 equals its last GLM review's. High-severity findings are counted in the ledger.
- **Gemini audit (gated, per shard).** A shard runs only when every condition holds: at least `gemini_min_interval_days` (7) since the last audit; at least `gemini_min_changed_topics` (3) topics changed since it, or the last GLM review recorded a high-severity finding; and month-to-date spend plus a `countTokens`-based estimate within `gemini_monthly_usd` (10). A high-severity finding opens the topic condition only, never the interval or the budget.
- **Ledger.** Each repo's `docs/diagrams/review-ledger.jsonl` is append-only, one line per run including every refusal with its reason. Interval, spend and pack-skip decisions are read from it and from nothing else. A failed Gemini generation is booked at its estimate, because a timed-out call may have been billed.
- **Findings** go to `docs/review/<date>-<reviewer>.md` and `.json`, `status: unverified`, for build-with-quality.

Gemini is priced from constants dated 2026-10-06 (input $0.75/M, cached $0.075/M, output including thinking $3.75/M). GLM is billed under the Z.AI plan and counts as zero against the Gemini cap.

## Consequences

- The expensive reviewer is rare by construction, and the cap holds across all configured repos. The cost is a bounded daily GLM bill and findings that arrive without being asked for.
- The estate corpus is about 850k tokens across 139 topics and 16 repositories; sharding keeps each pack inside GLM and Gemini limits at the price of cross-area contradictions being seen by no single reviewer.
- Nothing edits a topic or commits. The runner dirties the reviewed repo with the ledger and `docs/review/` files; the owner commits them.
- Historical policy, replaced by the 2026-11-03 amendment: the triage window advanced every run and Markdown files alone held the queue. The ledger now retains outstanding per-topic results and imports those historical lists.
- The program holds no secret file, so it takes no ADR-2122 role. It inherits `ZAI_ANTHROPIC_API_KEY` and `GEMINI_API_KEY` from the container environment, as podcast-cron does.
- `enabled` is rebuild-class (baked supervisor text). Schedules, thresholds, budget and repos apply on a program restart.
- `GEMINI_API_KEY` is an uncapped key: the cap is this runner's, not Google's. Anything else spending on it is invisible to the ledger.
- **Rejected:** a daily Gemini audit (cost with no new information); running the gate in the manifest projector (the ledger is per repo and the runner already reads it); a global budget file outside the repos (a second source of truth beside the ledger).

## Verification

### Host adversarial review, 2026-10-06

The host review found that cached-input assumptions and unbounded model output did not
enforce the advertised budget. Audits now reserve both lenses at uncached rates with an
enforced 30,000-token output ceiling per lens, before generation. A settlement replaces
the matching reservation; interrupted or unreadable results retain the reservation.
The CLI serializes multi-repo audit decisions with a kernel flock and refuses model
overrides whose pricing is not represented. The runner is baked under `/opt/agentbox/skills`
and the supervisor sets UTC explicitly. Pricing was checked against Google's live page;
the introductory rates need review before 2027. Regression tests cover reservation
settlement and interruption during output processing. Provider credentials remain in the
existing ADR-2122 DEVUSER_CLASS exception; no sovereign key is introduced.

`implementation_status: complete` and `activation_status: staged`. At `cc5f5dcc0`: `node --test` in `skills/sealmap-review/scripts` (37 cadence cases (discovery with symlinks, depth and skipped directories; the gate; per-shard pack-hash skip and sharding; multi-repo change detection with symlinked spellings, a nested submodule, a missing sibling and a dangling link; subcommands with faked model calls) beside 15 external-review cases), `bash tests/config/diagram-review-cron.test.sh` (21), `semantic-rules.test.js` for `E079`/`W076`, `skills/lint-skills.sh`, the role-isolation suites and `cargo test` in `services/agentbox-manifest`. Known red, not caused here: `declared-vs-running` now also lists diagram-review as declared on but not running, because the committed runtime snapshot predates the program; it clears when the snapshot is recaptured after the rebuild. Not run: `nix flake check` (no Nix in the authoring container), so the supervisor block is checked by text, not evaluation; and no live GLM or Gemini call, so the Messages-API request shape and the Gemini price constants are unverified against the real services. The image is unverified until the host `./agentbox.sh rebuild`.

## Re-verification — 2026-10-07 at cca7ea3b151be3ea44907581d40271c714b07dd0

Three commits since `09a024b12` touch `review-cadence.cjs` and `crontab`; `run-cron.sh` and `schema/agentbox.toml.schema.json` are unchanged. `93282583f` deletes `sealmapStale` and the optional `sealmap stale --since` narrowing from `triage`, leaving per-file flagging as the single path, as the Decision's "with no narrower rule" already states. The `review_trigger` clause about that output format therefore has nothing left to trigger. `88bd2a666` adds a `merge` subcommand over `merge-findings.cjs`. It ranks findings that both families raised first and writes `docs/review/<date>-merged.{md,json}`, with no ledger, gate or budget effect. `feb608318` implements what the "Host adversarial review" section records. Each audit reserves both lenses at the uncached input rate plus `ER.MAX_OUTPUT_TOKENS` before generation, and books an `audit-reservation` line that a settlement replaces. `actualGeminiUsd` refuses incomplete or invalid usage. `countTokens` takes the larger of the two lens packs. `flock` serialises `audit-gemini`. Any model other than `gemini-3.8-flash` is refused. `LOCAL_FILE` resolves under `$WORKSPACE/project/agentbox` when the runner is baked, and the crontab calls `/opt/agentbox/skills/...`. The gate, interval, threshold, cap and booking of failed calls at the estimate all hold. `node --test` in `skills/sealmap-review/scripts` gives 66 (cadence 42, external-review 15, merge-findings 9), and `tests/config/diagram-review-cron.test.sh` gives 21. The decision holds. The obsolete `stale --since` review trigger is removed.

## Re-verification — 2026-10-13 at `044f1d689`

The decision holds. Every claim below was checked against the code, and the tripped hunks are unrelated to it.

Claims checked:

- [diagram_review] manifest section gates [program:diagram-review-cron]; shipped enabled=true, flake default off
- gemini_min_interval_days 7, gemini_min_changed_topics 3, gemini_monthly_usd 10; triage 05:17 and review 02:47 UTC; weekly_window semantics
- repos=[] means auto-discover
- schema declares the keys and rejects unknown ones
- cadence runner behaviour (37+ cadence cases, 21 cron-wrapper tests)

Evidence:

- schema/agentbox.toml.schema.json diff: 8 insertion hunks, none mentions diagram_review/gemini/weekly (grep empty); the diagram_review schema object at 218dc12c3 has additionalProperties:false and the eight keys with matching descriptions
- agentbox.toml@218dc12c3 [diagram_review]: enabled=true, repos=[], glm_triage_cron "17 5 * * *", glm_review_cron "47 2 * * *", interval 7, changed 3, usd 10, weekly_window true
- skills/sealmap-review: git diff --stat empty in range
- cd skills/sealmap-review/scripts && node --test → 66 pass, 0 fail (cadence 42, external-review 15, merge-findings 9)
- bash tests/config/diagram-review-cron.test.sh → 21 passed, 0 failed
- flake.nix:2891-2902 area gated by diagramReviewEnabled (per 2026-10-07 re-verification; flake hunks in range are elsewhere)

Commands run: `node --test (sealmap-review/scripts); bash tests/config/diagram-review-cron.test.sh`

Not checked, and notes: The schema delta is entirely other sections (+173 lines) and does not touch diagram_review. Live GLM/Gemini calls and Nix evaluation not run (no keys / no Nix); ADR itself says those are unverified. Known-red in the ADR (declared-vs-running) is outside this check.

Checked at `218dc12c3` by reading each claim against the code, not by the staleness diff alone. Stamped at `044f1d689`, which adds only the gate fixes in `config/custody/env-classes.json`, the `check-manifest-catalogue` baseline, `services/agentbox-vex`'s README and licence notice, a stale `agentbox.toml` comment, a stale `paths` example in the ontology-augment docs, and the grounding test's stub.

**Re-verified 2026-10-16 at `efa293b8799b`.** The only change to a governed path is the sidecar-first Blender work (ADR-2142): `agentbox.toml` gains `[skills.spatial_and_3d].blender_local = false`; `flake.nix` narrows one `lib.optionals` condition (`wrapGpuBin pkgs.blender` now needs `blender && blender_local`), adds one `ENABLE_BLENDER_LOCAL` env line and reworks a comment; `schema/agentbox.toml.schema.json` gains the `blender_local` boolean; `management-api/lib/system-manifest.js` gains a `blender-local` catalogue entry and a corrected `blender-mcp` summary. Only the unrelated spatial schema property is added; the diagram-review cadence and its gates are untouched. The decision holds. Re-verified by `git diff <previous verified_commit>..efa293b8799b -- <verified_paths>`; no re-implementation was needed.

**Re-verified 2026-10-17 at `e8d59c23c`.** The only change on a governed path since the previous verification is the flat-vault pages default (agentbox `a2c6d5520`, ADR-2028 amendment; Ontomark ADR-OM-007): `[vault].pages = "."` in `agentbox.toml` and the default manifest, the schema default and description for that key, the entrypoint deriving `VAULT_PAGES`/`VAULT_WORKING_PAGES` from it, and the ontology skills' corpus-verb names (`ontomark find|retrieve|tree`). None of it touches this record's decision. Re-verified by `git diff efa293b87..e8d59c23c -- <verified_paths>`; no re-implementation was needed.

Re-verified 2026-10-17 against `f33c4fc030d199ce957f7ba274d428bc6475c159`: the governed-path delta from the flat-vault amendment is the DeepSeek model/default and MCP metadata refresh plus ownership reconciliation for the OpenCode state directory. The reviewed change preserves this record’s capability, identity, memory, vault and isolation invariants; status axes are unchanged.

Re-verified 2026-10-20 at `653b8b6387470eaa3be6c20e6dbd2208e538a985`: reviewed the merged activity-sink registration in the root entrypoint and profile projector, its default-off manifest gate, schema and boot-class catalogue entry. The hook remains inactive; no sink URL, token or new prompt egress is configured. The independent managed floor remains on. Claude Code 2.1.304 and Codex 0.163.0 change pinned CLI resources, not the Jev/factrail hook protocol; their existing replay mechanisms are unchanged. Activity-sink and hook-registration tests pass (50), the Rust projector suite passes (196), manifest validation and all 95 catalogue gates pass, and the generated egress register is in sync. No changed ingress binding, mount, role isolation, retrieval geometry or adapter dispatch. Build and activation checks remain pending. Existing status axes are retained.

### Re-verification — 2026-10-29 (linked-worktree skip)

`21769a881..d1dd896f4`: `review-cadence.cjs` gains `isLinkedWorktree()`, and discovery skips a directory whose `.git` file points into `…/worktrees/…` (a second checkout of a repo already reviewed; one run had reviewed and written into an unfinished task branch). Submodules (`.git` file into `…/modules/…`) are still found. The discovery rule in the Decision now reads "skipping … and linked git worktrees". Everything else in the record stands. Re-verified by `node --test` in `skills/sealmap-review/scripts` (a new case covers a linked worktree and a submodule) and `git diff 21769a881..d1dd896f4 -- skills/sealmap-review/scripts/review-cadence.cjs`.


Re-verified 2026-10-29 at `00039efb1e4a70402df86ad19cf76894fe3b9a8f` for ADR-2155. Reviewed the typed-decision activation diff against this record: the changed manifest, bootstrap, catalogue or source-pin hunks do not alter its governing boundary. Existing status axes and runtime evidence limits are retained. No image or service activation is claimed.

Re-verified 2026-10-30 at `cd3a29899`: the delta in schema/agentbox.toml.schema.json is [system_one] only (new `network` and `local_only` properties; `bind` admits 0.0.0.0/RFC 1918); management-api/lib/system-manifest.js gains one entry, `system-one-network`; scripts/agentbox-config-validate.js changes only the [system_one] E080 bind rule. This record's sections are untouched.

Re-verified 2026-10-30 at d0e9ca786: the only change to the governed paths is the new `[system_one].skill_list_at_least` key and its schema property (router runner-up listing, ADR-2091); no section this record governs changed.

## Re-verification 2026-10-30

`f7aa7f68e` changes one governed file, `skills/sealmap-review/scripts/review-cadence.cjs`: the GLM triage
output cap goes from 1,500 to the review path's 32,000 (`GLM_TRIAGE_MAX_OUTPUT_TOKENS`). GLM thinks by default
and the thinking counts against the cap, so at 1,500 most triage calls returned empty; a rerun at 32,000 over the 36
failed topics gave 0 empty replies in 26 calls. The decision is unchanged: cadence, sharding, both GLM passes and the
gated Gemini audit are as recorded, and this record never fixed the triage budget. Tests: 43/43 in
`review-cadence.test.cjs`, one new assertion pins the cap. Takes effect at the next image rebuild.

Re-verified 2026-10-31 at `b65c3d4ed`. Governed paths changed: `schema/agentbox.toml.schema.json`: the `[vault].working` description says pages sit at the working root (`f4beec643`). No section this record governs changed; the decision holds. Re-verified by `git diff f7aa7f68e..b65c3d4ed -- <verified_paths>`; no re-implementation was needed. The image carries it at the next rebuild.

Re-verified 2026-10-31 at `97f298db5`: the only delta on this record's governed paths since the previous verification is the sprint-W7 additive work (ADR-2139 Decision 5 `state_budget_tokens`; ADR-2090 `bypass_projects`): new optional keys that default to today's behaviour, in schema/agentbox.toml.schema.json. None of it touches this record's decision. Re-verified by `git diff 753788564..97f298db5 -- <governed paths>`; status axes unchanged.

## Re-verification — 2026-10-31 (`1e41b64b624af97cf49771d08da82fbf3743acbd`)

Tripped by the W8 ADR-sprint changes. Governed-path delta since `753788564`: `schema/agentbox.toml.schema.json` widens the `model_routing.routes` host pattern to `claude|codex|loom|zai` and adds those four keys (ADR-2130). No key, table or code path this record decides is touched, so the decision and status axes are unchanged. Judged from the diff (re-runnable: `git diff 753788564..1e41b64b6 -- skills/sealmap-review/scripts/review-cadence.cjs skills/sealmap-review/run-cron.sh skills/sealmap-review/crontab schema/agentbox.toml.schema.json`; re-run at integration and the summary above matches it), not by re-running this record's own acceptance checks.

Re-verified 2026-10-31 at `2f15c531b02b8f8393d68d29ce3491712bdd862c` (W7 and W8 integration, `adr-sprint/w78`). Governed-path delta since `97f298db5`: `schema/agentbox.toml.schema.json`: the `model_routing.routes` host pattern widened to `claude|codex|loom|zai` with four route keys (ADR-2130), and the `bypass_projects` item pattern forbidding `[` and `]` with its description scoped to skill routing (ADR-2090). Read from the diff and checked against the merged tree's gates (cargo, jest, validator); nothing it changes is a key, table or code path this record decides, so the decision and status axes are unchanged. Re-run: `git diff 97f298db5..2f15c531b -- schema/agentbox.toml.schema.json`.

## Scoped source re-verification — 2026-11-03

Verified source commit `c1b0c700c42596d35a1faba3074b667c1928d8fb`.

The cadence and merge scripts change only explanatory/report text from build-with-quality to VisionCraft. Selection, paid requests, reservations, settlement and integrity-witness logic are unchanged. The schema changes only AQE/Deepsec descriptions and the optional Deepsec output cap, outside the cadence configuration. All 89 cadence/context/merge tests pass. The previous budget repairs and staged activation remain as recorded; no paid cadence run occurred.

Re-verified 2026-11-05 at `3beca506c` for ADR-2177: the only change to this record's governed paths since its last stamp is ADR-2177's additive SuperSplat hunk (a gated package set and supervisor block, one toml/schema key, a skill registration); this record's decision is unaffected.
