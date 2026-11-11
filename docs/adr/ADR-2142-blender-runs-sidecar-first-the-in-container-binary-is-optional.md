---
id: ADR-2142
title: Blender runs sidecar-first; the in-container binary is optional
date: 2026-10-16
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: a1d16473eae05231588c2ff05f196a8882e1913c
verified_paths: [agentbox.toml, flake.nix, skills/blender/tools/blender-job.js, skills/blender/tools/blender-introspect.js, skills/blender/tools/blender-batch.sh, skills/blender/SKILL.md, skills/uk-solar-planner/SKILL.md, skills/game-dev/tools/engine-check.sh, tests/toolchains/blender-present.sh]
owner: jjohare
review_trigger: the image rebuild activates the change, the GPU sidecar (gui-tools-service) or its shared volume changes, a local-Blender consumer is added, or `blender_local` is flipped in the shipped manifest
repo: agentbox
---

# ADR-2142 — Blender runs sidecar-first; the in-container binary is optional

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
- BlenderMCP needs an OpenGL context in Blender's GUI event loop; the in-container display has none, so interactive Blender already lives in the GPU sidecar (`gui-tools-service`) behind the `blender-mcp` proxy.
- Headless batch work used the in-container `pkgs.blender` (`wrapGpuBin`), a large closure with its own vulnerability surface (ADR-2137) and no GPU render path of its own.
- `/home/devuser/gui-tools` here and `/home/devuser/exchange` in the sidecar are one volume (verified bidirectional 2026-10-15), so a job can be staged, run there and read back without a socket transfer.
- The two gates were conflated: `skills.spatial_and_3d.blender` gated both the proxy and the package.

## Decision
- `[skills.spatial_and_3d].blender` gates the skill, the `blender-mcp` proxy and its supervisor block. A new `blender_local` (boolean, default true when absent) gates only the in-container binary. The catalogue lists them as `blender-mcp` and `blender-local` (`apply_class: 'rebuild'`).
- This deployment sets `blender_local = false`. Scripted builds and renders go through `skills/blender/tools/blender-job.js` (stage, submit, status, tail, wait, list, cancel) into the sidecar; `blender-batch.sh` exits 2 with a pointer when no local binary exists.
- The job runner treats the shared volume as untrusted: it refuses symbolic links on both sides of `stage`, opens state files with `O_NOFOLLOW`, records a `/proc` start time with each pid and verifies it before reporting a job running or signalling it, and creates no job directory before the sidecar has answered.
- Consumers of Blender (`uk-solar-planner`, `game-dev`) must not assume a local binary unless `blender_local` is true or absent.

## Consequences
- The activated image drops the in-container `blender` binary and its closure from this deployment; `blender-present.sh` skips (exit 77) once the key is false.
- There is no local fallback when the sidecar is down: jobs and interactive work fail with exit 2 until `./agentbox.sh gui-tools up`. This is the accepted trade for a smaller image and GPU renders on the sidecar.
- ADR-2137: existing image VEX statements bound to Blender and its dependency PURLs must be withdrawn and regenerated from the next image's `image.layers.paths`.
- ADR-2132: the activated candidate drops the Blender layer; the prepare/activate flow itself is unchanged.
- Scripts run in the sidecar see the repository only through staged files and use the `exchange` path spelling; the sidecar's Blender build can differ from the one that used to be baked, so run `blender-introspect.js version` before relying on an API.
- Implementation is complete and tested (`skills/blender/tools/tests/`); activation was verified on 2026-10-16 with the rebuilt image and a completed sidecar render. Revert: `blender_local = true` and rebuild.

## Activation evidence (2026-10-16)

Image source `9fcd1eef98b2a3eb8469df0fb6bf62ec7a34cc76` is active. No local `blender` command is present; baked API introspection reports sidecar Blender 5.2.0 LTS. Job `deploy-20261016-smoke` exited 0 and produced `smoke.png` using OptiX on NVIDIA RTX 6000 Ada GPUs. All 32 persistent mounts and 16 sidecar container identities were preserved. Fresh SBOM/VEX evidence was generated from the candidate image layers.

