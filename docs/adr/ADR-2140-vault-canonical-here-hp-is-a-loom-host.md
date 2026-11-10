---
id: ADR-2140
title: Keep the vault canonical on this host, reconcile the HP Loom to it at every boot, and retire the HP agentbox
date: 2026-10-13
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 571c0ad436230a4ff3d0da4c0e344282417ba259
verified_paths: [scripts/hp-loom-reconcile.sh, config/entrypoint-unified.sh, agentbox.toml, management-api/lib/system-manifest.js, schema/agentbox.toml.schema.json, tests/config/hp-loom-reconcile.test.sh, skills/ontology-augment/scripts/ontology-augment.sh, tests/skills/ontology-augment-grounding.test.sh]
owner: jjohare
review_trigger: a reconcile failure or change to the builder pin or published-generation schema; any proposal to run an agentbox on the HP again; any proposal for the HP to read the vault directly; a second consumer of the built generation
repo: agentbox
---

# ADR-2140 — Keep the vault canonical on this host, reconcile the HP Loom to it at every boot, and retire the HP agentbox

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

## Scoped source re-verification — 2026-11-03

Shared-file changes add pinned VisionCraft and direct AQE registration, retire
the unused precedent-bridge default, and extend governance custody/config
scrubbing. This record's own mechanism is retained; existing partial/staged
limitations and historical receipts are not promoted to new runtime acceptance.

Evidence: [rebuild verification receipt](../estate-closeout/adr-reverification-2026-11-03.md).
This verifies the scoped source amendment, not new whole-record runtime
acceptance. Decision, implementation and activation statuses are unchanged.

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

The vault source is the `visionGraph` git repository on this host (`[vault].repo`, ADR-2028). On
2026-10-13 the HP held no copy of it. It held the Loom's *built* bundle (`~/githubs/loom/data`,
generation `visionGraph@45976a8c7`), served by `loom-facade-a`, and a user timer
(`loom-generation-reload`) that verifies and reloads whatever lands in `data/`. A Logseq-era copy had
drifted on this host (`workspace/vault`, `workspace/vault-working`, 2.2 GB, untouched since
2026-09-02), and the HP ran a second agentbox (`docker-compose.hp.yml`) built for federation work
that was drifting from this node.

loom ADR-141 fixes a generation's identity as `visionGraph@<sha>` plus a content digest; loom ADR-135
and ADR-136 D4 require that a generation is never half-written. Loom's own
`docs/published-generation-reload.md` already documents the pipeline that produces one: build from a
clean checkout with a released `ontomark`, promote and verify the bundle, copy it to the HP under an
in-flight marker without `--delete` (the directory also holds `ledger.jsonl`), and let the HP timer
reload. It was a manual procedure, which is why the HP drifted behind the vault whenever nobody ran
it. An earlier draft of this ADR proposed an NFS export so the HP could build from the vault. That was
withdrawn on reading that procedure: the HP has neither `ontomark` nor a use for the vault, and
exporting the object store would have exposed every committed `working/` page to it.

## Decision

1. **D1 — One canonical vault, here.** The `visionGraph` repository on this host is the only source.
   Nothing on the HP, and no stale local directory, holds a second copy. `[vault]` stays the single
   path authority.
2. **D2 — The HP serves a built generation, never the vault.** The only thing that crosses to the HP
   is the output of `ontomark build` for a *committed* HEAD, after `promote_vault_build` and the
   `reload_published_generation verify` check have passed. The HP never reads the repository, so the
   private `working/` pages and the git history stay on this host.
3. **D3 — Automate the documented pipeline; add nothing to it.** `scripts/hp-loom-reconcile.sh` does
   exactly what the loom document describes. It compares the vault HEAD with the id the Loom serves at
   `/loom/generation`. If they agree it does nothing at all (no build, no ssh, no Loom recreate). If
   they differ, in `full` mode, it builds HEAD from a clean **detached worktree** (so uncommitted edits
   can never be served), promotes and verifies, streams the bundle to the HP, swaps it into `data/`
   under the in-flight marker with a `data.rollback` copy and a restore-on-error trap, starts the HP's
   own verifying reload, and waits for the Loom to serve the new id. A bundle that does not verify as
   `visionGraph@<HEAD>` is never sent.
