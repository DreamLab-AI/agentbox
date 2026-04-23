# ADR-001: CAG-Primary Architecture (Context-Augmented Generation over RAG)

**Date**: 2026-03-28
**Status**: Proposed
**Deciders**: Mark Allen
**Related ADRs**: ADR-002, ADR-006, ADR-007

---

## Context

The RuVector Catalog has been implemented in two versions with fundamentally different retrieval strategies:

**V1 (CAG approach)**: A hand-curated SKILL.md (238 lines, ~25KB with catalog.json) is loaded directly into Claude's context window. Claude reads the entire catalog and uses its own reasoning to match user queries to technologies. No external search infrastructure.

**V2 (RAG approach)**: A TypeScript pipeline builds TF-IDF embeddings (128-dimensional, feature-hashed), indexes them in an in-memory HNSW graph, and returns top-k ranked matches. The SKILL.md was reduced to a thin router (~35 lines) that delegates to CLI search commands.

**Benchmark results across 5 evaluation queries**:

| Query | V1 (CAG) | V2 (RAG) | Winner |
|-------|----------|----------|--------|
| Q1: "I need to verify AI outputs / prevent hallucination / detect drift" | A (exact section header match, 5 relevant crates) | B- (found prime-radiant but scored it alongside noise) | V1 |
| Q2: "draft best-selling books" (out-of-scope) | D (returned 5 false-positive lines) | F (returned Min-Cut Gated Attention at 0.38 confidence) | Neither |
| Q3: "I need a database for my mobile app" | B+ (found rvlite, ruvector-postgres) | C+ (found ruvector-postgres but missed rvlite) | V1 |
| Q4: "bio-inspired computation for edge devices" | A- (exact section match + WASM section cross-ref) | C (found nervous-system but missed WASM intersection) | V1 |
| Q5: "healthcare applications, non-technical level" | C (found genomics line only, raw technical output) | D- (returned Continuous Batching at high confidence) | V1 |
| **Average** | **A-** | **C-** | **V1** |

The catalog currently contains approximately 80 capability entries across 16 domains. At ~25KB, this is roughly 3% of Claude Opus 4.6's 200K-token context window. The entire catalog fits comfortably in context with room for the user's conversation, tool outputs, and response generation.

V2's TF-IDF embeddings use 128-dimensional feature hashing, which compresses 2,000+ vocabulary terms into 128 buckets, causing hash collisions that produce false-positive similarity scores of 0.20-0.40 for unrelated technologies (see ADR-007 for detailed analysis).

## Decision

**V3 uses Context-Augmented Generation (CAG) as its primary retrieval strategy.**

SKILL.md is the primary interface. Claude IS the search engine. The full catalog content is loaded into Claude's context window, and Claude's language understanding handles query-to-technology matching.

Specifically:

1. **SKILL.md remains the primary artifact** -- a single markdown file structured with problem-solution section headers (see ADR-002) that Claude reads in its entirety.
2. **No runtime search infrastructure** for the SKILL.md path. No HNSW index, no embedding pipeline, no TypeScript CLI invocation. Claude reads the file and reasons over it.
3. **Context budget**: SKILL.md is capped at 30KB (~7,500 tokens). This is 3.75% of Claude's 200K-token window. The V1 SKILL.md at 238 lines demonstrates this is sufficient to describe 200+ technologies with the Problem-Solution Map format.
4. **Supplementary detail** is loaded on-demand via domain overlay files (ADR-004) and deep-read references, not embedded in the primary SKILL.md.

## Consequences

### Positive

- **Zero runtime dependencies**: No build step, no TypeScript pipeline, no HNSW index, no embedding model. SKILL.md is a single markdown file.
- **Sub-second latency**: No search pipeline overhead. Claude reads the file during conversation initialization.
- **Superior semantic understanding**: Claude matches "prevent my model from drifting" to prime-radiant's sheaf cohomology because it understands the concept of drift detection, not because the word "drift" appears in a TF-IDF vector. This is why V1 scored A- vs V2's C-.
- **Cross-reference reasoning**: Claude can simultaneously consider that a user asking about "bio-inspired edge computation" needs BOTH the nervous-system section AND the WASM section, performing intersection reasoning that top-k retrieval cannot.
- **Natural language quality**: Responses are full sentences with context, not ranked lists of technology IDs with similarity scores.
- **Maintainability**: One file to edit. No pipeline to debug. No embedding drift to monitor.

