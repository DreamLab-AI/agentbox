---
id: ADR-2135
title: Use Jev to time the advisor — jev-checkpoints, with spawn routing shadow-only
date: 2026-10-09
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 9173cdba6f0a84556bbd4c059db0a7e823aa7a2d
verified_paths: [agentbox.toml, schema/agentbox.toml.schema.json, management-api/lib/system-manifest.js, flake.nix, config/entrypoint-unified.sh, config/claude-plugins/.claude-plugin/marketplace.json, scripts/ci/check-manifest-catalogue.js, tests/config/jev-checkpoints.test.mjs, tests/config/factrail-projection.test.sh, tests/config/ruflo-console.test.mjs]
owner: jjohare
review_trigger: the first soak report of injections per hundred turns and USD per session, a measured shadow-log agreement rate for spawn routing (ADR-2110 labels), a change to the advisor checkpoints in ADR-2134, or a Claude Code function-hook API change
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: ADR-2134 (the advisor whose consult timing this judges), ADR-2121 (factrail precedent: plugin, gate, egress carve-out), ADR-2090 (egress being widened), ADR-2094 (local backend), ADR-2110 (teacher labels)
---

# ADR-2135 — Use Jev to time the advisor — jev-checkpoints, with spawn routing shadow-only

## Context

ADR-2134 gives the Sonnet lead an Opus advisor but leaves *when* to consult it to the lead's judgement, which is weakest exactly where it matters: a turn that claims "done" without a verifying run, a fix attempted for the third time against the same failure, a plan that touches a contract. Opus is the expensive resource, so consult timing is a cheap-classifier problem. Jev (TypeSafe System One) already scores typed questions for under a cent (ADR-2091, ADR-2121). Prior art: pi-warden's done-claim and retry guards; compact-adviser timing. The counter-evidence is `suenot/codex-jev-router`: Jev-chosen subagent models came out 27% cheaper than fixed strong-tier children but 69.7% dearer than one strong agent, so letting Jev *pick models* is not established.

## Decision

1. **Plugin.** `jev-checkpoints` (0.1.0, `MIT OR Apache-2.0`) is a Claude Code function-hook plugin authored in `config/claude-plugins/jev-checkpoints/`, baked into the `agentbox` directory marketplace, installed as `jev-checkpoints@agentbox` in the root session only. It injects at most one advisory line of 300 characters per checkpoint per turn and never forces a tool call or blocks.
2. **Checkpoints**, each switchable in `[features.jev_checkpoints]`: *done* (Jev Score ≥ `done_threshold` that a completion claim had no successful test/build/lint/type-check this turn: ADR-2134 checkpoint 3); *repeat* (the same normalised failure fingerprint `repeat_count` times; local only, never calls Jev: checkpoint 2); *plan* (Score ≥ `plan_threshold` that a prompt needs a multi-file plan or touches an auth/schema/API/data contract: checkpoint 1); *spawn* (Jev Choice over haiku|sonnet|opus|inherit).
3. **Spawn routing is shadow-only by default.** `spawn_mode = "shadow"` records each decision (digest, never prompt text) to files `shadow-<session>[.N].jsonl` beside the `shadow_log` base path (glob `shadow-*.jsonl`) and alters nothing; the log feeds ADR-2110 teacher labels. `enforce` rewrites only an unset model, at or above `spawn_min_confidence`, never above the main model, and is not enabled by this ADR.
4. **Egress widens ADR-2090 the way ADR-2121 did.** Sent: prompt text (plan), assistant final text (done), subagent description/prompt head (spawn), each clamped head 9000 / tail 3000, plus tool-call names with ok|error. Never tool-result contents. Email carve-out: a session that has ever made an `mcp__email-gateway__*`/Gmail call or loaded `email-search` is never sent to a cloud judge for the rest of its life (the local repeat check still runs); a backend is local only when declared (`backendLocal`, below). Fail-open on any error, timeout, 429 or missing key.
5. **Wiring.** `[features.jev_checkpoints].enabled = true` is rebuild-class for the plugin (`flake.nix` drops the tree from the baked config when off and strips `*.test.ts`) and boot-class for the projection (`config/entrypoint-unified.sh`: manifest values projected as camelCase userConfig; cache compared to the baked tree by content and reinstalled on difference; off uninstalls). `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` and the `agentbox` marketplace are kept while any of factrail, ruflo-console or jev-checkpoints is on. `backendLocal` is an explicit boolean, never inferred from the `api` string (ADR-2094 §5): the entrypoint sets it true only from the resolved sovereign-System-One config with no manifest `api`; an explicit `api`, with or without the façade, leaves it false so the email fence holds. The fence's `taintTools`/`taintSkills` are projected from `[features.jev_compaction]`'s lists, one definition for both Jev plugins. `timeout_ms` is capped at 8000 (hook budget 10 s). The key is the environment's `TYPESAFE_API_KEY`, as for factrail; it is never a userConfig value and no `/nix/store` path is written.