4. **D4 — A rebuild reconciles implicitly.** The entrypoint (Phase 5d(iii)) prints the previous
   receipt and starts the script in the background on every boot, so rebuilding the image re-checks,
   updates and reconnects the HP without a step to remember. It is fail-open: every problem is recorded
   in `~/.local/state/agentbox/hp-loom-reconcile.json` and the script exits 0; a `timeout` bounds a
   wedged ssh or build; a lock allows one run at a time. `[vault].loom_sync` is `off | check | full`;
   `loom_url` and `loom_host` carry the estate addresses, so the script hardcodes none.
5. **D5 — Retire the HP agentbox.** `docker-compose.hp.yml` and `docs/developer/hp-peer-node.md` are
   deleted. The HP node's `agentbox-core` pubkey is removed from
   `[interaction_plane.proxy].allowed_pubkeys`, because that identity was destroyed with its volumes.
   Federation work restarts from a clean node under a new record if it resumes. The dream-engine annexe
   (ADR-052) is a separate SSH working directory and is unaffected. On the HP itself, the agentbox and
   campaignbuilder containers, volumes, images and checkouts were removed on 2026-10-13 after confirming
   the campaignbuilder history was on GitHub and the HP ruvector database was empty.
6. **D6 — Use the Loom's live `/mcp`.** loom ADR-140 phase P0 is shipped and answering on `:8084`.
   `skills/ontology-augment` calls `loom.neighbours`, `loom.paths` and `loom.browse` over it, resolves a
   page title by exact title match through `loom.browse` (never by slugifying), counts the real result
   shapes, and falls back to `vault tree` only when the Loom did not answer. The owner overrides loom
   ADR-140's P1 measurement gate to start P2; that override is to be recorded in the loom repository's
   disposition and is not yet (see Consequences).

## Consequences

- One source and one write path: nothing on the HP can diverge, and a generation id names exactly one
  commit. A vault edit reaches the Loom only after it is committed, and then only at the next boot or
  the next manual run of the script.
- `ontomark` baked here is 0.2.0 while loom's `deploy/ontomark-release.env` pins the `v0.1.0-rc.1`
  asset (CLI 0.1.0). The reconcile does not enforce either pin; the promote and verify steps are the
  compatibility gate, and a bundle they refuse is never sent. Aligning the two pins is a separate
  change.
- A `full` run validates and builds for about two and a half minutes on this host. It runs in the background, so it never
  delays a boot, but the Loom lags the vault by that long after a rebuild that follows a commit.
- The reconcile needs `promote_vault_build` and `reload_published_generation` at `LOOM_BIN_DIR`
  (default `~/workspace/loom/target/release`) and a direct ssh path to `loom_host`. Without them it
  records `degraded` and does nothing.
- The loom repository still tracks `data/ontology-corpus.rvdb*`, which dirties the HP checkout on every
  promotion. Untracking them, amending loom ADR-140's status and recording the P1-gate override are
  loom changes, not yet made. The reconcile never runs `git pull` on the HP, so it is unaffected.
- ADR-2118 and ADR-2122 list `docker-compose.hp.yml` in `verified_paths`. Their decisions stand; their
  staleness is cleared by the ADR-pack re-verification.

## Verification

- HP inventory, 2026-10-13: no vault copy, no Logseq tree and no GitHub data sync existed on the HP;
  the only recurring job was `loom-generation-reload.timer`; `loom-facade-a` was healthy before and
  after every removal.
- A snapshot build of the committed HEAD from a detached worktree took 2 min 16 s, promoted 9,244
  records in 6 s and verified as `visionGraph@45976a8c7…`: the id and class count the HP already
  serves. The content digest differs from the one the HP serves (`a5bdcdbb…` against `5080a0b4…`),
  which fits the baked `ontomark` 0.2.0 against the pinned `v0.1.0-rc.1` that built the HP's bundle.
  Identity matches; the bytes do not, so the pin mismatch below is real, not cosmetic.