### Negative

- **Context window dependency**: If the catalog grows to 500+ technologies (>60KB), SKILL.md will need to be split or summarized. Current growth rate does not project this within 12 months.
- **Quality limited by SKILL.md structure**: If a technology is described poorly in SKILL.md, Claude will match it poorly. Unlike embeddings (which can be retrained), SKILL.md quality is entirely a function of human authoring.
- **No batch/programmatic search**: SKILL.md cannot be queried by a CI pipeline or automated script. This use case is served by the CLI path (ADR-007).
- **No quantitative scoring**: CAG returns qualitative recommendations, not numeric similarity scores. For use cases requiring ranked lists with scores, the CLI path is needed.

### Neutral

- **Model upgrade sensitivity**: CAG quality improves automatically as Claude's reasoning improves. No retraining or re-embedding needed. However, it also means quality is tied to the specific model version.

## Alternatives Considered

### Alternative A: RAG with Neural Embeddings (Rejected)

Replace TF-IDF with ONNX-based neural embeddings (e.g., all-MiniLM-L6-v2) for the HNSW index.

**Why rejected**: For a catalog of 80 technologies (~25KB of text), adding an ONNX runtime dependency, model download, and embedding pipeline introduces significant complexity for marginal benefit over CAG. The benchmarks show that Claude's native language understanding already outperforms TF-IDF RAG. Neural embeddings would improve RAG quality but still cannot match CAG's cross-reference reasoning on a catalog this small.

**When it makes sense**: If the catalog grows to 1,000+ technologies or if batch/offline search becomes a primary use case. Deferred to V3.1+ for the CLI path.

### Alternative B: Hybrid RAG+CAG (Deferred to V3.1)

Use CAG for the SKILL.md path and enhanced RAG for the CLI path, with shared catalog.json data.

**Status**: Partially accepted. V3 implements CAG-primary with a separate CLI search engine (ADR-007). Full hybrid integration (where CLI results feed into CAG context) is deferred.

### Alternative C: Full RAG with Improved V2 Pipeline (Rejected)

Fix V2's hash collision issues, add field weighting, and keep RAG as the primary path.

**Why rejected**: Even a perfect RAG implementation cannot perform the cross-reference reasoning that CAG provides for free. V2's average grade of C- is a structural problem (retrieval by vector similarity cannot reason about intent), not just an implementation problem (hash collisions).

## Evidence

### V1 SKILL.md Structure Analysis

V1's SKILL.md uses 17 section headers formatted as problem statements:
- "I need to find similar things" -- maps to vector_search
- "I need to verify AI outputs / prevent hallucination / detect drift" -- maps to coherence_safety
- "I need bio-inspired computation" -- maps to nervous_system

When Benchmark Q1 asks about "hallucination detection," Claude performs an exact conceptual match to the section header "verify AI outputs / prevent hallucination / detect drift" and immediately returns 5 highly relevant crates (prime-radiant, cognitum-gate-kernel, cognitum-gate-tilezero, ruvector-coherence, mcp-gate).

V2's HNSW search for the same query returns prime-radiant at rank 1 (correct) but also returns Min-Cut Gated Attention, Continuous Batching, and Auto-Sharding in the top 5 -- all scoring 0.20-0.40 similarity due to hash collisions on common terms like "model," "compute," and "gate."

### Context Budget Arithmetic

- Claude Opus 4.6 context window: 200,000 tokens
- V1 SKILL.md: ~6,000 tokens (238 lines)
- V1 catalog.json: ~2,000 tokens (706 lines)
- V3 projected SKILL.md (with ADR-002 extensions): ~7,500 tokens (30KB)
- Remaining for conversation: ~192,500 tokens (96.25%)

The catalog consumes less than 4% of available context. There is no resource pressure to move to RAG.

## Notes

This decision applies specifically to the SKILL.md interaction path (Claude reading the catalog file). The CLI path for batch/programmatic search is governed by ADR-007 and uses a different strategy.
