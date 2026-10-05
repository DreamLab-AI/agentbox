---
id: ADR-2108
title: ontology-bridge is retired; the vault binary is baked by Nix
date: 2026-09-22
decision_status: accepted
implementation_status: partial
activation_status: staged
supersedes: [ADR-2022, ADR-2054]
superseded_by: []
verified_commit: 4fb44b789fa51f31b380dfbe7a0f79ebaf87ff67
verified_paths: []               # armed in the landing commit — see Verification
owner: jjohare
review_trigger: crates/vault being pushed to a remote (flip the flake input off the absolute path), a `vault --version` gate failure at boot, a request to re-register any deleted server, or `vault` shipping (re-point ontology-monitor/typed-spawn/ontology-workingset off lib/ontology-local.js and delete it)
repo: agentbox
domain: BASELINE-container
lineage: ADR-2107 (no MCP for the corpus), ADR-2029 (rune, the gated-binary pattern this follows), ADR-2028 ([vault] path authority), ADR-023/ADR-054 (the retired bridge's own records), VisionFlow PRD-sovereign-corpus §4
---

# ADR-2108 — ontology-bridge is retired; the vault binary is baked by Nix

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
    6. `propose` and `nostr.rs` post DreamLab forum 31402 events.
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