## Consequences

- A third consumer of the Jev wire protocol and a second function-hook plugin; both share one marketplace and one env switch, which is why the factrail and ruflo-console blocks now test three gates.
- Cost is one Jev request per qualifying event (about $0.005 order of magnitude); done and plan are the only cloud calls. No measurement of the saving in Opus consults exists yet — ADR-2134's advisor cost is the thing to watch.
- ADR-2121's governed paths `config/entrypoint-unified.sh`, `config/claude-plugins/.claude-plugin/marketplace.json`, `schema/agentbox.toml.schema.json`, `tests/config/factrail-projection.test.sh` and `tests/config/ruflo-console.test.mjs` change (shared-keep logic, one catalogue entry, one test boundary); ADR-2121 is not re-verified here.
- Spawn enforcement needs the shadow log to show agreement with a strong-tier baseline before any change of default; until then the 69.7% result stands as the working prior.
- Activation needs the host rebuild, a Claude Code ≥ 2.1.294, and a soak of injection rates; the image and boot are unverified until `./agentbox.sh rebuild` runs.

## Verification

Gate `node --test tests/config/jev-checkpoints.test.mjs` (manifest defaults, schema closure and ranges, validator accept/reject, catalogue entry, marketplace entry, flake gating text, entrypoint projection keys and shared-keep logic, `_jk_project` behaviour, plugin `userConfig` coverage once the plugin source is present). Also `bash tests/config/factrail-projection.test.sh`, `node --test tests/config/ruflo-console.test.mjs`, `scripts/agentbox-config-validate.js agentbox.toml`. `nix flake check` and the entrypoint's `claude plugin` calls have not run: no Nix here, and builds are host-only. `verified_commit` is stamped by the coordinator after merge.

## Re-verification — 2026-10-13 at `044f1d689`

The decision holds. Every claim below was checked against the code, and the tripped hunks are unrelated to it.

Claims checked:

- plugin jev-checkpoints 0.1.0, MIT OR Apache-2.0, in config/claude-plugins/jev-checkpoints, listed in marketplace.json
- flake.nix drops the tree when [features.jev_checkpoints].enabled is off and strips *.test.ts
- entrypoint projects manifest values as camelCase userConfig; cache compared by content; off uninstalls; stamp of config
- CLAUDE_CODE_ENABLE_FUNCTION_HOOKS and agentbox marketplace kept while any of factrail, ruflo-console, jev-checkpoints is on
- backendLocal explicit, never inferred from api; explicit manifest api leaves it false; taintTools/taintSkills projected from [features.jev_compaction]
- timeout_ms capped at 8000; key is env TYPESAFE_API_KEY, never userConfig; spawn_mode shadow default
- fail-open; email-tainted session never sent to cloud judge
- named gate tests pass

Evidence:

- node --test tests/config/jev-checkpoints.test.mjs → 12/12 pass, 0 fail (covers manifest defaults, schema closure, catalogue, marketplace, flake gating, entrypoint keys, shared-keep, _jk_project, backendLocal, bash syntax, plugin userConfig coverage)
- bash tests/config/factrail-projection.test.sh → 8/8
- flake.nix:1809 jevCheckpointsOn; :2092 drops the jev-checkpoints tree unless on
- entrypoint (218dc12c3) _JK_ON in function-hook and marketplace keep conditions; _jk_project; backendLocal=false default, true only via plugin-config line 'backendLocal=true' with empty manifest api
- config/claude-plugins/jev-checkpoints/hooks/jev.ts:105-110 egress(): tainted && backendLocal!==true → no go; key only sent to TypeSafe host; git log shows plugin dir unchanged since verified commit
- services/agentbox-manifest/src/system_one.rs:361 'backendLocal={b.local}' (declared per backend), :11 'Locality is declared, never inferred'
- diff hunks since 6d54c0c22 are ADR-2140 loom_sync, ADR-2139 system_one slot, ADR-2133 flags, mcp-mirror-server, ADR-2134 catalogue/notes — unrelated insertions