**Re-verified 2026-10-17 at `e8d59c23c`.** The only change on a governed path since the previous verification is the flat-vault pages default (agentbox `a2c6d5520`, ADR-2028 amendment; Ontomark ADR-OM-007): `[vault].pages = "."` in `agentbox.toml` and the default manifest, the schema default and description for that key, the entrypoint deriving `VAULT_PAGES`/`VAULT_WORKING_PAGES` from it, and the ontology skills' corpus-verb names (`ontomark find|retrieve|tree`). None of it touches this record's decision. Re-verified by `git diff 9fcd1eef9..e8d59c23c -- <verified_paths>`; no re-implementation was needed.

Re-verified 2026-10-17 against `f33c4fc030d199ce957f7ba274d428bc6475c159`: the governed-path delta from the flat-vault amendment is the DeepSeek model/default and MCP metadata refresh plus ownership reconciliation for the OpenCode state directory. The reviewed change preserves this record’s capability, identity, memory, vault and isolation invariants; status axes are unchanged.

Re-verified 2026-10-19 at `dfe78f0766e52ae6cfbae32c395e22c9590d6785`: Reviewed governed-path changes: the flake only repins the vault source; the entrypoint delta corrects the role-isolation class comment; the catalogue makes the baked privilege change rebuild-class. No ingress, retrieval geometry, capability gate, image-delivery or subsystem runtime configuration is changed by those deltas. Existing implementation and activation statuses are retained.

Re-verified 2026-10-19 at `52183d76fde866ab1f05aea524aeea33d8573c3f`: The reviewed flake delta adds the local-cuda-gated stable nvcc link, and the entrypoint/catalogue propagate and describe its scoped host compiler. Backend and wrapper gates pass (23 and 21 assertions); no ingress, role isolation, durable adapter, retrieval or subsystem gate is changed. Image evidence will be regenerated for the new layer closure. Existing status axes are retained.

Re-verified 2026-10-19 at `3acd4fa08f06e2c4543debd46f0ce51605033d3e`: the reviewed delta adds the collaboration and welfare floor (ADR-2144) — one new manifest key `[claude_code].floor`, a floor block and managed-path projection in the entrypoint's instructions and Codex-append sections, two `instructions-project` flags in `agentbox-manifest`, and `config/hooks/decline-recorder.cjs`. No ingress, role isolation, durable adapter, retrieval, skill-routing or compaction mechanism this record governs is changed; its gates pass unchanged. Existing status axes are retained.

Re-verified 2026-10-20 at `61f27d5b375f9838ef7b7334e3f984d0d4a9ea70`: reviewed the governed-path delta for the managed floor (ADR-2144) and alpha.17 forge/proxy launcher (ADR-2145). The schema and capability catalogue now register these settings, with boot-class floor projection and rebuild-class forge/proxy changes. Bridge path dependencies use the same alpha.17 source as the server; the independent core-only registry dependency retains its upstream pin. Claude Code 2.1.304 and Codex 0.163.0 retain the full upstream package resources. Manifest validation, all 94 catalogue gates, 37 targeted Node tests, 12 instruction-layer assertions and skill lint pass. No ingress publication, adapter dispatch, retrieval geometry, mount or role-isolation gate changes. Build and activation evidence is pending; existing status axes are retained.

Re-verified 2026-10-20 at `653b8b6387470eaa3be6c20e6dbd2208e538a985`: reviewed the merged activity-sink registration in the root entrypoint and profile projector, its default-off manifest gate, schema and boot-class catalogue entry. The hook remains inactive; no sink URL, token or new prompt egress is configured. The independent managed floor remains on. Claude Code 2.1.304 and Codex 0.163.0 change pinned CLI resources, not the Jev/factrail hook protocol; their existing replay mechanisms are unchanged. Activity-sink and hook-registration tests pass (50), the Rust projector suite passes (196), manifest validation and all 95 catalogue gates pass, and the generated egress register is in sync. No changed ingress binding, mount, role isolation, retrieval geometry or adapter dispatch. Build and activation checks remain pending. Existing status axes are retained.

Re-verified and deployed 2026-10-20 at `dd6ff7e065a9a2851f7cfa9fa8c71305ce2a8782`: the reviewed flake/Compose delta adds only a root-owned 1 MiB tmpfs at `/etc/claude-code` so boot can project the managed floor on the read-only rootfs. Live file is uid 0, mode 0644, agent-readable and agent-unwritable; the same floor is present in the 13,605-byte Codex instructions. Root and all eight Claude profiles each register the three decline events once. Native pod alpha.17 serves `/forge` (HTTP 200), with testnet policy and zero mirror follows/announce relays; activity sink remains off. Readiness has no degradation, 32 persistent mounts are unchanged, and the other 17 containers are unchanged (speech-to-text was separately rebuilt for its tested marker-ordering fix). The image SBOM/VEX evidence was regenerated for the shipped image; this does not claim an online vulnerability scan or cover the host and sidecars. Existing decision and status axes are retained unless the record explicitly states activation below.


