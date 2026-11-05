---
id: ADR-2165
title: VisionCraft owns the portable quality method; Agentbox supplies installation and policy
date: 2026-11-03
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 3beca506c1d44122bf2e14ed935d590b9d020233
verified_paths: [services/agentbox-manifest/src/deepsec_gate.rs, services/agentbox-manifest/src/visioncraft_source.rs, services/agentbox-manifest/src/jsonio.rs, services/agentbox-manifest/src/mcp.rs, services/agentbox-manifest/src/mcp_hub.rs, services/agentbox-manifest/tests/deepsec_gate.rs, services/agentbox-manifest/tests/aqe.rs, tests/config/visioncraft-deepsec.test.mjs, tests/config/visioncraft-aqe.test.mjs, tests/system-one/visioncraft-picker.test.mjs, config/visioncraft-source.json, lib/lockfiles/visioncraft-0.2.0.Cargo.lock, lib/visioncraft.nix, lib/agentbox-manifest.nix, flake.nix, skills/visioncraft, skills/registered-skills.txt, skills/codex-registered-skills.txt, scripts/reconcile-skills.sh, services/agentbox-manifest/src/main.rs, tests/config/visioncraft-cutover.test.mjs]
owner: jjohare
review_trigger: a VisionCraft release, a Deepsec protocol change, or discovery of a second active quality implementation
repo: agentbox
domain: GOVERNANCE-capabilities
evidence_class: source+test
acceptance_boundary: source and offline consumer checks; running image acceptance requires the subsequent rebuild
---

# ADR-2165 — VisionCraft owns the portable quality method

## Context

The local build-with-quality skill combined a substantial engineering method,
host-specific policy and an executable review wrapper. Old package API claims,
inactive configuration and duplicated routing assumptions made ownership unclear.
The operator requested an independent reusable module and a hard Agentbox cutover.

## Decision

VisionCraft owns the portable Rust library/CLI and `skills/visioncraft` payload.
Agentbox consumes one immutable release recorded in
`config/visioncraft-source.json`. Its generated skill snapshot exists in source so
the router, agents and CI inspect the same text that the image bakes. It is not an
editable fork: `agentbox-manifest visioncraft-source-check` compares the exact file
inventory, SHA-256 digests and released lockfile, while Nix compares the skill to
the fetched upstream revision. Updating the release updates these together.

VisionCraft is always installed alongside Sealmap. The optional external Deepsec
binary remains gated by `[toolchains].deepsec`; its paid-review policy remains in
`[security.deepsec]`. Agentbox's Rust adapter projects that policy and environment
overrides, then executes the independent CLI. Credential values never become
policy JSON. There is one execution/receipt interpreter, maintained upstream.
The invocation is a trusted local CLI boundary: the caller owns PATH, environment,
explicit flags and selected manifest. It is not a privileged policy service;
CI/service credentials must be scoped by that caller.

The pinned upstream Agentic QE 3.15.10 package is re-enabled separately. Its
`aqe mcp` tools register directly in Claude's workspace MCP and Codex's TOML;
Ruflo coordinates work but does not stand in for AQE execution. The projector
repairs stale executable paths and removes registration when disabled or missing.
AQE task state is ephemeral (`AQE_MEMORY_BACKEND=memory`), periodic workers are
off, embedder endpoint/token overrides are cleared, and the image rejects the
optional local transformer dependency. Memory mode still runs upstream learning
logic; it does not itself disable embedding attempts. Durable shared memory
continues through the governed Agentbox MCP. No `aqe init`, template dump,
additional embedding service or broad unattended task is part of adoption.

The old build-with-quality payload and scripts are removed. Active skill, agent,
router, stack, preflight, CI and documentation references use VisionCraft. Native
boot reconciliation retires the old name only after the replacement is available;
local copies are moved to a hidden recoverable archive. Historical audit records
and the frozen BM25 parity oracle retain their original evidence.

Jev's picker reads the skill descriptions and registration manifest afresh for
each request. The generated routing table and active labelled corpus follow the
new name. Offline tests exercise the real candidate set and mocked Jev wire path;
they do not measure live model accuracy or authorise paid calls.

