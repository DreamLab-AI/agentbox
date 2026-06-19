---
id: ADR-034
title: Headroom Rust crate integration — content-aware compression via N-API
status: proposed
date: 2026-06-19
type: integration
author: Dr John O'Hare
depends_on: [ADR-005, ADR-008, ADR-012, ADR-013, ADR-015, ADR-031]
review_trigger: headroom upstream releases a breaking API change to headroom-core; or the N-API binding layer exceeds 500 LoC (complexity signal)
---

# ADR-034 — Headroom Rust crate integration (content-aware compression via N-API)

**Related:** PRD-016 (product requirements), DDD-014 (compression domain
model), ADR-005 (pluggable adapters — the middleware chain this integrates
with), ADR-008 (privacy filter — ordering invariant), ADR-012 (JSON-LD
encoder — post-encoder compression point), ADR-013 (canonical URI grammar —
CCR hash compatibility), ADR-015 (MCP RuVector mandate — memory search
compression surface), ADR-031 (adapter contract enforcement — contract test
expansion), `lib/solid-pod-rs.nix` (build pattern precedent),
`lib/nostr-pod-bridge.nix` (in-repo Rust crate build pattern).

## Context

Agentbox processes payloads through a 3-layer middleware chain
(Observability → Privacy Filter → JSON-LD Encoder → Adapter) with no
compression at any layer. Agent context windows receive raw JSON arrays
from memory search, uncompressed activity logs, and full JSON-LD documents.
The ruflo swarm amplifies this — 15 agents pulling shared memory results
multiply token cost linearly.

The headroom project (MIT, github.com/chopratejas/headroom) provides
content-aware compression with proven 60–95% token savings. Its core
algorithms (SmartCrusher for JSON, LogCompressor, DiffCompressor) are
already implemented in Rust via a Cargo workspace. The CCR
(Compress-Cache-Retrieve) system stores originals keyed by BLAKE3 hash,
structurally compatible with our `sha256-12` content-addressing.

Three integration strategies were evaluated:

1. **Python sidecar** — run headroom's Python orchestration as a separate
   process. Rejected: adds HTTP round-trip latency (like the OPF sidecar),
   introduces a Python runtime dependency, and the management API is
   Node.js.

2. **Rust FFI via node-ffi-napi** — call headroom-core C ABI directly.
   Rejected: fragile ABI surface, no zero-copy Buffer support, debugging
   difficulty.

3. **Rust N-API via napi-rs** — compile headroom-core into a native Node.js
   addon (.node file). **Selected.** In-process, zero-copy Buffer passing,
   type-safe bindings, follows the ecosystem's standard pattern for
   performance-critical Node.js extensions.

## Decision

### D1 — Vendor headroom-core at a pinned rev

Fetch `headroom-core` and `headroom-types` from the upstream Cargo
workspace via `fetchFromGitHub` in a new `lib/headroom-compress.nix`.
Pin to a specific git rev with SRI hash, following the `lib/solid-pod-rs.nix`
precedent. Do NOT fork — vendor as a dependency.

The vendored crates provide:
- `SmartCrusher` — statistical JSON array compression (schema dedup,
  stratified sampling, position anchors, rare-status preservation)
- `LogCompressor` — template-based log compression (Drain-style)
- `DiffCompressor` — unified diff compression (hunk-aware sampling)
- `CcrStore` trait + `SqliteCcrStore` / `InMemoryCcrStore` implementations
- `ContentRouter` — content type detection (delegates to `magika` ONNX)
- `TokenRouter` — tokenizer registry (tiktoken-rs + HuggingFace)

### D2 — In-repo N-API binding crate

New crate at `crates/headroom-napi/` — a thin N-API wrapper using
`napi-rs` (the same library used by SWC, Rspack, and other production
Node.js tools). The crate:

- Depends on `headroom-core` (path or git dep)
- Exposes 6 functions (see PRD-016 §2.3)
- Compiles to a `.node` shared library via `napi-rs` build
- Ships as part of the Nix image layer (not npm-published)