## Re-verification — 2026-10-21

The manifest diff only selects minimal thinking and a 20-minute cap for the final deepsec sweep; feature gates, identity policy, corpus paths and memory geometry are unchanged. The composition diff refreshes locked package/source versions and the Go compiler for web-researcher. Supervisor blocks, ingress bindings, adapter dispatch and persistent mounts are unchanged. The generated Compose file is byte-identical. Manifest validation, the 95 catalogue gates, 45 agent-reconciliation checks and 25 role-supervisor checks pass. This is source verification; image activation and live checks remain separate deployment evidence.

Re-verified at `c8c20341c66feec751fe6234167c220c70fe2ffb`: the only governed code delta is the REUSE
Sphinx builder string correction. Both documentation outputs and all 872
enabled package tests pass; 23 runtime-delivery checks pass. Runtime
boundaries and activation status are unchanged.

Re-verified at `9173cdba6f0a84556bbd4c059db0a7e823aa7a2d`: the governed delta isolates Typepy 1.3.5
and fixes wrapper arguments for host-only sbomnix. Its dependency suites
pass (834 Typepy, 1682 SimpleSQLite), 23 delivery checks pass, and an actual
shipped-path smoke scan emits CycloneDX, SPDX and CSV. Runtime and activation
contracts remain unchanged.

## Re-verification — 2026-10-21 at 73bd631c0

Reviewed the committed change to the Codex home: the parent tmpfs becomes a
named volume; its package volume and credential bind remain independent. No
supervisor, ingress, toolchain, feature-gate, scanner or instruction-projector
code changes. Compose persistence and runtime-delivery checks pass (24 tests),
Compose refresh checks pass (3 tests), and role-supervisor checks pass (25 tests).
This mount migration is explicitly outside fast activation (ADR-2147).

## Re-verification — 2026-10-21 at 395380f71

Reviewed the committed remote-media change against this record. Nix changes
only the ComfyUI MCP dependency closure and its existing builtin/external gates;
`skills/mcp.json` changes only Blender's declared protocol. Blender's optional
local binary, proxy and background-job safety boundaries remain intact. No
identity, ingress, daemon role, instruction projection, persistent mount, scanner
or vendor-routing behavior changes. Media checks pass: 23 Node tests, 12 graph
client tests and 9 downloader tests. Runtime/Compose checks pass (27 tests),
role-supervisor checks pass (25), skills lint and loopback-port checks pass.
Sidecar image activation is tracked separately in the host deployment receipt.

## Bridge example verification — 2026-10-21

At `f67874c7e`, the Blender skill's JSON example now names the same baked
Node bridge as `register-mcp.sh`; the sidecar proxy, optional local binary
gate and background-job implementation are unchanged. The MCP protocol and
Blender tool tests pass (23 media Node tests); this is a documentation fix.

Re-verified 2026-10-22 at `0382cc4b5e34f75a62184bf350f865533010dc52`: reviewed the delta adding an independent, opt-in Isaac Sim lifecycle and live-class service catalogue entry, the 130th routed skill, pinned regional ComfyUI nodes/model metadata, and Blender background Python failure propagation. Existing ingress, role isolation, instruction projection, durable adapters, retrieval geometry, System One selection and image evidence boundaries are unchanged. Isaac runner/contract (15), GPU picker, launcher selection, Blender bridge (19), role supervisor (25), skill lint and catalogue checks pass. Isaac vendor-image and fixture verification remains staged until executed.

Re-verified 2026-10-23 at `951ada931e235ad45b61b2bef90b7e5c76f8d76c`: flake.nix delta does not touch Blender. Re-read at HEAD: the `blender && blender_local` condition on `wrapGpuBin pkgs.blender` (flake.nix:1504), `ENABLE_BLENDER_LOCAL` (flake.nix:4371), and the shipped manifest still has `blender_local = false` (agentbox.toml:635). `node scripts/ci/check-manifest-catalogue.js` passes (95 gate paths) in a detached worktree at HEAD. No image rebuild or sidecar run.

### Re-verification — 2026-10-29 (ADR-2154 Pele renderer)

