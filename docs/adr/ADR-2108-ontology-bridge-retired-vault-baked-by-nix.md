---
id: ADR-2108
title: ontology-bridge is retired; the vault binary is baked by Nix
date: 2026-09-22
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: [ADR-2022, ADR-2054]
superseded_by: []
verified_commit: 924f4282ae18428f044bfd468bb8a4cd66a6106e
verified_paths: [lib/vault.nix, flake.nix, agentbox.toml, schema/agentbox.toml.schema.json, config/entrypoint-unified.sh, mcp/mcp.json, services/agentbox-manifest/tests/golden, management-api/lib/ontology-propose.js]
owner: jjohare
review_trigger: a `vault --version` gate failure at boot; a request to re-register any deleted server; ontology-monitor, typed-spawn and ontology-workingset re-pointed off mcp/servers/lib/ontology-local.js (vault shipped, so this is now due; ADR-2136); a vaultSrc bump that changes the vault verb set
repo: agentbox
domain: BASELINE-container
lineage: ADR-2107 (no MCP for the corpus), ADR-2029 (rune, the gated-binary pattern this follows), ADR-2028 ([vault] path authority), ADR-023/ADR-054 (the retired bridge's own records), VisionFlow PRD-sovereign-corpus §4
---

# ADR-2108 — ontology-bridge is retired; the vault binary is baked by Nix

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

## Scoped source check — 2026-11-05

The only new shared-flake delta since the previous verification pins OpenSSH
10.6p2 and its upstream SHA-256 together, without changing listeners, mounts,
role mappings or this record's own feature gate. Upstream's 2026-11-05 release
adds the Linux musl/PAM-disabled password-auth workaround. This is a custom
package override: image VEX must not claim a stock nixpkgs OpenSSH build.
Runtime acceptance and all existing status limitations remain separate.

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

## Context

ADR-2107 decided agents reach the corpus through a CLI. That decision is only
real once the old door is gone and the new one is in the image. Neither is
automatic: `ontology-bridge` was registered in four places and asserted in seven
golden byte-fixtures, and `vault` lives in the **parent** VisionClaw workspace,
which agentbox's flake cannot read.

## Decision

**Deleted.** `mcp/servers/ontology-bridge.js`; its entry in `mcp/mcp.json`, in
`/home/devuser/workspace/.mcp-hub-servers.json` and in
`[resources.mcp_hub].servers`; the `ENABLE_ONTOLOGY`-gated registration block in
`config/entrypoint-unified.sh` and the `ENABLE_ONTOLOGY` env the flake baked for
it; the `mcp.after-ontology-bridge.json` golden and the chain step that produced
it (nine mutations become eight).

**Relocated, not deleted.** `mcp/servers/ontology-propose.js` was never an MCP
server — a pure, synchronous request-descriptor builder that lived under
`mcp/servers/` only because the bridge was its first caller. Its one remaining
caller is the management API's KG-elevation route, which already preferred a
vendored package-local copy. The file therefore moves to
`management-api/lib/ontology-propose.js`, the dual-path require collapses to one,
and the flake's `buildPhaseExtra` vendoring step disappears. PRD §4 lists it
among the deletions; deleting the *file from `mcp/servers/`* honours that, while
deleting the *function* would have unmounted a live route this workstream does
not own. WS-F replaces that path with `vault propose`; until then it is the last
non-`vault` propose path in this repo, and it is recorded here rather than left
for someone to find.

**Also deleted — the second door.** `mcp/servers/ontology-local.cjs` was never
registered as an MCP server (zero entries in `mcp.json` and
`.mcp-hub-servers.json`): it is a shell CLI over the same corpus, doing
search/get/neighbors/path/ask/validate/add with a hand-rolled markdown parse.
That makes it a *duplicate agent-facing door* under PRD Q11 (one corpus, one
implementation), and its `add` verb was the last ungoverned corpus write in this
repo. Deleted, and the write path went with it: `axiomAdd`/`propose` are stripped
from `mcp/servers/lib/ontology-local.js`, which orphaned and therefore deleted
`lib/ontology-authoring-authority.js` (the ADR-2022/ADR-2054 gate),
`lib/vault-frontmatter.js` (used only by that write path), its unit test, the CI
step that ran it, and `[skills.ontology].local_authoring` in the manifest and
schema. **This supersedes ADR-2022 and ADR-2054**, which govern a write path that
no longer exists. A gate is the right answer to a door you must keep; deleting
the door is better, and it cannot be flipped back on by a manifest edit.

**`lib/ontology-local.js` survives as a READ-ONLY library, deliberately.** Three
live consumers need it and none is an agent-facing corpus door: the per-turn
`config/hooks/ontology-monitor.cjs`, `lib/typed-spawn.js` and
`lib/ontology-workingset.js`. Re-pointing them at `vault` today would mean
editing a per-turn hot path against a binary that does not yet exist, untestable.
The file carries a header naming `vault` as its successor and the follow-up is
tracked in this ADR's review trigger. Verified still working: the monitor hook
matched 8 concepts from the corpus after the write path was removed.

**Kept.** `decision-tools`, `governance-bridge`, `harness-bridge`,
`precedent-bridge` stay registered. ADR-2107 bans MCP for **the corpus**;
decision records and governance are not the corpus.

**Baked.** `lib/vault.nix` builds `crates/vault` with `rustPlatform.buildRustPackage`,
`doCheck = true` (the golden build-parity tests are exactly the ones that must
not be skipped), and a stable `/opt/agentbox/bin/vault` symlink beside
`colloquy-mcp` — a `/nix/store` path recorded in prose or config dangles at the
next GC.

Gating follows `rune` (ADR-2029): selection at image composition, execution
checked separately.

- **Selection**, `flake.nix`: `vaultCliActive = [vault].root set && [vault].cli != false`.
  New manifest key `[vault].cli`, default true, REBUILD-class.
- **Liveness**, `config/entrypoint-unified.sh` Phase 5d(ii): runs
  `vault --version` and prints `vault OK` / `FAILED` / `MISSING` with the rebuild
  command. **Fail-loud, not fail-fatal** — the same contract `[vault]` itself
  keeps. A corpus agents cannot open must never be silent, but must not stop a
  container whose other subsystems are fine.

**Source.** The crate is in the parent VisionClaw workspace so it can share the
OntologyBlock parser and Whelk-rs with VisionClaw's ingest (PRD Q11). A flake may
not read a path outside its own tree, so `src = ../../crates/vault` is not
available. It arrives as a flake input, `vaultSrc`, `flake = false` — the same
mechanism `skills` already uses — currently pinned to the absolute workspace path
`path:/home/devuser/workspace/project/crates/vault`.

## Consequences

**The absolute path is a known wart, and deliberate.** It is the only form that
crosses the submodule boundary while keeping the pin content-addressed in
`flake.lock`. It costs portability: a checkout elsewhere must override it. Two
exits, both one line: `--override-input vaultSrc path:<dir>` for a working-tree
build, or flip the input to
`github:DreamLab-AI/VisionClaw/<rev>?dir=crates/vault` once the crate is pushed.
The review trigger above is that push.

**`nix flake lock` fails until `crates/vault` exists.** WS-C is building it
concurrently. This is honest rather than hidden: a placeholder pin would have
made `nix flake check` pass while producing no binary.

**Not evaluated here.** This container has no `nix` (builds are host-side, tmux
window 6). The expression is written to the house patterns and reviewed against
`lib/rune.nix`, `lib/colloquy.nix` and `lib/podcast-ingest.nix`, but the first
real evaluation is the owner's rebuild.

**Goldens.** Six downstream fixtures were edited by excising the 14-line
`ontology-bridge` block and nothing else, each re-parsed as JSON to prove it. A
whole-file round-trip would have reformatted them and broken the byte parity the
chain test exists to assert. `capture-from-python.py`, the documented
regeneration recipe, had its step removed too so the recipe still reproduces the
fixture set it claims to.

## Verification

`implementation_status: partial` — deletions, registrations, goldens, gate and
manifest are complete and checked; the Nix build is not, because the crate does
not exist yet and this container cannot run `nix`.

`verified_commit` names the tree this work was written against (4fb44b789fa5); the
work itself is uncommitted, so `verified_paths` is left EMPTY and the staleness
gate stays inert. **In the landing commit, set `verified_paths` to
`[lib/vault.nix, flake.nix, agentbox.toml, schema/agentbox.toml.schema.json, config/entrypoint-unified.sh, mcp/mcp.json, services/agentbox-manifest/tests/golden, management-api/lib/ontology-propose.js]` and bump `verified_commit` to that commit.** Arming it now would
fire a false STALE on the commit that lands the change.

Established by:

- `grep -rn "ontology-bridge" flake.nix agentbox.toml config/entrypoint-unified.sh mcp/ services/agentbox-manifest/{src,tests}`
  → only ADR-referencing comments remain.
- Every edited golden re-parsed with `json.loads` after excision; each shrank by
  exactly 14 lines (13 for `mcp.after-protect-ns.json`'s offset block) and
  `mcp.after-precedent-bridge.json` now begins its `precedent-bridge` key
  immediately after `agentic-qe`.
- `bash -n config/entrypoint-unified.sh` → clean.
- `node --check` / import of every rewritten JS and `.mjs`; `submit-proposals.mjs`
  exercised end-to-end against a stub `vault` (resolution, diff generation,
  dry-run state isolation).
- `agentbox.toml` `[vault].cli` validated against the extended
  `schema/agentbox.toml.schema.json` (`additionalProperties: false` made the
  schema edit mandatory, not optional).

**Owner's rebuild and check:**

```bash
# tmux window 6 (host shell) — NEVER from inside the container
tmux send-keys -t 6 './scripts/launch.sh rebuild dev' Enter    # ~15 min, REBUILD-class

# before that, to evaluate without the pin resolving:
nix flake check --override-input vaultSrc path:/home/devuser/workspace/project/crates/vault
nix build .#packages.x86_64-linux.vault \
  --override-input vaultSrc path:/home/devuser/workspace/project/crates/vault

# after boot, the gate speaks for itself:
docker logs <container> 2>&1 | grep '\[5d/8\] vault'
```

## Disposition — 2026-10-02

- **Suitability:** fits. The Nix-baked binary is the right mechanism. The *source* of the pin changes under the estate's break-out edict.
- **Priority:** P1 for the pin (done). P2 for the break-out, which waits for the owner's go.
- **Pin (owner decision 2026-10-02, R10):** `vaultSrc` moved from `0c195f7605f3` to VisionClaw main `64512141bd01` in `e70fcb5df`. At `0c195f760`, `vault build --with-rvdb` predates `f95d0acc1`, and the Loom reload check rejects its vector records. The pin is proven by a real `nix build` of `lib/vault.nix` against the locked inputs, with `doCheck` on: `/nix/store/p00pdlbychd3w5zk63grbdmqr4cdmh4c-vault-0.1.0`, all tests green. The "absolute path" wart in §Consequences is gone: the input is `github:DreamLab-AI/VisionClaw/<rev>`. Note also that `.#packages.<system>.vault` in the recipe above is not a flake output. `vaultPkg` is a `let` binding, so build `lib/vault.nix` directly.
- **Pin (2026-10-03, custody repin):** `vaultSrc` moved from `64512141bd01` to VisionClaw main `94dc0ff60923` (owner rule: estate pins move forward). The vault side of the change: `nostr-bbs-core` pinned to `=1.0.0-beta.13` (crates.io, not yanked), vault-core publish metadata, and a cast-safety change in `domain_class_id` with the same signature and results. No new `git+` source in `Cargo.lock`; the whelk rev, and with it the one `outputHashes` entry, is unchanged. The narHash was computed with the NAR-serialisation method that reproduces the previous pin's hash exactly. Unlike the entry above, this pin is **not yet proven by a `nix build`**; the owner's agentbox rebuild proves it.
- **Pin (2026-10-05, PRD-029):** `vaultSrc` moved from `94dc0ff60923` to VisionClaw main `f0ba2b2a54f2` (first `d33400fa6561`, then forward to pick up the NIP-42 publish fix so the baked `vault propose` can post to the forum relay), which carries PRD-029 (ADR-2124 to 2128): `disjoint-with` and `defines-as` are understood, `vault validate` refuses `DISJOINT_NOT_SIBLINGS`, `NON_EL_DEFINITION` and `DEFINITION_OVER_TRANSITIVE`, `vault build` refuses an unsatisfiable class and stamps `owl:versionIRI`, and reasoning refuses with `WHELK_RELEVANT_CAP` instead of hanging. No new `git+` source in `Cargo.lock` and the whelk rev is unchanged, so `outputHashes` stays. The narHash comes from the same NAR-serialisation method, which reproduced `94dc0ff`'s recorded `sha256-1mQSa9…` exactly before it was trusted for the new rev. Not yet proven by a `nix build`; the next agentbox rebuild proves it.
- **Pin (2026-10-20, ADR-2147 amended):** `vaultSrc` moved from `4a197008af1b` to VisionClaw main `e2d4e2cc1314` (merge of PR #33): `vault` now takes its certificate engine from the `rdfs-certificate` 0.1.0 crate on crates.io, shared with ontomark 0.6.0 (ontomark ADR-OM-009). The new dependency is a registry crate, fetched through `cargoLock.lockFile` by its lockfile checksum, so `outputHashes` is unchanged (still only the whelk `git+` rev). narHash by the same NAR-serialisation method as the previous entry. Proven by the next agentbox rebuild.
- **Pin (2026-10-20, ADR-2147):** `vaultSrc` moved from `4fe620296a82` to VisionClaw main `4a197008af1b` (merge of PR #32), which carries VisionClaw ADR-2147: `vault certify` (RDFS derivation certificate in the `oo-cert/1` format, Whelk-parity exit condition) and the `consequences` delta on `vault propose` / the kind-31402, plus the SHACL label-datatype fix. `Cargo.lock` gains no `git+` source; the whelk rev `79a1ee21` and its `outputHashes` entry are unchanged. The narHash comes from the same NAR-serialisation method, which reproduced `4fe62029`'s recorded `sha256-KHBP0c…` exactly before it was trusted for the new rev. Not yet proven by a `nix build`; the next agentbox rebuild proves it, and `vault certify --help` in the rebuilt image is the check.
- **Break-out judgement (standing edict 2026-10-02):** Is it generalisable, meaning could another operator use it with their own Obsidian corpus and ontology?
  - **`vault-core`: yes.** Its dependencies are all on crates.io, with no VisionClaw internals. The page/frontmatter parser, vocabulary model, OKF v0.2 types, link graph and promotion machine are format-level. Coupling points:
    1. `vocabulary.rs` defaults the namespaces to `urn:ngm:class:` / `urn:ngm:individual:` and builds in the `vc`/`ngm`/`ngmi` → `narrativegoldmine.com` prefixes. These belong in the estate's `vocabulary.yaml`.
    2. `domains.rs` is the estate's domain registry and GPU clustering ids, and VisionClaw's GPU actors call it. It is VisionClaw-only.
    3. `proposal.rs` hard-codes `PROPOSAL_NAMESPACE = urn:ngm:proposal:`, and its prose ties the payload to forum kind 31402.
    4. The `knowledge/` + `working/` two-vault layout is a convention. It is documented in VisionClaw `docs/VAULT-corpus-format.md` and can become the crate's format spec.
    5. The crates.io name `vault-core` belongs to an unrelated project.
  - **`vault` (CLI): partly.** `validate`, `find`/`retrieve`/`tree`, `edit --expect`, `gate`, `conflicts` and the TTL/OKF part of `build` are generic. Coupling points:
    1. **`whelk` is a git dependency** (`jjohare/whelk-rs` at `79a1ee2`, an MIT fork of `b-gehrke/whelk-rs`). crates.io refuses git dependencies, and the crates.io name `whelk` belongs to another author. This blocks publication.
    2. `narrativegoldmine.com` IRIs are compiled into `build/turtle.rs`, `build/webvowl.rs`, `build/graph_tiers.rs`, `projection.rs` and `whelk.rs`.
    3. `build/generation.rs` stamps `visionGraph@<commit>`.
    4. `build/rvdb.rs` defaults to the LAN embedder `192.168.2.132:9997` and `bge-small-en-v1.5`, with `loom:ontology-corpus:` record ids.
    5. NGG1 graph tiers, `scaffold-index.json` and WebVOWL are the explorer's and Loom's formats.
    6. `propose` and `nostr.rs` post dreamlab forum 31402 events.
    7. `repair bodies` is a Logseq→Obsidian migration tool.
    8. The crates.io name `vault` is taken.
- **Plan (not started: needs the owner's go):**
  1. New repository `DreamLab-AI/okf-vault`, AGPL-3.0-only unless the owner relicenses. History is carried by `git filter-repo` on `crates/vault-core` and `crates/vault`.
  2. Publish Whelk first. Either `b-gehrke/whelk-rs` upstream takes the fork's changes and publishes, or `whelk-rs` is published from the fork with attribution. Both names are free today.
  3. `okf-vault-core` 0.2.0 (lib name stays `vault_core`): drop the `ngm` defaults and builtin prefixes, so namespaces come only from `vocabulary.yaml`, and make the proposal namespace a vocabulary key. `domains.rs` stays in VisionClaw.
  4. `okf-vault` 0.2.0 (binary still `vault`): IRIs, generation prefix and embedder endpoint come from the vocabulary file or flags, with no LAN default. Behind cargo features: `rvdb` (embedding sidecar), `forum` (31402 via `nostr-bbs-core`) and `explorer` (NGG1/WebVOWL/scaffold).
  5. VisionClaw keeps a thin adapter: the domain registry, its `vocabulary.yaml` with the `ngm` namespaces, and a dependency on `okf-vault-core` with all features on. The golden-parity tests stay in VisionClaw as its adapter's acceptance test.
  6. agentbox switches `lib/vault.nix` from the `vaultSrc` flake input to the published crate. That retires the input, and with it the cross-repo commit pin this ADR documents.
- **Done today, toward step 3:** `vault-core` is publishable in place. It has crates.io metadata, a README and licence, a pedantic-clippy cast fix in `domains.rs`, clean `cargo doc --no-deps` (`-D warnings`), and 453 tests green across both crates. `cargo publish --dry-run` passes with `publish` flipped temporarily, and `publish = false` stays as the go gate. `vault` cannot package until step 2 lands.
- **Why here:** VisionClaw's `scripts/adr-ratchet.sh` admits a new proposed ADR only if a proposed one closes in the same push. Closing another record to make room is not this worker's decision, so the plan is recorded here as the brief directs. When the owner says go, it becomes a VisionClaw ADR that supersedes ADR-2113's "Crate home" clause (PRD Q11).

## Extraction ownership supersession — 2026-10-11

The historical `DreamLab-AI/okf-vault` plan in the 2026-10-02 disposition is
replaced at the repository/package ownership level by
[Ontomark](https://github.com/DreamLab-AI/ontomark) and
[ADR-2136](ADR-2136-pin-the-shared-ontology-toolchain.md). The historical pin and
build receipts above remain evidence for their own revisions; they are not
rewritten as Ontomark activation receipts.

The selected producer publishes `ontomark-parse`, `ontomark-model`,
`ontomark-reason`, `ontomark-compile`, `ontomark-ngg1` and `whelk-el`, with an
explicitly relicensed permissive core and preserved upstream notices. Governance
posting and signing stay outside that core. Graph rendering belongs to Ontomark
`packages/graph`; VOWL retains its compatibility and physics surface, and the
standalone Obsidian repository owns its host integration.

This section supersedes the proposed repository/name/licence assumptions of the
old extraction plan only. It leaves the accepted CLI-door, manifest path
authority, governed writes and immutable Nix packaging requirements intact.
Agentbox repinning and runtime acceptance remain separately tracked in ADR-2136;
publication alone does not retire the current source pin or read-only helpers.

## Close-out 2026-10-30

`partial/staged → complete/live`, verified at `e786197ccb9f56c638d4b0181e77f33ab38b7db9`. The only gap Verification named was the Nix build ("the crate does not exist yet and this container cannot run `nix`"). That build now exists and is the running binary. `verified_paths` is armed with the list Verification prescribed.

- Running image: `.agentbox-build/active.json` (host, read via the project bind) records `sourceCommit` `e786197ccb9f56c638d4b0181e77f33ab38b7db9`, `sourceDirty: false`, `delivery: registry`, `activatedAt` 2026-10-30T14:22:59.281Z, `imageId` `sha256:9776d2fc515c…`; `docker inspect agentbox --format '{{.Image}}'` and `$AGENTBOX_IMAGE_HASH` both return `sha256:9776d2fc515c5922cde9f7791248f731416192a6b4a66e8d6d06b15bfd5c892d`. The running container therefore runs main at `e786197cc`.
- `docker logs agentbox 2>&1 | grep '\[5d/8\] vault'` (the check this record names) → `[5d/8] vault OK — vault 0.1.0 (/opt/agentbox/bin/vault)`.
- `vault --version` → `vault 0.1.0`, resolved from `/nix/store/83ilg82h5ar8vvnqqzysamvxc08iycxq-vault-0.1.0/bin`.
- Deletions hold on main: `mcp/servers/ontology-bridge.js` and `mcp/servers/ontology-local.cjs` are absent; `grep -c ontology-bridge mcp/mcp.json` and the baked `/opt/agentbox/mcp/mcp.json` → 1 each, the `decision-tools` description that records the retirement. `lib/ontology-local.js` survives at `mcp/servers/lib/ontology-local.js` as the read-only library this Decision keeps on purpose.

Not claimed: the review-trigger follow-on (re-point `ontology-monitor`, `typed-spawn` and `ontology-workingset` off `ontology-local.js`); ADR-2136 still owns that. Found while verifying, and outside this record's Decision: the baked `vault 0.1.0` no longer has `find`/`retrieve`/`tree`/`edit`/`create`/`apply` ("Moved: … now live in the `ontomark` CLI"), while `flake.nix:950-953` still says vault keeps them. ADR-2109's close-out records the consumer impact.

`review_trigger` (2026-10-30): the remote-push clause was closed by the 2026-10-02 pin to `github:DreamLab-AI/VisionClaw/<rev>`, and "vault shipping" fired with this close-out. The trigger now names what is still pending.

## Re-verification — 2026-10-31 at `b65c3d4ed`

Today's commits: `2d49681bf` (management API), `b7a1d0955` (ontology-augment), `f4beec643` (skills and docs), `7aa9365d4` (path tiers), `6aaf3bb46` (podcast submitter), `eff6c29c1`, `4a07fbfb3` (ontomark v0.6.1 pin). Owner decision 2026-10-31 (Ontomark DEPRECATION §14): `ontomark` is the one corpus CLI; `vault` keeps only the governance transport, `propose` and `panel publish`, per Ontomark ADR-OM-005 decisions 5-6.

The discrepancy recorded in the 2026-10 note above is fixed: `flake.nix` no longer says `vault` keeps `find`/`retrieve`/`tree`/`edit`; its comment names the verbs `ontomark` owns and the two `vault` keeps. `lib/ontomark.nix` pins ontomark 0.6.1 (release asset sha256 `7c41ea49…`, SRI `sha256-fEHq…`; the `jev` source build at `4699ee08b`, NAR hash computed by a method that reproduces the previous `13af4234` pin). The decision (`ontology-bridge` retired; the corpus CLIs baked by Nix) holds. The running image still carries 0.6.0 until the owner's rebuild.

Re-verified 2026-10-31 at `97f298db5`: the only delta on this record's governed paths since the previous verification is the sprint-W7 additive work (ADR-2139 Decision 5 `state_budget_tokens`; ADR-2090 `bypass_projects`): new optional keys that default to today's behaviour, in agentbox.toml, config/entrypoint-unified.sh, schema/agentbox.toml.schema.json. None of it touches this record's decision. Re-verified by `git diff 753788564..97f298db5 -- <governed paths>`; status axes unchanged.

## Re-verification — 2026-10-31 (`1e41b64b624af97cf49771d08da82fbf3743acbd`)

Tripped by the W8 ADR-sprint changes. Governed-path delta since `753788564`: `agentbox.toml` gains only four `[model_routing.routes]` entries (`diagram-polish`, `diagram-narrative`, `diagram-synthesis`, `seal-review`) and a comment block (ADR-2130); `schema/agentbox.toml.schema.json` widens the `model_routing.routes` host pattern to `claude|codex|loom|zai` and adds those four keys (ADR-2130). No key, table or code path this record decides is touched, so the decision and status axes are unchanged. Judged from the diff (re-runnable: `git diff 753788564..1e41b64b6 -- lib/vault.nix flake.nix agentbox.toml schema/agentbox.toml.schema.json config/entrypoint-unified.sh mcp/mcp.json services/agentbox-manifest/tests/golden management-api/lib/ontology-propose.js`; re-run at integration and the summary above matches it), not by re-running this record's own acceptance checks.

Re-verified 2026-10-31 at `2f15c531b02b8f8393d68d29ce3491712bdd862c` (W7 and W8 integration, `adr-sprint/w78`). Governed-path delta since `97f298db5`: `agentbox.toml`: the four `[model_routing.routes]` diagram routes with their comment block (ADR-2130), and a wording fix on the `bypass_projects` comment (brackets forbidden, scoped to skill routing; ADR-2090); `config/entrypoint-unified.sh`: one line, the `system-one-project --format json` call no longer discards stderr, so a refused slot's reason reaches the boot log (zero bytes on the shipped manifest, checked; the call is still `|| true`, so boot behaviour is unchanged); `schema/agentbox.toml.schema.json`: the `model_routing.routes` host pattern widened to `claude|codex|loom|zai` with four route keys (ADR-2130), and the `bypass_projects` item pattern forbidding `[` and `]` with its description scoped to skill routing (ADR-2090). Read from the diff and checked against the merged tree's gates (cargo, jest, validator); nothing it changes is a key, table or code path this record decides, so the decision and status axes are unchanged. Re-run: `git diff 97f298db5..2f15c531b -- agentbox.toml config/entrypoint-unified.sh schema/agentbox.toml.schema.json`.

## Re-verification — 2026-11-01 (ADR-2164 amendment)

Governed path `config/entrypoint-unified.sh` changed since `2f15c531b`: two hunks (`git diff 2f15c531b..e1893e236 -- config/entrypoint-unified.sh`), both inside the trajectory-recorder hook registration block (its comment, the removed `TRAJ_CONNINFO` input, the `pfx` prefix and the command join), which stops inlining the database conninfo and the learning gates into the registered command. Nothing else in the file changed in that range. This record's claims do not concern that block (matches for trajectory/TRAJ_/RUVECTOR_PG_CONNINFO in it: 0, none about the registration). Decision unchanged; `verified_commit` bumped.

## Re-verification — 2026-11-01 (`cc949bb79`)

Governed-path delta since `e1893e236` is the RuVector Postgres credential custody change (ADR-2164 amendment 2), nothing else:

- `agentbox.toml`: the two `conninfo` URLs drop the `@@RUVECTOR_PG_PASSWORD@@` placeholder password, with their comments.
- `config/entrypoint-unified.sh`: adds `_ab_pg_credential_prepare` and the credential-scrub block, replaces every `RUVECTOR_PG_CONNINFO` site (`.mcp.json`, Codex, ingest command line, runtime-env export, routing-label hook command) with the parts and the password-file path, and removes the claude-flow template copy.
- `flake.nix`: removes the claude-flow config template (`claudeFlowConfigJson` and its `cp`) and the baked `RUVECTOR_PG_CONNINFO` image Env entry, and rewords one dream-engine supervisor comment.
- `mcp/mcp.json`: `${RUVECTOR_PG_CONNINFO}` env entries become the parts plus the password-file path.

Nothing this record decides is changed; its status axes are unchanged. Re-run: `git diff e1893e236..cc949bb79 -- agentbox.toml config/entrypoint-unified.sh flake.nix mcp/mcp.json`.

Re-stamped again at `09067b095`: the one further change to `config/entrypoint-unified.sh` since `cc949bb79` extends the credential-scrub block so it also walks every `mcpServers` object in Claude Code's per-user state (`~/.claude/.claude.json`, `~/.claude.json`), where the resolved MCP config is cached. Nothing this record decides is changed. Re-run: `git diff cc949bb79..09067b095 -- config/entrypoint-unified.sh`.

## Re-verification — 2026-11-01 (`4f3bd5325`)

Governed-path delta since `09067b095`: `config/entrypoint-unified.sh`: the credential-scrub block (`PGSCRUB_MARKER`) now also rewrites Claude Code's backups and the `*.pre-*`/`*.bak*` snapshots of the projected config, writes atomically (sibling temp file, fsync, rename) keeping owner and mode, and scopes its text rules to RuVector's own values (ADR-2164 amendment 4). This record's decision does not concern these changes. Decision unchanged; `verified_commit` bumped. Re-run: `git diff 09067b095..4f3bd5325 -- config/entrypoint-unified.sh`.

Re-verified 2026-11-05 at `3beca506c` for ADR-2177: the only change to this record's governed paths since its last stamp is ADR-2177's additive SuperSplat hunk (a gated package set and supervisor block, one toml/schema key, a skill registration); this record's decision is unaffected.

Re-verified 2026-11-10 at `062487bec` (PR #43, `dream-review-ledger`; ADR-2190). Governed-path delta since `e2b49adfc`: `schema/agentbox.toml.schema.json` gains three optional string properties in the `dream_machine` object (`git_author_name`, `git_author_email`, `artefact_dir`, `:2981-2992`); no other property, type or closure in the schema changes. The `[vault]` and ontology keys are untouched. The decision and status axes are unchanged. Re-run: `git diff e2b49adfc..062487bec -- schema/agentbox.toml.schema.json`.

Re-verified 2026-11-10 at `69d4a8488` (PR #43 review fixes; ADR-2190). Governed-path delta since `062487bec`: `schema/agentbox.toml.schema.json` rewrites only the `description` strings of the three `dream_machine` keys added at `062487bec` (`git_author_name`, `git_author_email`, `artefact_dir`, `:2981-2992`): the identity becomes a fallback and the artefact directory notes the legacy-path guard; no property, type, default or closure changes. The ontology and vault keys are untouched. The decision and status axes are unchanged. Re-run: `git diff 062487bec..69d4a8488 -- schema/agentbox.toml.schema.json`.

Re-verified 2026-11-10 at `571c0ad43` (PR #45, ADR-2191, the Bend toolchain). Governed-path delta since `69d4a8488`: `agentbox.toml` gains `[toolchains].bend = true`; `flake.nix` gains `bendLib` and `bendPackages`, one `++ bendPackages` in `allPackages` and one in the `toolchains` layer group, and `ENABLE_BEND` in the image environment; `schema/agentbox.toml.schema.json` gains the boolean `toolchains.bend`. Every hunk is an addition apart from one re-wrapped line in the `toolchains` layer group. The change adds a gated language toolchain and no listener, published port, mount, volume, supervisor program, secret, identity, model route, vault path, registry entry or Nostr kind, and it alters no existing gate, so what this record decides is not touched. CI on that commit passed the flake evaluation on both architectures, config validation with the TUI round trip, the contract and adapter suites and the custody rehearsal. Re-run: `git diff 69d4a8488..571c0ad43 -- <verified_paths>`.

Re-verified 2026-11-11 at `237178730` (ADR-2192, ADR-2193, ADR-2194 at `04638a618`; ADR-2195 at this commit). Governed-path delta since `571c0ad43`: `agentbox.toml` gains `[skills.routing] scope = "all"` (ADR-2192) and `cad = false`, `cad_print = false` under `[skills.spatial_and_3d]` (ADR-2195); `config/entrypoint-unified.sh` reads `[skills.routing].scope` and, only when it is `all`, adds `AGENTBOX_SKILL_ROUTE_SCOPE=all` to the routing hook command and to `runtime-env.sh` (which also gains one comment line); `flake.nix` gains `supervisordLauncher`, listed ahead of `pythonRuntimeEnv` in `pythonBasePackages` (ADR-2193: PID 1 is started by the runtime env's interpreter; the entrypoint's `exec supervisord` line is unchanged), `motionRenderPkg` in `skillToolPackages` (ADR-2194), and the CAD gate (ADR-2195): `cadLib`, `cadEnabled`, two gated additions to `spatialPackages`, a gated `[program:cad-engine]` block bound to `127.0.0.1:3245`, gated `/usr/share/fonts` links and `ENABLE_CAD` in the image environment; `schema/agentbox.toml.schema.json` gains the `scope` enum under `skills.routing` and the `cad` and `cad_print` booleans under `skills.spatial_and_3d`. The changes add a routing scope setting, a launcher for PID 1, one Rust skill tool and a gated-off CAD feature. They add no published port, mount, volume, secret, identity, model route, vault path, registry entry or Nostr kind, and alter no existing gate, so what this record decides is not touched. Run on this commit in the container: the configuration jest suites (294 passed), `skill-lint`, `skill-count-check`, the manifest validator, the egress register check, the secret inventory, the crate licensing check, the role-isolation and runtime-contract shell tests, `python-runtime-path` and `cad-launcher`. The flake was NOT evaluated (no Nix in the container) and no image has been built from it. The decision and status axes are unchanged. Re-run: `git diff 571c0ad43..237178730 -- <verified_paths>`.

Re-verified 2026-11-11 at `1e7d1d2b2`. Governed-path delta since `237178730`: `agentbox.toml` only, where `[skills.spatial_and_3d]` `cad` and `cad_print` go from `false` to `true` (ADR-2195, operator's decision) and their comment is reworded. No other key changes. The gated additions this turns on are the ones the previous note describes as gated off: the CAD launcher, wheelhouse and Xvfb in `spatialPackages`, `[program:cad-engine]`, the `/usr/share/fonts` links and, for `cad_print`, OrcaSlicer. None has been evaluated or built. The manifest validator and `tests/config/cad-launcher.test.sh` (35) pass on this commit.

Re-verified 2026-11-11 at `a1d16473e` (skill-estate audit). Governed-path delta since `1e7d1d2b2`: `agentbox.toml` sets `[system_one.consumers].skill_intent = false` (it doubled each routed turn's input for a blind pick that was never adopted; identical picks on the 86 labelled cases at half the cost) and rewords one comment under `[skills.routing]` (the hook is registered with an 8 s timeout); no other key changes. No published port, mount, secret, identity, route, vault path or registry entry changes, so what this record decides is not touched. Run on this commit: skill lint and its self-test, skill-count, routing-table, the manifest validator, the router jest suites (104) and configuration jest (301), corpus and parity tests (the corpus's baked-versus-repo comparison fails in this container until the next rebuild carries the new descriptions; CI has no baked tree and skips it). The decision and status axes are unchanged.

Re-verified 2026-11-11 at `924f4282a` (ADR-2196). Governed-path delta since `a1d16473e`: `agentbox.toml` rewords the `[skills.routing].label_log` comment to record that EXP-B8 is over (the key was already `false`); no key changes; `config/entrypoint-unified.sh` drops the `_probe_closure` of the deleted openai-codex MCP server, which would have failed the boot under `ENABLE_CODEX`; `flake.nix` adds `semgrep`, `gitleaks`, `trivy` and `jujutsu` to the ungated `basePackages`; removes `codexMcpPkg`, its `npmServicePackages` entry and its copy into the openai-codex skill folder (the codex CLI, `toolchains.codex` and the codex-plugin-cc payload are unchanged); and gives `[program:podcast-cron]`'s `environment=` PATH util-linux and `vaultPackages` via `lib.makeBinPath`; regenerated `agentbox-manifest` stacks goldens (openai-codex and playwright out, codex-companion and browser in). No published port, mount, secret, identity, route, vault path or registry entry changes, so what this record decides is not touched. Run on this commit: skill lint (124), skill-count, routing-table, the manifest validator, router and configuration jest, the corpus test (its baked-versus-repo comparison fails in-container until the next rebuild), and the agentbox-manifest and podcast-ingest cargo tests. The Nix changes are not evaluated or built. The decision and status axes are unchanged.