Commands run: `node --test tests/config/jev-checkpoints.test.mjs; bash tests/config/factrail-projection.test.sh`

Not checked, and notes: Verdict is holds because the email fence and declared-locality property still hold end to end and the record's own gate is green. Behind the System One proxy the plugin still needs TYPESAFE_API_KEY only when api is the TypeSafe host; with the loopback proxy it goes keyless (hook design), and the entrypoint prints no missing-key line for jev-checkpoints in that mode (not claimed by the ADR). Image/boot unverified (staged).

Checked at `218dc12c3` by reading each claim against the code, not by the staleness diff alone. Stamped at `044f1d689`, which adds only the gate fixes in `config/custody/env-classes.json`, the `check-manifest-catalogue` baseline, `services/agentbox-vex`'s README and licence notice, a stale `agentbox.toml` comment, a stale `paths` example in the ontology-augment docs, and the grounding test's stub.

**Re-verified 2026-10-16 at `efa293b8799b`.** The only change to a governed path is the sidecar-first Blender work (ADR-2142): `agentbox.toml` gains `[skills.spatial_and_3d].blender_local = false`; `flake.nix` narrows one `lib.optionals` condition (`wrapGpuBin pkgs.blender` now needs `blender && blender_local`), adds one `ENABLE_BLENDER_LOCAL` env line and reworks a comment; `schema/agentbox.toml.schema.json` gains the `blender_local` boolean; `management-api/lib/system-manifest.js` gains a `blender-local` catalogue entry and a corrected `blender-mcp` summary. `scripts/ci/check-manifest-catalogue.js`, which this record's gate relies on, failed on the new `blender_local` key until the catalogue entry was added; it passes at this commit. The decision holds. Re-verified by `git diff <previous verified_commit>..efa293b8799b -- <verified_paths>`; no re-implementation was needed.

**Re-verified 2026-10-17 at `e8d59c23c`.** The only change on a governed path since the previous verification is the flat-vault pages default (agentbox `a2c6d5520`, ADR-2028 amendment; Ontomark ADR-OM-007): `[vault].pages = "."` in `agentbox.toml` and the default manifest, the schema default and description for that key, the entrypoint deriving `VAULT_PAGES`/`VAULT_WORKING_PAGES` from it, and the ontology skills' corpus-verb names (`ontomark find|retrieve|tree`). None of it touches this record's decision. Re-verified by `git diff efa293b87..e8d59c23c -- <verified_paths>`; no re-implementation was needed.

Re-verified 2026-10-17 against `f33c4fc030d199ce957f7ba274d428bc6475c159`: the governed-path delta from the flat-vault amendment is the DeepSeek model/default and MCP metadata refresh plus ownership reconciliation for the OpenCode state directory. The reviewed change preserves this record’s capability, identity, memory, vault and isolation invariants; status axes are unchanged.

Re-verified 2026-10-19 at `dfe78f0766e52ae6cfbae32c395e22c9590d6785`: Reviewed governed-path changes: the flake only repins the vault source; the entrypoint delta corrects the role-isolation class comment; the catalogue makes the baked privilege change rebuild-class. No ingress, retrieval geometry, capability gate, image-delivery or subsystem runtime configuration is changed by those deltas. Existing implementation and activation statuses are retained.

Re-verified 2026-10-19 at `52183d76fde866ab1f05aea524aeea33d8573c3f`: The reviewed flake delta adds the local-cuda-gated stable nvcc link, and the entrypoint/catalogue propagate and describe its scoped host compiler. Backend and wrapper gates pass (23 and 21 assertions); no ingress, role isolation, durable adapter, retrieval or subsystem gate is changed. Image evidence will be regenerated for the new layer closure. Existing status axes are retained.

Re-verified 2026-10-19 at `3acd4fa08f06e2c4543debd46f0ce51605033d3e`: the reviewed delta adds the collaboration and welfare floor (ADR-2144) — one new manifest key `[claude_code].floor`, a floor block and managed-path projection in the entrypoint's instructions and Codex-append sections, two `instructions-project` flags in `agentbox-manifest`, and `config/hooks/decline-recorder.cjs`. No ingress, role isolation, durable adapter, retrieval, skill-routing or compaction mechanism this record governs is changed; its gates pass unchanged. Existing status axes are retained.

