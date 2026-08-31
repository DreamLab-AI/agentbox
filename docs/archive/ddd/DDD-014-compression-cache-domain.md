# DDD-014: Compression & Cache Domain

**Date**: 2026-06-19
**Status**: Proposed
**Bounded Context**: Context Compression
**Cross-references**: PRD-016 (product requirements), ADR-034 (integration decision), ADR-005 (pluggable adapters — middleware chain), ADR-008 (privacy filter — ordering invariant), ADR-012 (JSON-LD encoder — post-encoder point), ADR-013 (canonical URI grammar — hash scheme coexistence), ADR-019 (experiential learning — memory search compression), DDD-004 (linked-data federation — §L08 ordering invariant), DDD-013 (hardening boundary — compression as defence-in-depth layer)

---

## TL;DR for newcomers

This DDD captures the Compression & Cache bounded context: the part of
the system that owns *reducing token cost and storage volume while
preserving semantic fidelity*. The pain point is that agentbox processes
all payloads at full size through a 3-layer middleware chain and into LLM
context windows, with no content-aware compression at any layer. The
shape of the answer is a domain with explicit aggregates
(CompressionPipeline, ContentRouter, CcrStore, SlotCompressionPolicy)
and a ubiquitous language that separates **lossy-but-reversible
compression** from **lossless transport encoding** from **content-addressed
caching**. You get the glossary, aggregates, invariants, domain events,
and the anti-corruption layer that keeps this domain aligned with DDD-004
(linked-data federation) and DDD-013 (hardening boundary).

**If you remember only one thing:** compression is lossy but reversible.
The CCR store holds the original; the compressed form carries a hash
sentinel; the LLM can retrieve the original on demand. Nothing is
permanently lost, and the privacy filter always runs first.

---

## Domain Purpose

The Compression & Cache domain reduces the token and storage cost of
agent workflows by applying content-aware compression algorithms to
payloads at two integration points (pre-LLM context, post-encoder
storage), while maintaining a content-addressed cache of originals for
on-demand retrieval. It owns the invariants that prevent compression
from (a) bypassing privacy redaction, (b) corrupting audit trails,
(c) breaking URN content-addressing, or (d) crossing the federation
boundary in compressed form.

## Bounded Context Definition

**Boundary**: This domain owns the *what, when, and how* of compression
— algorithm selection, compression timing relative to the middleware
chain, cache lifecycle, and retrieval semantics.

**Owns**: Content type detection, algorithm dispatch, CCR store
lifecycle, compression metrics, slot-level gating policy.

**Does not own**: Privacy redaction (DDD-004 / ADR-008), URN minting
(ADR-013 / `uris.js`), adapter dispatch (ADR-005), JSON-LD encoding
(ADR-012 / DDD-004), audit trail semantics (events adapter), or the
LLM context window itself.

**Consumes from DDD-004**: The `assertPrivacyFilterApplied()` marker
on payloads — compression checks this marker before operating,
preserving the ordering invariant.

**Consumes from ADR-013**: The `sha256-12-<hash>` content-addressing
scheme — compression does NOT modify URN hashes; CCR uses its own
BLAKE3 hash namespace.

**Publishes to ADR-005 observability**: `CompressionApplied` and
`CcrStoreHit`/`CcrStoreMiss` events, plus Prometheus metrics
(`compression_ratio_percent`, `compression_latency_ms`,
`ccr_store_size`, `ccr_retrieval_total`).

## Ubiquitous Language