## Consequences

Portable changes are reviewed and released upstream before repinning Agentbox.
The release metadata and upstream protocol contract make the maintenance boundary
explicit. Agentbox retains its per-crate permissive projection implementation and
does not duplicate the portable method or external review engine. Supplied Rust
guidance keeps its original attribution in the vendored payload.

Source completion and live activation are separate. The operator will rebuild
Agentbox after the completed source gate; only then can runtime PATH, registered
skills and baked/source parity establish that the running image has cut over.

## Verification

Consumer checks cover typed policy precedence, explicit missing-manifest refusal,
literal argv/stdin and exit-code preservation, payload tampering and missing or
extra files, native-name retirement, the actual Jev candidate map and gate fixture
outcomes. The previously invalid invariants workflow was reproduced with a YAML
parser and repaired by quoting its colon-containing step name. The final source
pin consumes published VisionCraft 0.1.0, upstream commit
`9cf450c5fb82033139527ace29d5731a77d96fc7`. All 34 payload files and Cargo.lock match
that commit and the official-Nix-hashed archive. Source integrity, affected Jev,
skill, configuration/catalogue and environment checks pass. Nix parsing is verified;
full image evaluation, rebuild and runtime activation remain outstanding.

2026-11-05: the pin moves to VisionCraft 0.2.0, upstream commit
`b7e579f99e4c431b34ca911b80980b18c2e948d9`, a skill-only release adding the
browser-target (Rust to WebAssembly) reference. All 35 payload files and
Cargo.lock match that archive; `lib/lockfiles/visioncraft-0.2.0.Cargo.lock`
replaces the 0.1.0 lockfile.
Re-verified at `83637b7c3615`: `visioncraft-source-check` passes (35 files), agentbox-manifest 235 tests, VisionCraft Deepsec/cutover/AQE/picker fixtures 26/26, skill lint and routing table current. **Decision unaffected.** `verified_commit` moved to the landing commit.

The independent host review also reproduced two existing projector faults.
Private JSON writes now use exclusive, unpredictable, owner-only staging files
and atomic replacement, including unchanged mirrored entries that need narrower
permissions. MCP writes share this path. Placeholder expansion accepts only exact
ASCII variable names; unsupported shell syntax remains literal, while a valid
unset name retains the documented empty-string behaviour. The red/green controls
and trust-boundary disposition are recorded in
[the host review](../developer/visioncraft-host-review.md).


A second independent review added source-inventory collision and configuration
preservation controls. Backslashes and duplicate inventory keys now refuse the
snapshot; Codex uses a formatting-preserving TOML editor and keeps unmanaged AQE
settings; malformed MCP object shapes are preserved rather than replaced.
Remaining baseline hub findings and the strict review's ERROR receipt are retained
in the host review, separately from this per-session AQE adoption.

## Scoped source re-verification — 2026-11-03

Verified source commit `c1b0c700c42596d35a1faba3074b667c1928d8fb`.

The final governed source is the actual Agentbox release-pin commit below. It binds the upstream published 0.1.0 source, NAR hash, complete 34-file payload, lockfile, Nix integration, host policy/source-check modules, AQE projection, registration and Jev tests. All 235 Rust tests, Clippy, 18 actual registry-artifact protocol fixtures, eight focused consumer cases and 71 existing Jev checks pass. The native integrity checker, official NAR repeat, three Nix parses, skill/configuration/catalogue/environment gates pass. The binary hash stayed ae5d7568af0a56e46cb134d93391d2ede856544bbead6a0d68a43d5f510dce17 through the registry fixture run. Rebuild and live baked/source parity remain the activation boundary; no production independent-review PASS is inferred from model findings or the separate tiny smoke.

Re-verified 2026-11-05 at `3beca506c` for ADR-2177: the only change to this record's governed paths since its last stamp is ADR-2177's additive SuperSplat hunk (a gated package set and supervisor block, one toml/schema key, a skill registration); this record's decision is unaffected.
