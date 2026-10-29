---
id: ADR-2140
title: Keep the vault canonical on this host, reconcile the HP Loom to it at every boot, and retire the HP agentbox
date: 2026-10-13
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 6ceb224899a2db4b96dc245e85ba3f4b326a96b3
verified_paths: [scripts/hp-loom-reconcile.sh, config/entrypoint-unified.sh, agentbox.toml, management-api/lib/system-manifest.js, schema/agentbox.toml.schema.json, tests/config/hp-loom-reconcile.test.sh, skills/ontology-augment/scripts/ontology-augment.sh, tests/skills/ontology-augment-grounding.test.sh]
owner: jjohare
review_trigger: a reconcile failure or change to the builder pin or published-generation schema; any proposal to run an agentbox on the HP again; any proposal for the HP to read the vault directly; a second consumer of the built generation
repo: agentbox
---

# ADR-2140 — Keep the vault canonical on this host, reconcile the HP Loom to it at every boot, and retire the HP agentbox

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