| Term | Definition |
|---|---|
| **Content-Aware Compression** | Compression that understands the semantic structure of the input (JSON schemas, log templates, diff hunks) and preserves meaning while removing redundancy. Distinguished from generic byte-level compression (gzip/zstd). |
| **SmartCrusher** | The JSON array compression algorithm. Analyses schema, identifies position anchors (first/last), outliers (errors, extremes), and stratified samples. Drops redundant rows, emits CCR sentinels for dropped content. |
| **LogCompressor** | The log compression algorithm. Template-based (Drain-style): groups repetitive lines, preserves errors/warnings/stack traces, emits template summaries with occurrence counts. |
| **DiffCompressor** | The unified diff compression algorithm. Parses hunks, keeps all changed lines + surrounding context, samples context lines when the context-to-changes ratio exceeds threshold. |
| **CCR (Compress-Cache-Retrieve)** | The three-phase pattern: (1) compress a payload, (2) cache the original keyed by its BLAKE3 hash, (3) retrieve the original on demand via the hash. The compressed form carries a sentinel marker (`<<ccr:HASH>>`) that the LLM or downstream consumer can use to request the original. |
| **CCR Sentinel** | The inline marker `<<ccr:HASH>>` (or `{"_ccr_dropped": "<<ccr:HASH N_rows>>"}` for JSON) embedded in compressed output. Points to the cached original. |
| **CCR Store** | The backend that holds cached originals. Implementations: SQLite (WAL mode, session-local), external-pg (shared, multi-worker), in-memory (test only). Entries have a configurable TTL (default 30 minutes). |
| **Content Router** | The type-detection layer that classifies input content (JSON array, log output, unified diff, code, prose) and dispatches to the appropriate compression algorithm. Uses `magika` (Google ONNX model) for ambiguous content. |
| **Compression Ratio** | `1 - (compressed_size / original_size)`. A ratio of 0.92 means 92% size reduction. |
| **Target Ratio** | The configured maximum compression aggressiveness. `0.15` means keep ~15% of the original (85% reduction target). Actual ratio depends on content redundancy. |
| **Slot Compression Policy** | Per-adapter-slot configuration determining whether compression applies. Hard invariant: `events = false` (audit trail). Configurable: `memory`, `pods`, `beads`. Default off: `orchestrator`. |
| **Lossy-but-Reversible** | The compression removes tokens from the prompt but stores the original in the CCR store. The LLM sees less but can retrieve more. Distinguished from lossless (gzip) and lossy-irreversible (summarisation). |
| **Pre-LLM Compression** | Compression applied at the application layer (route handlers, MCP tools) before payloads enter agent context windows. Not a middleware layer. |
| **Post-Encoder Compression** | Compression applied between the JSON-LD encoder (Layer 3) and the adapter dispatch. A middleware step, gated per-slot. |

## Aggregates

### CompressionPipeline (Root Aggregate)

Owns the end-to-end compression flow: detect content type, select
algorithm, compress, cache original, return compressed form with
sentinels.

```
CompressionPipeline
  +-- contentRouter: ContentRouter
  +-- algorithms: Map<ContentType, CompressionAlgorithm>
  |     +-- SmartCrusher (JSON arrays)
  |     +-- LogCompressor (log output)
  |     +-- DiffCompressor (unified diffs)
  +-- ccrStore: CcrStore
  +-- config: CompressionConfig
  |     +-- enabled: boolean
  |     +-- targetRatio: number (0.0–1.0)
  |     +-- ttlMinutes: number
  |     +-- slotPolicies: Map<SlotName, boolean>
  +-- compress(content: Buffer, slot?: SlotName) → CompressResult
  +-- retrieve(hash: string) → Buffer | null
```

**Invariants:**

- **I01 (Privacy-First):** `compress()` MUST NOT be called on a payload
  that has not passed through the privacy filter. For post-encoder
  compression, the `assertPrivacyFilterApplied()` marker MUST be present
  on the input. For pre-LLM compression, the payload MUST have been
  retrieved from an adapter that already applied privacy redaction.

- **I02 (Events Exempt):** `compress()` with `slot = "events"` MUST
  throw `CompressionSlotProhibited`. This is not configurable — it is a
  hard invariant enforced in code, not just in the manifest.