- `tests/config/hp-loom-reconcile.test.sh`: 41 passed, 0 failed, against a stubbed `ontomark`, Loom
  binaries, `ssh` and Loom. It covers idempotence, fail-open for every failure, the clean-worktree
  guarantee, the `validate` gate, the settled-commit guard (a test caught a path bug in it), nothing
  uploaded on a promote refusal, the HP-side verify before any swap, the restore trap, the lock, and no
  hardcoded estate address.
- A live `--mode full --force` run against a scratch copy of the HP's `data/`
  (`LOOM_HP_DIR=scratch-reconcile-20261013`) exercised the real tar stream, the swap over the HP's
  fish login shell, the HP's own `reload_published_generation verify` and `rsync`: all ten steps
  recorded, the scratch `.generation.json` rewritten, `data.rollback` present, no `data.<sha>` or
  in-flight marker left behind, and the live `loom-facade-a` `StartedAt`, reload receipt and
  `data/` untouched. It proves transport, HP verify and swap; it does not prove a reload, because the
  Loom already served HEAD.
- `scripts/hp-loom-reconcile.sh --mode check` against the real Loom and vault: `current`, with the 13
  uncommitted files correctly ignored.
- `tests/skills/ontology-augment-grounding.test.sh`: 86 passed, 1 failed. The failure (`validate:
  still enveloped with generation`) also fails on `main` and is not caused by this change.
- Deployment, 2026-10-13: the Nix image at `acb59a3fc` built, passed offline smoke and
  booted successfully. At 11:45:39 UTC the baked entrypoint wrote a fresh `mode: full`,
  `state: current` reconcile receipt for `visionGraph@45976a8c7ca4305dd38bf66c7c6128732f6de4d7`.
  The 13 uncommitted vault files were left unchanged. The HP Loom container id and start time,
  and its `.generation.json` checksum, matched the pre-deployment snapshot; its reload timer
  remained active. All 32 Agentbox mounts and 16 sidecars were preserved.
- The baked ontology skill answered a live `neighbours "Knowledge Graph"` request through
  the HP's MCP door, citing that same generation. Reconcile tests passed 41/41 and grounding
  tests passed 87/87. That deployment verified the idempotent current-generation path.
- Deployment, 2026-10-14: the image at `c8bd9b647` booted and its full reconcile wrote
  `state: reloaded` at 10:18:18 UTC for the new committed generation
  `visionGraph@6502d264ca3569a53d69e21544a20e212bb7b100`. All ten steps completed:
  probe, tools, validate, build, promote, verify, ship, HP verify, swap and reload.
  The 14 uncommitted vault files present at the probe were excluded from the snapshot.
  The HP's own receipt reports `served`, with content digest
  `1fa40db986b9f4472f3dc2c23e14bdd91e7dba9045b3c2a018e26955d2351b54`.
  Its recreated Loom container is healthy, `data.rollback` is retained and the promotion
  marker is cleared. The live generation reports no drift, and the baked ontology skill
  answers through MCP while citing the new generation. Agentbox readiness has no degradation;
  all 32 mounts and 16 local sidecars remain preserved. This verifies the remaining production
  transition and completes the Agentbox implementation of this decision. The separate Loom
  follow-ups recorded under Consequences remain outside this repository.