`21769a881..d1dd896f4`: `flake.nix` replaces the `mermaidSidecarCliPkg` shell wrapper with `lib/pele.nix` (`pele-render` and an `mmdc` shim, still gated by `[skills.docs].mermaid`) and puts the two commands in `npmCliGatedPackages` in its place; no other gate, pin or supervisor text changes. Nothing ADR-2142 governs changes meaning. The decision holds. Re-verified by reading `git diff 21769a881..d1dd896f4 -- flake.nix` (new hunks only). Nix was not evaluated here; the image is unverified until the host rebuild.


Re-verified 2026-10-29 at `00039efb1e4a70402df86ad19cf76894fe3b9a8f` for ADR-2155. Reviewed the typed-decision activation diff against this record: the changed manifest, bootstrap, catalogue or source-pin hunks do not alter its governing boundary. Existing status axes and runtime evidence limits are retained. No image or service activation is claimed.

Re-verified 2026-10-30 at `29a4b4939`: the agentbox.toml delta is three lines inside [system_one] only (bind 0.0.0.0:8094, network = true, local_only = []); this record's sections are untouched.

Re-verified 2026-10-30 at d0e9ca786: the only change to the governed paths is the new `[system_one].skill_list_at_least` key and its schema property (router runner-up listing, ADR-2091); no section this record governs changed.

Re-verified 2026-10-31 at `b65c3d4ed`. Governed paths changed: `agentbox.toml`: comments only: corpus verbs named as `ontomark`, flat-layout wording (`f4beec643`, `7aa9365d4`); `flake.nix`: the ontomark comment now names the verbs it owns (`4a07fbfb3`). No section this record governs changed; the decision holds. Re-verified by `git diff d0e9ca786..b65c3d4ed -- <verified_paths>`; no re-implementation was needed. The image carries it at the next rebuild.

Re-verified 2026-10-31 at `97f298db5`: the only delta on this record's governed paths since the previous verification is the sprint-W7 additive work (ADR-2139 Decision 5 `state_budget_tokens`; ADR-2090 `bypass_projects`): new optional keys that default to today's behaviour, in agentbox.toml. None of it touches this record's decision. Re-verified by `git diff 753788564..97f298db5 -- <governed paths>`; status axes unchanged.

## Re-verification — 2026-10-31 (`1e41b64b624af97cf49771d08da82fbf3743acbd`)

Tripped by the W8 ADR-sprint changes. Governed-path delta since `753788564`: `agentbox.toml` gains only four `[model_routing.routes]` entries (`diagram-polish`, `diagram-narrative`, `diagram-synthesis`, `seal-review`) and a comment block (ADR-2130). No key, table or code path this record decides is touched, so the decision and status axes are unchanged. Judged from the diff (re-runnable: `git diff 753788564..1e41b64b6 -- agentbox.toml flake.nix skills/blender/tools/blender-job.js skills/blender/tools/blender-introspect.js skills/blender/tools/blender-batch.sh skills/blender/SKILL.md skills/uk-solar-planner/SKILL.md skills/game-dev/tools/engine-check.sh tests/toolchains/blender-present.sh`; re-run at integration and the summary above matches it), not by re-running this record's own acceptance checks.

Re-verified 2026-10-31 at `2f15c531b02b8f8393d68d29ce3491712bdd862c` (W7 and W8 integration, `adr-sprint/w78`). Governed-path delta since `97f298db5`: `agentbox.toml`: the four `[model_routing.routes]` diagram routes with their comment block (ADR-2130), and a wording fix on the `bypass_projects` comment (brackets forbidden, scoped to skill routing; ADR-2090). Read from the diff and checked against the merged tree's gates (cargo, jest, validator); nothing it changes is a key, table or code path this record decides, so the decision and status axes are unchanged. Re-run: `git diff 97f298db5..2f15c531b -- agentbox.toml`.

## Re-verification — 2026-11-01 (`cc949bb79`)

Governed-path delta since `2f15c531b` is the RuVector Postgres credential custody change (ADR-2164 amendment 2), nothing else:

- `agentbox.toml`: the two `conninfo` URLs drop the `@@RUVECTOR_PG_PASSWORD@@` placeholder password, with their comments.
- `flake.nix`: removes the claude-flow config template (`claudeFlowConfigJson` and its `cp`) and the baked `RUVECTOR_PG_CONNINFO` image Env entry, and rewords one dream-engine supervisor comment.