- **I03 (CCR Completeness):** Every `<<ccr:HASH>>` sentinel in the
  compressed output MUST have a corresponding entry in the CCR store.
  A compression that would emit a sentinel without storing the original
  MUST fail rather than produce an unretrievable reference.

- **I04 (URN Independence):** Compression MUST NOT modify, re-hash, or
  invalidate any `urn:agentbox:*` URN. The CCR hash (BLAKE3) and the
  URN hash (SHA-256) are independent namespaces. A compressed payload
  retains its original URN.

- **I05 (Federation Boundary):** Compressed payloads with CCR sentinels
  MUST be decompressed before crossing the BC20 anti-corruption layer.
  The bridge sees only uncompressed payloads.

- **I06 (Idempotent Retrieval):** `retrieve(hash)` for a valid,
  non-expired hash MUST return the exact bytes that were cached. No
  transformation, re-encoding, or re-compression on retrieval.

### ContentRouter (Value Object)

Classifies input content and selects the compression algorithm.

```
ContentRouter
  +-- detect(content: Buffer) → ContentDetection
  |     +-- contentType: ContentType enum
  |     |     JSON_ARRAY | LOG_OUTPUT | UNIFIED_DIFF | CODE | PROSE | BINARY | UNKNOWN
  |     +-- confidence: number (0.0–1.0)
  |     +-- language?: string (for CODE type)
  +-- shouldCompress(detection: ContentDetection, config: CompressionConfig) → boolean
```

**Rules:**
- BINARY and UNKNOWN types are never compressed
- Content below `minTokensToCompress` (default 250 tokens) is skipped
- Confidence below 0.5 falls back to no compression (fail-open for quality)

### CcrStore (Entity)

Manages the lifecycle of cached originals.

```
CcrStore
  +-- backend: SqliteCcrStore | ExternalPgCcrStore | InMemoryCcrStore
  +-- ttl: Duration
  +-- maxEntries: number (default 1000)
  +-- store(hash: string, original: Buffer, metadata?: object) → void
  +-- retrieve(hash: string) → Buffer | null
  +-- evict(hash: string) → void
  +-- prune() → number  // evict expired entries, return count
  +-- stats() → { entries: number, bytesStored: number, hitRate: number }
```

**Invariants:**
- Entries older than `ttl` are invisible to `retrieve()` (lazy eviction)
- `store()` is idempotent — storing the same hash twice is a no-op
- `maxEntries` enforces an LRU eviction policy

### SlotCompressionPolicy (Value Object)

Per-adapter-slot compression configuration.

```
SlotCompressionPolicy
  +-- slot: SlotName (memory | pods | events | beads | orchestrator)
  +-- enabled: boolean
  +-- hardGated: boolean  // true for events — cannot be overridden
  +-- targetRatio?: number  // per-slot override
```

## Domain Events

| Event | Emitted by | Consumed by | Payload |
|---|---|---|---|
| `CompressionApplied` | CompressionPipeline | Observability (Layer 1) | `{ slot, algorithm, inputBytes, outputBytes, ratio, durationMs, ccrEntries: number }` |
| `CcrEntryStored` | CcrStore | Observability | `{ hash, sizeBytes, ttlMinutes, backend }` |
| `CcrEntryRetrieved` | CcrStore | Observability | `{ hash, sizeBytes, ageSeconds }` |
| `CcrEntryExpired` | CcrStore | Observability | `{ hash, ageSeconds }` |
| `CompressionSlotProhibited` | CompressionPipeline | Observability, Alerting | `{ slot, caller }` |
| `CcrPruneCompleted` | CcrStore | Observability | `{ evictedCount, remainingCount, freedBytes }` |

## Anti-Corruption Layers

### ACL-1: Privacy Filter → Compression

The compression domain MUST NOT receive un-redacted payloads. The ACL
checks the per-dispatch Symbol marker set by `wrapWithPrivacyFilter()`
(privacy-filter.js:137–142). For pre-LLM compression, the data has
already been stored and retrieved through the adapter (which applied
the privacy filter on write). For post-encoder compression, the encoder
has already asserted the marker.