**Re-verified 2026-10-16 at `efa293b8799b`.** The only change to a governed path is the sidecar-first Blender work (ADR-2142): `agentbox.toml` gains `[skills.spatial_and_3d].blender_local = false`; `flake.nix` narrows one `lib.optionals` condition (`wrapGpuBin pkgs.blender` now needs `blender && blender_local`), adds one `ENABLE_BLENDER_LOCAL` env line and reworks a comment; `schema/agentbox.toml.schema.json` gains the `blender_local` boolean; `management-api/lib/system-manifest.js` gains a `blender-local` catalogue entry and a corrected `blender-mcp` summary. No vault or HP-Loom key is touched. The decision holds. Re-verified by `git diff <previous verified_commit>..efa293b8799b -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-10-17 at `426b43250` (ontomark 0.4.0 repin, agentbox PR #31)

`lib/ontomark.nix` pins ontomark 0.4.0 (static CLI, sha256 `6f21e446…`), replacing the 0.2.0 noted under Consequences. 0.3.0 and later read the flattened visionGraph vaults (pages at the vault root, Ontomark ADR-OM-007), which visionGraph `main` has carried since 2026-10-16, so a 0.2.0 image would find no pages: the repin is what keeps D1's canonical vault readable here. The ontology-augment skill routes `find`, `retrieve` and `tree` to `ontomark`; `vault` remains for `propose` alone. D6 holds: the live Loom `/mcp` is still the primary route for `neighbours` and `paths`, and the corpus `tree` fallback fires only when the Loom did not answer, now via `ontomark tree` with `source: "ontomark"`.

`bash tests/skills/ontology-augment-grounding.test.sh`: 87 passed, 0 failed at `426b43250`. The decision holds; the image rebuild that bakes 0.4.0 is pending with the owner.

**Re-verified 2026-10-17 at `e8d59c23c`.** The only change on a governed path since the previous verification is the flat-vault pages default (agentbox `a2c6d5520`, ADR-2028 amendment; Ontomark ADR-OM-007): `[vault].pages = "."` in `agentbox.toml` and the default manifest, the schema default and description for that key, the entrypoint deriving `VAULT_PAGES`/`VAULT_WORKING_PAGES` from it, and the ontology skills' corpus-verb names (`ontomark find|retrieve|tree`). None of it touches this record's decision. Re-verified by `git diff 426b43250..e8d59c23c -- <verified_paths>`; no re-implementation was needed.

Re-verified 2026-10-17 against `f33c4fc030d199ce957f7ba274d428bc6475c159`: the governed-path delta from the flat-vault amendment is the DeepSeek model/default and MCP metadata refresh plus ownership reconciliation for the OpenCode state directory. The reviewed change preserves this record’s capability, identity, memory, vault and isolation invariants; status axes are unchanged.

Re-verified 2026-10-19 at `dfe78f0766e52ae6cfbae32c395e22c9590d6785`: Reviewed governed-path changes: the flake only repins the vault source; the entrypoint delta corrects the role-isolation class comment; the catalogue makes the baked privilege change rebuild-class. No ingress, retrieval geometry, capability gate, image-delivery or subsystem runtime configuration is changed by those deltas. Existing implementation and activation statuses are retained.

Re-verified 2026-10-19 at `52183d76fde866ab1f05aea524aeea33d8573c3f`: The reviewed flake delta adds the local-cuda-gated stable nvcc link, and the entrypoint/catalogue propagate and describe its scoped host compiler. Backend and wrapper gates pass (23 and 21 assertions); no ingress, role isolation, durable adapter, retrieval or subsystem gate is changed. Image evidence will be regenerated for the new layer closure. Existing status axes are retained.

Re-verified 2026-10-19 at `3acd4fa08f06e2c4543debd46f0ce51605033d3e`: the reviewed delta adds the collaboration and welfare floor (ADR-2144) — one new manifest key `[claude_code].floor`, a floor block and managed-path projection in the entrypoint's instructions and Codex-append sections, two `instructions-project` flags in `agentbox-manifest`, and `config/hooks/decline-recorder.cjs`. No ingress, role isolation, durable adapter, retrieval, skill-routing or compaction mechanism this record governs is changed; its gates pass unchanged. Existing status axes are retained.

Re-verified 2026-10-20 at `61f27d5b375f9838ef7b7334e3f984d0d4a9ea70`: reviewed the governed-path delta for the managed floor (ADR-2144) and alpha.17 forge/proxy launcher (ADR-2145). The schema and capability catalogue now register these settings, with boot-class floor projection and rebuild-class forge/proxy changes. Bridge path dependencies use the same alpha.17 source as the server; the independent core-only registry dependency retains its upstream pin. Claude Code 2.1.304 and Codex 0.163.0 retain the full upstream package resources. Manifest validation, all 94 catalogue gates, 37 targeted Node tests, 12 instruction-layer assertions and skill lint pass. No ingress publication, adapter dispatch, retrieval geometry, mount or role-isolation gate changes. Build and activation evidence is pending; existing status axes are retained.

Re-verified 2026-10-20 at `653b8b6387470eaa3be6c20e6dbd2208e538a985`: reviewed the merged activity-sink registration in the root entrypoint and profile projector, its default-off manifest gate, schema and boot-class catalogue entry. The hook remains inactive; no sink URL, token or new prompt egress is configured. The independent managed floor remains on. Claude Code 2.1.304 and Codex 0.163.0 change pinned CLI resources, not the Jev/factrail hook protocol; their existing replay mechanisms are unchanged. Activity-sink and hook-registration tests pass (50), the Rust projector suite passes (196), manifest validation and all 95 catalogue gates pass, and the generated egress register is in sync. No changed ingress binding, mount, role isolation, retrieval geometry or adapter dispatch. Build and activation checks remain pending. Existing status axes are retained.


## Re-verification — 2026-10-21

The manifest diff only selects minimal thinking and a 20-minute cap for the final deepsec sweep; feature gates, identity policy, corpus paths and memory geometry are unchanged. Manifest validation, the 95 catalogue gates, 45 agent-reconciliation checks and 25 role-supervisor checks pass. This is source verification; image activation and live checks remain separate deployment evidence.

Re-verified 2026-10-22 at `0382cc4b5e34f75a62184bf350f865533010dc52`: reviewed the delta adding an independent, opt-in Isaac Sim lifecycle and live-class service catalogue entry, the 130th routed skill, pinned regional ComfyUI nodes/model metadata, and Blender background Python failure propagation. Existing ingress, role isolation, instruction projection, durable adapters, retrieval geometry, System One selection and image evidence boundaries are unchanged. Isaac runner/contract (15), GPU picker, launcher selection, Blender bridge (19), role supervisor (25), skill lint and catalogue checks pass. Isaac vendor-image and fixture verification remains staged until executed.


Re-verified 2026-10-29 at `00039efb1e4a70402df86ad19cf76894fe3b9a8f` for ADR-2155. Reviewed the typed-decision activation diff against this record: the changed manifest, bootstrap, catalogue or source-pin hunks do not alter its governing boundary. Existing status axes and runtime evidence limits are retained. No image or service activation is claimed.


Security follow-up re-verified 2026-10-29 at `7d8c3b2dfe165f4ab3f8a5e4f62b8294ea7b155d`: the changed hunks drop privilege before workspace credential writes, replace credentials atomically, reject typed-decision redirects and retain the timeout through response parsing. The stalled-body, planted-symlink and HTTP307 regressions pass. These strengthen the existing boundaries; status axes and activation limits are unchanged. The original Deepsec report remains BLOCK with a separate remediation receipt, not a claimed clean rescan.

Re-verified 2026-10-30 at `29a4b4939`: the agentbox.toml delta is three lines inside [system_one] only (bind 0.0.0.0:8094, network = true, local_only = []); this record's sections are untouched.

Re-verified 2026-10-30 at `cd3a29899`: the delta in schema/agentbox.toml.schema.json is [system_one] only (new `network` and `local_only` properties; `bind` admits 0.0.0.0/RFC 1918); management-api/lib/system-manifest.js gains one entry, `system-one-network`; scripts/agentbox-config-validate.js changes only the [system_one] E080 bind rule. This record's sections are untouched.

Re-verified 2026-10-30 at d0e9ca786: the only change to the governed paths is the new `[system_one].skill_list_at_least` key and its schema property (router runner-up listing, ADR-2091); no section this record governs changed.

## Re-verification — 2026-10-31 at `b65c3d4ed`

Today's commits: `2d49681bf` (management API), `b7a1d0955` (ontology-augment), `f4beec643` (skills and docs), `7aa9365d4` (path tiers), `6aaf3bb46` (podcast submitter), `eff6c29c1`, `4a07fbfb3` (ontomark v0.6.1 pin). Owner decision 2026-10-31 (Ontomark DEPRECATION §14): `ontomark` is the one corpus CLI; `vault` keeps only the governance transport, `propose` and `panel publish`, per Ontomark ADR-OM-005 decisions 5-6.

`lib/ontomark.nix` pins ontomark 0.6.1 (ADR-2136 re-verification). The corpus verbs this record names run through `ontomark` with no `vault` fallback; the `neighbours` fallback when the Loom does not answer is `ontomark tree` (`b7a1d0955`). Flat-layout wording is corrected in `agentbox.toml`, the schema's `[vault].working` description and `config/tmux-autostart.sh` (`f4beec643`), and `system-manifest.js` defaults `pages` to `"."` (`eff6c29c1`). The decision (the vault is canonical here; HP is a Loom host) holds. Gates: grounding 87/0, path precedence 10/0, consumer fallback 11/0.

Re-verified 2026-10-31 at `9dadda3ed`. Governed paths changed: ontology-augment.sh and its grounding test gain result labels and --ref (additive envelope fields); the Loom-host reconcile this record decides is untouched. No section of this record's decision changed; re-verified by `git diff b65c3d4ed..9dadda3ed -- <verified_paths>`.

Re-verified 2026-10-31 at `97f298db5`: the only delta on this record's governed paths since the previous verification is the sprint-W7 additive work (ADR-2139 Decision 5 `state_budget_tokens`; ADR-2090 `bypass_projects`): new optional keys that default to today's behaviour, in agentbox.toml, config/entrypoint-unified.sh, management-api/lib/system-manifest.js, schema/agentbox.toml.schema.json. None of it touches this record's decision. Re-verified by `git diff 753788564..97f298db5 -- <governed paths>`; status axes unchanged.

## Re-verification — 2026-10-31 (`1e41b64b624af97cf49771d08da82fbf3743acbd`)

Tripped by the W8 ADR-sprint changes. Governed-path delta since `753788564`: `agentbox.toml` gains only four `[model_routing.routes]` entries (`diagram-polish`, `diagram-narrative`, `diagram-synthesis`, `seal-review`) and a comment block (ADR-2130); `schema/agentbox.toml.schema.json` widens the `model_routing.routes` host pattern to `claude|codex|loom|zai` and adds those four keys (ADR-2130). No key, table or code path this record decides is touched, so the decision and status axes are unchanged. Judged from the diff (re-runnable: `git diff 753788564..1e41b64b6 -- scripts/hp-loom-reconcile.sh config/entrypoint-unified.sh agentbox.toml management-api/lib/system-manifest.js schema/agentbox.toml.schema.json tests/config/hp-loom-reconcile.test.sh skills/ontology-augment/scripts/ontology-augment.sh tests/skills/ontology-augment-grounding.test.sh`; re-run at integration and the summary above matches it), not by re-running this record's own acceptance checks.

Re-verified 2026-10-31 at `2f15c531b02b8f8393d68d29ce3491712bdd862c` (W7 and W8 integration, `adr-sprint/w78`). Governed-path delta since `97f298db5`: `agentbox.toml`: the four `[model_routing.routes]` diagram routes with their comment block (ADR-2130), and a wording fix on the `bypass_projects` comment (brackets forbidden, scoped to skill routing; ADR-2090); `config/entrypoint-unified.sh`: one line, the `system-one-project --format json` call no longer discards stderr, so a refused slot's reason reaches the boot log (zero bytes on the shipped manifest, checked; the call is still `|| true`, so boot behaviour is unchanged); `management-api/lib/system-manifest.js`: one summary string, the `bypass_projects` wording scoped to skill routing (ADR-2090); `schema/agentbox.toml.schema.json`: the `model_routing.routes` host pattern widened to `claude|codex|loom|zai` with four route keys (ADR-2130), and the `bypass_projects` item pattern forbidding `[` and `]` with its description scoped to skill routing (ADR-2090). Read from the diff and checked against the merged tree's gates (cargo, jest, validator); nothing it changes is a key, table or code path this record decides, so the decision and status axes are unchanged. Re-run: `git diff 97f298db5..2f15c531b -- agentbox.toml config/entrypoint-unified.sh management-api/lib/system-manifest.js schema/agentbox.toml.schema.json`.

## Re-verification — 2026-11-01 (ADR-2164 amendment)

Governed path `config/entrypoint-unified.sh` changed since `2f15c531b`: two hunks (`git diff 2f15c531b..e1893e236 -- config/entrypoint-unified.sh`), both inside the trajectory-recorder hook registration block (its comment, the removed `TRAJ_CONNINFO` input, the `pfx` prefix and the command join), which stops inlining the database conninfo and the learning gates into the registered command. Nothing else in the file changed in that range. This record's claims do not concern that block (matches for trajectory/TRAJ_/RUVECTOR_PG_CONNINFO in it: 0, none about the registration). Decision unchanged; `verified_commit` bumped.

## Re-verification — 2026-11-01 (`cc949bb79`)

Governed-path delta since `e1893e236` is the RuVector Postgres credential custody change (ADR-2164 amendment 2), nothing else:

- `agentbox.toml`: the two `conninfo` URLs drop the `@@RUVECTOR_PG_PASSWORD@@` placeholder password, with their comments.
- `config/entrypoint-unified.sh`: adds `_ab_pg_credential_prepare` and the credential-scrub block, replaces every `RUVECTOR_PG_CONNINFO` site (`.mcp.json`, Codex, ingest command line, runtime-env export, routing-label hook command) with the parts and the password-file path, and removes the claude-flow template copy.

Nothing this record decides is changed; its status axes are unchanged. Re-run: `git diff e1893e236..cc949bb79 -- agentbox.toml config/entrypoint-unified.sh`.

Re-stamped again at `09067b095`: the one further change to `config/entrypoint-unified.sh` since `cc949bb79` extends the credential-scrub block so it also walks every `mcpServers` object in Claude Code's per-user state (`~/.claude/.claude.json`, `~/.claude.json`), where the resolved MCP config is cached. Nothing this record decides is changed. Re-run: `git diff cc949bb79..09067b095 -- config/entrypoint-unified.sh`.

## Re-verification — 2026-11-01 (`4f3bd5325`)

Governed-path delta since `09067b095`: `config/entrypoint-unified.sh`: the credential-scrub block (`PGSCRUB_MARKER`) now also rewrites Claude Code's backups and the `*.pre-*`/`*.bak*` snapshots of the projected config, writes atomically (sibling temp file, fsync, rename) keeping owner and mode, and scopes its text rules to RuVector's own values (ADR-2164 amendment 4). This record's decision does not concern these changes. Decision unchanged; `verified_commit` bumped. Re-run: `git diff 09067b095..4f3bd5325 -- config/entrypoint-unified.sh`.

Re-verified 2026-11-05 at `3beca506c` for ADR-2177: the only change to this record's governed paths since its last stamp is ADR-2177's additive SuperSplat hunk (a gated package set and supervisor block, one toml/schema key, a skill registration); this record's decision is unaffected.

Re-verified 2026-11-10 at `062487bec` (PR #43, `dream-review-ledger`; ADR-2190). Governed-path delta since `e2b49adfc`: `schema/agentbox.toml.schema.json` gains three optional string properties in the `dream_machine` object (`git_author_name`, `git_author_email`, `artefact_dir`, `:2981-2992`); no other property, type or closure in the schema changes. The `[vault]` and Loom-host keys are untouched. The decision and status axes are unchanged. Re-run: `git diff e2b49adfc..062487bec -- schema/agentbox.toml.schema.json`.

Re-verified 2026-11-10 at `69d4a8488` (PR #43 review fixes; ADR-2190). Governed-path delta since `062487bec`: `schema/agentbox.toml.schema.json` rewrites only the `description` strings of the three `dream_machine` keys added at `062487bec` (`git_author_name`, `git_author_email`, `artefact_dir`, `:2981-2992`): the identity becomes a fallback and the artefact directory notes the legacy-path guard; no property, type, default or closure changes. The vault and Loom-host keys are untouched. The decision and status axes are unchanged. Re-run: `git diff 062487bec..69d4a8488 -- schema/agentbox.toml.schema.json`.

Re-verified 2026-11-10 at `571c0ad43` (PR #45, ADR-2191, the Bend toolchain). Governed-path delta since `69d4a8488`: `agentbox.toml` gains `[toolchains].bend = true`; `management-api/lib/system-manifest.js` gains the `bend` entry (rebuild class); `schema/agentbox.toml.schema.json` gains the boolean `toolchains.bend`. Every hunk is an addition. The change adds a gated language toolchain and no listener, published port, mount, volume, supervisor program, secret, identity, model route, vault path, registry entry or Nostr kind, and it alters no existing gate, so what this record decides is not touched. CI on that commit passed the flake evaluation on both architectures, config validation with the TUI round trip, the contract and adapter suites and the custody rehearsal. Re-run: `git diff 69d4a8488..571c0ad43 -- <verified_paths>`.
