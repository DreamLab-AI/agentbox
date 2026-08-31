# PRD-016: Context Compression & Caching (Headroom Integration)

**Status:** Draft v1.0
**Date:** 2026-06-19
**Author:** DreamLab AI
**Repo:** [github.com/DreamLab-AI/agentbox](https://github.com/DreamLab-AI/agentbox)
**Related:** ADR-005 (Pluggable adapters), ADR-008 (Privacy filter), ADR-012 (JSON-LD encoder), ADR-013 (Canonical URI grammar), ADR-019 (Experiential skill learning), ADR-034 (this PRD's companion decision), DDD-014 (compression domain model), PRD-010 (Runtime integrity hardening)
**Upstream:** [github.com/chopratejas/headroom](https://github.com/chopratejas/headroom) — hybrid Rust+Python context compression library (MIT)
**Drives:** ADR-034 (Headroom Rust crate integration), DDD-014 (Compression & Cache domain)

## TL;DR

Agent workflows in agentbox are token-heavy. RuVector memory search results,
tool outputs, activity logs, and JSON-LD encoded documents flow through the
middleware chain and into LLM context windows uncompressed. The ruflo swarm
(up to 15 agents) amplifies this — each agent independently pulls the same
structural patterns from shared memory. The headroom project demonstrates
60–95% token savings on exactly these workload shapes (JSON arrays: 92%,
logs: 92%, code search: 73%) using content-aware compression that preserves
LLM accuracy (GSM8K 97%, TruthfulQA 96%, SQuAD v2 97%).

This PRD integrates headroom's Rust core crates into the agentbox build
system, exposing compression as a manifest-gated capability at two integration
points: pre-LLM context preparation (the high-value target) and post-encoder
storage compression (the bonus).

---

## 1. Problem

### 1.1 Token cost scales with swarm size

A ruflo mesh of 15 agents, each pulling 10 memory search results (avg 2KB
each), consumes ~300KB of raw context per round — roughly 75,000 tokens at
4 chars/token. At Opus pricing ($15/MTok input), a single orchestration
cycle costs ~$1.12 in context alone. Ten cycles per task = $11.20. Multiply
by daily throughput and the economics become the constraint, not the compute.

### 1.2 Structural redundancy in adapter payloads

Activity records (`urn:agentbox:activity:`) share identical `@context`,
`@type`, and `prov:wasAssociatedWith` structures. Memory search results
return arrays of JSON objects with shared schemas. Log outputs from
supervised processes repeat template patterns. All three are compressible
by 60–90% with content-aware algorithms that preserve semantic meaning.

### 1.3 No compression layer exists

The middleware chain (Observability → Privacy Filter → JSON-LD Encoder →
Adapter) processes payloads as plain objects. The only measurement is
`JSON.stringify().length` for metrics logging. No intermediate buffering,
deduplication, or compression exists at any layer.

### 1.4 CCR aligns with content-addressing

Headroom's Compress-Cache-Retrieve pattern (stash original keyed by
BLAKE3 hash, emit sentinel marker, retrieve on demand) maps directly to
the `sha256-12-<hash>` content-addressing scheme in the canonical URI
grammar (ADR-013). A compressed payload can carry its agentbox URN as
metadata, making compression URN-resolvable.

---

## 2. Solution

### 2.1 Integrate headroom-core Rust crates

Vendor the following from headroom's Cargo workspace:

| Crate | Purpose | Size |
|-------|---------|------|
| `headroom-core` | Transform traits, SmartCrusher, CCR backends, tokenizers | ~4K LoC |
| `headroom-types` | Shared types (ContentType, CompressResult, CCR markers) | ~800 LoC |

Do NOT vendor: `headroom-proxy` (we have our own HTTP stack), `headroom-py`
(PyO3 bindings — we need N-API), the Python orchestration layer (we
reimplement content routing in JS/Rust).

### 2.2 Build as a Nix-managed Rust crate

New file: `lib/headroom-compress.nix` following the `lib/solid-pod-rs.nix`
pattern — `buildRustPackage` with vendored Cargo.lock, manifest-gated via
`[compression]` in `agentbox.toml`.

### 2.3 Expose via N-API to Node.js

New in-repo crate: `crates/headroom-napi/` — thin N-API wrapper exposing:

- `smartCrush(jsonString, options) → { compressed, ratio, ccrEntries }`
- `ccrStore(hash, original) → void`
- `ccrRetrieve(hash) → Buffer | null`
- `detectContentType(content) → ContentType`
- `compressLog(logString, options) → { compressed, ratio }`
- `compressDiff(diffString, options) → { compressed, ratio }`

N-API chosen over FFI/PyO3 because:
- Management API is Node.js (Fastify)
- Existing pattern: no current N-API in the build, but the napi-rs ecosystem
  is mature and the Nix build for it follows buildRustPackage
- Zero-copy Buffer passing for large payloads
- No sidecar latency (in-process, ~5ms per compression)

### 2.4 Two integration points

**P1: Pre-LLM context compression (Phase 1)**

Compress tool outputs, memory search results, and activity logs before
they enter agent context windows. This is a library call at the
application layer — NOT a middleware insertion. The management API's
`/v1/memory` search endpoint and the MCP memory tools compress results
before returning them to the calling agent.

Integration surface:
- `routes/memory.js` → compress search results before HTTP response
- `ruvector-mcp.cjs` → compress memory_search/memory_list results
- New MCP tool: `headroom_retrieve(hash)` for on-demand original recovery

**P2: Post-encoder storage compression (Phase 2)**

Compress final JSON-LD documents after the encoder (Layer 3) and before
the adapter dispatch writes to storage. New configurable layer gated
per-slot in `agentbox.toml`.

Integration surface:
- `middleware/linked-data/encoder.js` → optional compression step
- Per-slot gating: enable for `pods` and `memory`, disable for `events`
  (audit trail integrity)
- Metrics: `compression_ratio_percent{slot}`, `compression_latency_ms{slot}`

### 2.5 CCR as a memory adapter sub-slot

The CCR store holds original payloads keyed by hash. Implement as a
sub-namespace of the existing `memory` adapter slot:

- Namespace: `ccr:<sha256-12>` (content-addressed, session-scoped TTL)
- Default TTL: 30 minutes (matches headroom default)
- Backend: SQLite for standalone, external-pg for federated
- No new adapter slot — reuse the existing memory contract

### 2.6 Manifest gating

```toml
[compression]
enabled = true
backend = "sqlite"          # sqlite | external-pg | memory
ttl_minutes = 30
target_ratio = 0.15         # aggressive default (keep 15%)

[compression.slots]
memory = true               # compress memory search results
pods = true                 # compress pod writes
events = false              # NEVER compress audit trail
beads = true                # compress bead payloads
orchestrator = false        # skip orchestrator
```

---

## 3. Non-Goals

- **Output token compression.** Headroom has verbosity steering (L0–L4)
  for LLM output reduction. Out of scope — that's a model-prompting
  concern, not an infrastructure concern.
- **ML-based text compression (Kompress).** The ModernBERT-based learned
  compressor requires ONNX runtime and model weights. Out of scope for
  Phase 1 — SmartCrusher and LogCompressor cover 80% of the workload.
- **CodeCompressor.** AST-aware code compression via ast-grep. Useful but
  requires a binary dependency. Defer to Phase 3.
- **Proxy mode.** Headroom can run as a transparent reverse proxy. We
  don't need this — agents talk directly to LLM APIs.
- **Python orchestration.** Headroom's pipeline routing is Python. We
  reimplement the content router in Rust (it's ~200 lines of type
  detection).

---

## 4. Phases

### Phase 1 — Crate infrastructure & pre-LLM compression (this PRD)

| Deliverable | Owner | Gate |
|-------------|-------|------|
| `lib/headroom-compress.nix` | Build | Nix build succeeds |
| `crates/headroom-napi/` | Rust | N-API bindings compile, parity tests pass |
| `[compression]` manifest section | Config | agentbox.toml validates |
| Memory search compression | API | `/v1/memory` returns compressed results |
| MCP memory compression | MCP | `memory_search` returns compressed results |
| CCR store/retrieve | API | Round-trip test: compress → store → retrieve = original |
| Contract tests | QA | `tests/contract/compression.contract.spec.js` green |

### Phase 2 — Post-encoder storage compression

| Deliverable | Owner | Gate |
|-------------|-------|------|
| Encoder compression layer | Middleware | Per-slot gating works |
| Activity record exemption | Audit | Events slot always writes uncompressed |
| Observability metrics | SRE | Prometheus compression_ratio histogram |
| Federation parity | Bridge | BC20 bridge handles compressed payloads |

### Phase 3 — Advanced compressors (deferred)

| Deliverable | Owner | Gate |
|-------------|-------|------|
| CodeCompressor (ast-grep) | Rust | AST-aware code compression |
| DiffCompressor | Rust | Unified diff compression |
| SearchCompressor | Rust | BM25 relevance scoring for grep output |
| Kompress ML | ML | ONNX runtime integration |

---

## 5. Success Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| Token cost per swarm cycle | ~75K tokens | <20K tokens | Prometheus counter |
| Memory search result size | ~20KB avg | <5KB avg | API response Content-Length |
| Compression latency | N/A | <10ms p95 | Histogram |
| Accuracy preservation | N/A | >95% on downstream tasks | Manual validation |
| CCR retrieval success | N/A | 100% within TTL | Contract test |
| Build time impact | ~8 min | <+2 min | CI measurement |

---

## 6. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Privacy filter bypass via compressed payloads | P0 | Compression runs AFTER privacy redaction; assert marker on compressed form |
| Audit trail corruption | P0 | Events slot hard-gated OFF in manifest; contract test enforces |
| N-API build complexity | P1 | Follow solid-pod-rs pattern; vendored lockfile; Nix sandbox |
| CCR hash collision | P2 | BLAKE3 24-char (96-bit) sufficient for bounded population (<1M entries/session) |
| Upstream headroom API churn | P2 | Vendor at a pinned rev; update on our cadence |
| AGPL license interaction | P2 | Headroom is MIT; no license concern. N-API crate is in-repo (AGPL-3.0) |

---

## 7. Open Questions

1. **Q1: Should CCR hashes use BLAKE3 (headroom default) or SHA-256 (agentbox default)?**
   Recommendation: BLAKE3 for CCR (faster, sufficient collision resistance),
   SHA-256 for URN minting (existing invariant). The CCR hash is an internal
   cache key, not a durable identifier.

2. **Q2: Should compressed memory results include the CCR sentinel inline or out-of-band?**
   Recommendation: Inline sentinel (`<<ccr:HASH>>`) following headroom
   convention. The MCP `headroom_retrieve` tool handles expansion.

3. **Q3: Federation boundary — do compressed payloads cross the BC20 bridge?**
   Recommendation: No. Decompress at the bridge boundary. The anti-corruption
   layer should never handle compressed forms.