Implementation: `CompressionPipeline.compress()` calls
`assertPrivacyFilterApplied(payload, slot)` before processing. If the
assertion fails, compression is skipped (fail-open for pre-LLM) or
throws (fail-closed for post-encoder), matching the encoder's behaviour.

### ACL-2: Compression → Federation Bridge

The BC20 anti-corruption layer (`bc20-provenance-bridge.js`) must never
see CCR sentinels. The ACL decompresses any sentinel-bearing payload
before the bridge translates URN namespaces.

Implementation: A pre-bridge hook in `bc20-provenance-bridge.js` that
scans for `<<ccr:` patterns and calls `ccrStore.retrieve()` to expand
them. If retrieval fails (expired), the sentinel is replaced with
`[compressed content expired]` — the bridge logs a warning but does not
block the translation.

### ACL-3: Compression → URN Minting

URN hashes (`sha256-12-<hash>`) are computed from the *uncompressed*
payload. Compression never participates in URN minting — it operates
after URNs have already been assigned by `uris.js`. The ACL is
structural: `uris.mint()` is called in the encoder (Layer 3);
compression runs after the encoder returns.

## Context Map

```
┌──────────────────────┐         ┌──────────────────────┐
│  Privacy Filter      │ ──I01──▶│  Compression &       │
│  (DDD-004/ADR-008)   │ marker  │  Cache Domain        │
│                      │         │  (DDD-014)           │
└──────────────────────┘         │                      │
                                 │  ┌─────────────────┐ │
┌──────────────────────┐         │  │ CompressionPipe  │ │
│  JSON-LD Encoder     │ ──I04──▶│  │  ┌────────────┐ │ │
│  (DDD-004/ADR-012)   │ post-   │  │  │ContentRoute│ │ │
│                      │ encoder │  │  └────────────┘ │ │
└──────────────────────┘         │  │  ┌────────────┐ │ │
                                 │  │  │ CcrStore   │ │ │
┌──────────────────────┐         │  │  └────────────┘ │ │
│  Adapter Dispatch    │◀──I02───│  └─────────────────┘ │
│  (ADR-005)           │ events  │                      │
│                      │ exempt  └──────────┬───────────┘
└──────────────────────┘                    │
                                            │ I05: decompress
┌──────────────────────┐                    │ before bridge
│  BC20 Bridge         │◀───────────────────┘
│  (federation)        │
└──────────────────────┘
```

## Implementation Notes

### Rust ↔ Node.js boundary

The N-API binding crate (`crates/headroom-napi/`) is the only crossing
point between the Rust compression core and the Node.js management API.
All data crosses as `Buffer` (zero-copy when possible) or `string`
(UTF-8, copied). The binding:

- Does NOT expose the `CcrStore` trait directly — it wraps a
  process-global singleton initialised at `require()` time
- Exposes `smartCrush()`, `compressLog()`, `compressDiff()`,
  `detectContentType()`, `ccrStore()`, `ccrRetrieve()` as top-level
  N-API functions
- Returns `CompressResult` as a plain JS object (not a class)
- Errors throw standard `Error` with a `code` property for structured
  handling

### Testing strategy

| Layer | Test Type | Location |
|---|---|---|
| Rust core | Unit + property tests | `crates/headroom-napi/tests/` |
| N-API binding | Integration (Jest + native) | `management-api/tests/headroom.test.js` |
| Middleware integration | Contract tests | `tests/contract/compression.contract.spec.js` |
| Events exemption | Contract test | `tests/contract/compression.contract.spec.js` |
| CCR round-trip | Contract test | `tests/contract/compression.contract.spec.js` |
| Privacy ordering | Assertion test | Existing `assertPrivacyFilterApplied()` coverage |
| Federation boundary | Bridge parity test | `tests/contract/bc20-bridge.spec.js` (extended) |