Re-verified 2026-10-20 at `61f27d5b375f9838ef7b7334e3f984d0d4a9ea70`: reviewed the governed-path delta for the managed floor (ADR-2144) and alpha.17 forge/proxy launcher (ADR-2145). The schema and capability catalogue now register these settings, with boot-class floor projection and rebuild-class forge/proxy changes. Bridge path dependencies use the same alpha.17 source as the server; the independent core-only registry dependency retains its upstream pin. Claude Code 2.1.304 and Codex 0.163.0 retain the full upstream package resources. Manifest validation, all 94 catalogue gates, 37 targeted Node tests, 12 instruction-layer assertions and skill lint pass. No ingress publication, adapter dispatch, retrieval geometry, mount or role-isolation gate changes. Build and activation evidence is pending; existing status axes are retained.

Re-verified 2026-10-20 at `653b8b6387470eaa3be6c20e6dbd2208e538a985`: reviewed the merged activity-sink registration in the root entrypoint and profile projector, its default-off manifest gate, schema and boot-class catalogue entry. The hook remains inactive; no sink URL, token or new prompt egress is configured. The independent managed floor remains on. Claude Code 2.1.304 and Codex 0.163.0 change pinned CLI resources, not the Jev/factrail hook protocol; their existing replay mechanisms are unchanged. Activity-sink and hook-registration tests pass (50), the Rust projector suite passes (196), manifest validation and all 95 catalogue gates pass, and the generated egress register is in sync. No changed ingress binding, mount, role isolation, retrieval geometry or adapter dispatch. Build and activation checks remain pending. Existing status axes are retained.

Re-verified and deployed 2026-10-20 at `dd6ff7e065a9a2851f7cfa9fa8c71305ce2a8782`: the reviewed flake/Compose delta adds only a root-owned 1 MiB tmpfs at `/etc/claude-code` so boot can project the managed floor on the read-only rootfs. Live file is uid 0, mode 0644, agent-readable and agent-unwritable; the same floor is present in the 13,605-byte Codex instructions. Root and all eight Claude profiles each register the three decline events once. Native pod alpha.17 serves `/forge` (HTTP 200), with testnet policy and zero mirror follows/announce relays; activity sink remains off. Readiness has no degradation, 32 persistent mounts are unchanged, and the other 17 containers are unchanged (speech-to-text was separately rebuilt for its tested marker-ordering fix). The image SBOM/VEX evidence was regenerated for the shipped image; this does not claim an online vulnerability scan or cover the host and sidecars. Existing decision and status axes are retained unless the record explicitly states activation below.


## Re-verification — 2026-10-21

The manifest diff only selects minimal thinking and a 20-minute cap for the final deepsec sweep; feature gates, identity policy, corpus paths and memory geometry are unchanged. The composition diff refreshes locked package/source versions and the Go compiler for web-researcher. Supervisor blocks, ingress bindings, adapter dispatch and persistent mounts are unchanged. The generated Compose file is byte-identical. Ruflo console/mods/swarm versions match the v3.57.0 source; the routeTasks-off patch retains the upstream advisory continuation. All 18 plugin bake/registration tests pass against the real pinned tree. Factrail and Jev entries are unchanged. Manifest validation, the 95 catalogue gates, 45 agent-reconciliation checks and 25 role-supervisor checks pass. This is source verification; image activation and live checks remain separate deployment evidence.

Re-verified at `c8c20341c66feec751fe6234167c220c70fe2ffb`: the only governed code delta is the REUSE
Sphinx builder string correction. Both documentation outputs and all 872
enabled package tests pass; 23 runtime-delivery checks pass. Runtime
boundaries and activation status are unchanged.

Re-verified at `9173cdba6f0a84556bbd4c059db0a7e823aa7a2d`: the governed delta isolates Typepy 1.3.5
and fixes wrapper arguments for host-only sbomnix. Its dependency suites
pass (834 Typepy, 1682 SimpleSQLite), 23 delivery checks pass, and an actual
shipped-path smoke scan emits CycloneDX, SPDX and CSV. Runtime and activation
contracts remain unchanged.