Build integration:
```nix
headroomNapiPkg = pkgs.rustPlatform.buildRustPackage {
  pname = "headroom-napi";
  src = ./crates/headroom-napi;
  # napi-rs produces a .node file; install to a known path
  postInstall = ''
    mkdir -p $out/lib
    cp target/release/headroom_napi.node $out/lib/
  '';
};
```

The `.node` file is loaded at management-api boot via:
```javascript
const headroom = require('/opt/agentbox/lib/headroom_napi.node');
```

### D3 — Compression runs AFTER privacy redaction

The middleware ordering invariant (DDD-004 §L08, enforced by
`assertPrivacyFilterApplied()` in encoder.js) requires that privacy
redaction completes before any downstream processing. Compression
integrates at two points, both after Layer 2:

**Point A (pre-LLM, Phase 1):** Application-layer compression in route
handlers and MCP tools. Not a middleware layer — a library call. The
privacy filter has already processed the stored value; compression
operates on the redacted output being returned to the agent.

**Point B (post-encoder, Phase 2):** A new optional step between encoder
output and adapter dispatch. The encoder's `assertPrivacyFilterApplied()`
check has already passed. Compression operates on the final encoded
document.

Neither point bypasses or reorders the privacy filter.

### D4 — CCR uses BLAKE3 internally, does not mint URNs

The CCR store is an internal cache, not a durable-state adapter. Its keys
are BLAKE3 24-char hex hashes (headroom convention). CCR entries:

- Are NOT minted as `urn:agentbox:*` URNs (they are ephemeral cache keys)
- Have a default TTL of 30 minutes (configurable)
- Are stored in the memory adapter's `ccr:` namespace (reusing the
  existing adapter slot, not creating a new one)
- Are exempt from JSON-LD encoding (no `@context`, no surface)

The agentbox URN system (SHA-256, `sha256-12-<hash>`) is unchanged. CCR
hashes and URN hashes serve different purposes and do not collide.

### D5 — Events slot is never compressed

Activity records (`urn:agentbox:activity:`) are the audit trail. The
`[compression.slots]` manifest section hard-gates `events = false`.
The contract test `tests/contract/compression.contract.spec.js` asserts
this invariant. The events adapter always receives uncompressed payloads.

### D6 — Manifest-gated via `[compression]`

The entire compression subsystem is gated by `[compression].enabled` in
`agentbox.toml`. Default: `false` (opt-in). Per-slot overrides under
`[compression.slots]`. The Nix build conditionally includes the
`headroom-napi` package only when compression is enabled:

```nix
compressionCfg = agentboxConfig.compression or {};
compressionEnabled = (compressionCfg.enabled or false) == true;
headroomPackages = lib.optionals compressionEnabled [ headroomNapiPkg ];
```

### D7 — Decompression at federation boundary

Compressed payloads do NOT cross the BC20 anti-corruption layer. The
bridge (`bc20-provenance-bridge.js`) decompresses any CCR-marked payload
before translation. This preserves the bridge's invariant that both sides
see structurally identical payloads (modulo URN namespace translation).

## Consequences

### Positive

- 3–5x token cost reduction on memory-heavy swarm workflows
- In-process compression (~5ms) vs sidecar round-trip (~50ms)
- CCR enables reversible compression — agents can retrieve originals
- Build pattern is established (solid-pod-rs, nostr-pod-bridge)
- No new adapter slot — reuses existing memory contract

### Negative

- New Rust build dependency (headroom-core + napi-rs)
- N-API is a new binding pattern for this project (precedent-setting)
- Adds ~2 min to clean build time (incremental: ~30s)
- CCR SQLite store adds a file to the session state
- Content router requires magika ONNX model (~5MB, auto-downloaded)

### Neutral

- Headroom is MIT-licensed; no AGPL interaction
- BLAKE3 and SHA-256 coexist without collision (different namespaces)
- The Python orchestration layer is explicitly not vendored