Nothing this record decides is changed; its status axes are unchanged. Re-run: `git diff 2f15c531b..cc949bb79 -- agentbox.toml flake.nix`.

Re-verified 2026-11-05 at `3beca506c` for ADR-2177: the only change to this record's governed paths since its last stamp is ADR-2177's additive SuperSplat hunk (a gated package set and supervisor block, one toml/schema key, a skill registration); this record's decision is unaffected.

Re-verified 2026-11-10 at `571c0ad43` (PR #45, ADR-2191, the Bend toolchain). Governed-path delta since `e2b49adfc`: `agentbox.toml` gains `[toolchains].bend = true`; `flake.nix` gains `bendLib` and `bendPackages`, one `++ bendPackages` in `allPackages` and one in the `toolchains` layer group, and `ENABLE_BEND` in the image environment. Every hunk is an addition apart from one re-wrapped line in the `toolchains` layer group. The change adds a gated language toolchain and no listener, published port, mount, volume, supervisor program, secret, identity, model route, vault path, registry entry or Nostr kind, and it alters no existing gate, so what this record decides is not touched. CI on that commit passed the flake evaluation on both architectures, config validation with the TUI round trip, the contract and adapter suites and the custody rehearsal. Re-run: `git diff e2b49adfc..571c0ad43 -- <verified_paths>`.

Re-verified 2026-11-11 at `237178730` (ADR-2192, ADR-2193, ADR-2194 at `04638a618`; ADR-2195 at this commit). Governed-path delta since `571c0ad43`: `agentbox.toml` gains `[skills.routing] scope = "all"` (ADR-2192) and `cad = false`, `cad_print = false` under `[skills.spatial_and_3d]` (ADR-2195); `flake.nix` gains `supervisordLauncher`, listed ahead of `pythonRuntimeEnv` in `pythonBasePackages` (ADR-2193: PID 1 is started by the runtime env's interpreter; the entrypoint's `exec supervisord` line is unchanged), `motionRenderPkg` in `skillToolPackages` (ADR-2194), and the CAD gate (ADR-2195): `cadLib`, `cadEnabled`, two gated additions to `spatialPackages`, a gated `[program:cad-engine]` block bound to `127.0.0.1:3245`, gated `/usr/share/fonts` links and `ENABLE_CAD` in the image environment. **Review trigger considered** (a local-Blender consumer). `cad-render` uses the `bpy` Python wheel inside the CAD engine, gated by `cad` and off. It does not use the `blender` binary, `blender_local`, the proxy or the sidecar job tools, and `blender_local` is not flipped. Run on this commit in the container: the configuration jest suites (294 passed), `skill-lint`, `skill-count-check`, the manifest validator, the egress register check, the secret inventory, the crate licensing check, the role-isolation and runtime-contract shell tests, `python-runtime-path` and `cad-launcher`. The flake was NOT evaluated (no Nix in the container) and no image has been built from it. The decision and status axes are unchanged. Re-run: `git diff 571c0ad43..237178730 -- <verified_paths>`.

Re-verified 2026-11-11 at `1e7d1d2b2`. Governed-path delta since `237178730`: `agentbox.toml` only, where `[skills.spatial_and_3d]` `cad` and `cad_print` go from `false` to `true` (ADR-2195, operator's decision) and their comment is reworded. No other key changes. The gated additions this turns on are the ones the previous note describes as gated off: the CAD launcher, wheelhouse and Xvfb in `spatialPackages`, `[program:cad-engine]`, the `/usr/share/fonts` links and, for `cad_print`, OrcaSlicer. None has been evaluated or built. The manifest validator and `tests/config/cad-launcher.test.sh` (35) pass on this commit.

Re-verified 2026-11-11 at `a1d16473e` (skill-estate audit). Governed-path delta since `1e7d1d2b2`: `agentbox.toml` sets `[system_one.consumers].skill_intent = false` (it doubled each routed turn's input for a blind pick that was never adopted; identical picks on the 86 labelled cases at half the cost) and rewords one comment under `[skills.routing]` (the hook is registered with an 8 s timeout); no other key changes. No published port, mount, secret, identity, route, vault path or registry entry changes, so what this record decides is not touched. Run on this commit: skill lint and its self-test, skill-count, routing-table, the manifest validator, the router jest suites (104) and configuration jest (301), corpus and parity tests (the corpus's baked-versus-repo comparison fails in this container until the next rebuild carries the new descriptions; CI has no baked tree and skips it). The decision and status axes are unchanged.
