---
id: ADR-2165
title: VisionCraft owns the portable quality method; Agentbox supplies installation and policy
date: 2026-11-03
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 75bd6c7e77fad41b72c8b78703cd7751a0a0d07c
verified_paths: [services/agentbox-manifest/src/deepsec_gate.rs, services/agentbox-manifest/src/visioncraft_source.rs, services/agentbox-manifest/src/jsonio.rs, services/agentbox-manifest/src/mcp.rs, services/agentbox-manifest/src/mcp_hub.rs, services/agentbox-manifest/tests/deepsec_gate.rs, services/agentbox-manifest/tests/aqe.rs, tests/config/visioncraft-deepsec.test.mjs, tests/config/visioncraft-aqe.test.mjs, tests/system-one/visioncraft-picker.test.mjs]
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
