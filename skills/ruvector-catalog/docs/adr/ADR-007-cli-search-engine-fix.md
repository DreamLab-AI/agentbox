# ADR-007: CLI Search Engine Fix (Sparse TF-IDF + Field Weighting)

**Date**: 2026-03-28
**Status**: Proposed
**Deciders**: Mark Allen
**Related ADRs**: ADR-001, ADR-003, ADR-008

---

## Context

V2's CLI search engine uses 128-dimensional feature-hashed TF-IDF embeddings indexed in an in-memory HNSW graph. This pipeline has a fundamental flaw: **hash collisions make unrelated technologies appear similar**.

### Root Cause Analysis

The V2 `TfIdfEmbedder` (in `src/discovery/embeddings.ts`) works as follows:

1. Tokenize all technology descriptions into terms (with bigrams)
2. Compute TF-IDF scores for each term
3. Hash each term to a dimension index using FNV-1a: `dimIdx = abs(hash(term)) % 128`
4. Accumulate TF-IDF scores at the hashed dimension
5. L2-normalize the resulting 128-dimensional vector

The vocabulary contains 2,000+ unique terms (technology names, algorithm names, descriptions, keywords). Compressing 2,000+ terms into 128 buckets produces an average of ~16 terms per bucket. When unrelated terms hash to the same bucket, their TF-IDF scores accumulate into the same dimension, creating false similarity.

**Concrete example from Benchmark Q2** ("draft best-selling books"):

- The query tokens include "draft," "best," "selling," "books"
- "model" (from "model best practices" in V2's expanded tokenization) hashes to dimension 47
- Min-Cut Gated Attention's description contains "model" (as in "transformer model"), also at dimension 47
- Both vectors have significant weight at dimension 47, producing cosine similarity of 0.38
- Auto-Sharding's description contains "compute" which collides with "best" at dimension 82, producing 0.28 similarity

These are **structurally inevitable** with 128-dimensional feature hashing on a 2,000+ term vocabulary. The collision rate is approximately `1 - (127/128)^2000 = ~100%` for any given dimension -- every dimension has multiple terms mapped to it.

### Benchmark CLI Results (V2)

| Query | Top Match | Score | Correct? | Root Cause |
|-------|-----------|-------|----------|------------|
| Q1: hallucination detection | prime-radiant | 0.52 | Yes | "coherence" and "verification" terms matched |
| Q1: hallucination detection | Min-Cut Gated Attention | 0.38 | No | "gate" and "model" hash collisions |
| Q2: draft books | Min-Cut Gated Attention | 0.38 | No | "model" hash collision |
| Q2: draft books | Continuous Batching | 0.32 | No | "batch" / "production" collision |
| Q2: draft books | Auto-Sharding | 0.28 | No | "compute" / "best" collision |
| Q3: database mobile | ruvector-postgres | 0.45 | Partial | Correct crate, missed rvlite |
| Q5: healthcare | Continuous Batching | 0.41 | No | "clinical" / "batch" collision |

Average precision across all queries: **~25%** (1 correct result per 4 returned). This is a D+ grade for the CLI path.

## Decision

**V3 CLI uses sparse TF-IDF (full vocabulary, no hashing) with field-weighted embedding, minimum score threshold, domain routing as first-pass filter, and post-retrieval re-ranking.**

### 1. Sparse TF-IDF (No Hashing)

Replace the 128-dimensional feature-hashed vectors with sparse TF-IDF vectors using the full vocabulary. Each term maps to its own dimension (vocabulary index), eliminating hash collisions entirely.

For a vocabulary of 2,000 terms, this produces 2,000-dimensional sparse vectors. Since most technologies use only 20-50 unique terms, the vectors are >97% sparse. Storage and search use sparse data structures (sorted index arrays + value arrays), not dense Float32Arrays.

### 2. Field-Weighted Embedding

V2 concatenates all fields into a single string before embedding. V3 applies different weights to different fields:

| Field | Weight | Rationale |
|-------|--------|-----------|
| `useWhen` | 3.0x | Most direct expression of when to use the technology |
| `useCases` (new, ADR-008) | 3.0x | Natural-language problem scenarios |
| `keywords` | 2.0x | Curated terms for the capability domain |
| `plainDescription` (new, ADR-008) | 2.0x | Non-technical description improves recall for plain-language queries |
| `name` | 1.0x | Technology name (exact match is already strong) |
| `features` | 1.0x | Feature descriptions |
| `crate` | 0.5x | Crate name (useful for exact lookup, not semantic search) |
| `status` | 0.0x | Not useful for semantic matching |

Embedding is computed as: `embed(tech) = normalize(3.0 * tfidf(useWhen) + 3.0 * tfidf(useCases) + 2.0 * tfidf(keywords) + ...)`

### 3. Minimum Score Threshold

Results below 0.25 cosine similarity are suppressed. If all results fall below 0.25, the CLI returns:

```
No relevant technologies found for: "draft best-selling books"
RuVector is an AI/ML infrastructure library. This query appears to be outside its scope.
```

The 0.25 threshold is derived from analysis of the benchmark: correct matches score 0.45+ with sparse TF-IDF; false positives from V2's feature hashing scored 0.28-0.38. The threshold sits below correct matches and above the noise floor.

### 4. Domain Routing as First-Pass Filter

Before running HNSW search, the CLI classifies the query into one or more capability domains using keyword matching against domain keywords:

```
"hallucination detection" → coherence_safety domain
"database for mobile"    → storage domain
"bio-inspired edge"      → nervous_system + edge domains
```

Only technologies in matched domains are searched. This reduces the candidate set from 80 to ~5-15 and eliminates cross-domain false positives.

If no domain matches, all technologies are searched (fallback to full search).

### 5. Post-Retrieval Re-Ranking

After HNSW returns top-k candidates, a re-ranking step applies:

- **primaryCrate boost**: If a match is the `primaryCrate` for its capability, boost score by 1.2x. This ensures that ruvector-core (the primary vector search crate) outranks micro-hnsw-wasm for generic "vector search" queries.
- **Status weight**: Production technologies get a 1.05x boost. Experimental get 1.02x. Research gets no boost.
- **Exact term match bonus**: If any query term appears exactly in the technology name or useWhen field (not via TF-IDF), add 0.1 to the score.

## Consequences

### Positive

- **Eliminates hash collisions**: The root cause of V2's D+ grade is removed. Min-Cut Gated Attention will no longer score 0.38 for "draft best-selling books" because "model" and "gate" will be at different dimensions with different TF-IDF weights.
- **Projected quality improvement**: From D+ (~25% precision) to B+ (~75% precision). The remaining 25% gap is due to TF-IDF's inherent limitation: it matches terms, not concepts. "Prevent my model from drifting" will match technologies containing "drift" and "model" but not technologies described only as "coherence verification."
- **No external dependencies**: Sparse TF-IDF is pure TypeScript. No ONNX runtime, no model downloads, no WASM binaries.
- **Field weighting respects data model extensions**: The new fields from ADR-008 (`useCases`, `plainDescription`) are weighted to improve recall. Technologies that describe their use cases in natural language will match natural-language queries better.

### Negative

- **Higher memory footprint**: Sparse 2,000-dimensional vectors consume more memory than dense 128-dimensional vectors. For 80 technologies with ~30 non-zero terms each, this is approximately 80 * 30 * 8 bytes = 19.2KB (index + value pairs). Still negligible.
- **Sparse HNSW is more complex**: The HNSW distance function must compute sparse cosine similarity (iterate over non-zero indices) rather than dense dot product. This is slower per comparison but still sub-millisecond for 80 vectors.
- **Still limited by TF-IDF semantics**: "Prevent hallucinations" will not match "sheaf cohomology" because the terms do not overlap. The `useCases` field (ADR-008) mitigates this by adding natural-language scenarios that contain overlapping terms, but the fundamental semantic gap remains. Neural embeddings (deferred to V3.1) would close this gap.

### Neutral

- **CLI remains secondary to SKILL.md**: Even at B+ quality, the CLI is inferior to CAG's A- for interactive use. The CLI's value is in batch/programmatic scenarios (CI pipelines, automated RVBP generation) where Claude's context window is not available.

## Alternatives Considered

### Alternative A: Neural Embeddings (Deferred to V3.1)

Replace TF-IDF with neural embeddings from a small transformer model (e.g., all-MiniLM-L6-v2 via ONNX).

**Why deferred**: Adds an ONNX runtime dependency (~50MB) and a model file (~25MB). For a 200-technology catalog, this is disproportionate infrastructure. Sparse TF-IDF with field weighting achieves B+ quality at zero external dependency cost. Neural embeddings become worthwhile when the catalog exceeds 500 technologies or when the CLI is the primary interface (neither condition is true for V3).

**V3.1 plan**: If demand materializes, add neural embedding support as an optional feature behind a `--neural` flag, using ruvector-wasm's own embedding capabilities (dogfooding).

### Alternative B: No CLI At All (Rejected)

Remove the CLI and rely entirely on the SKILL.md / CAG path.

**Why rejected**: The CLI serves use cases that CAG cannot: batch processing (search 50 queries programmatically), CI/CD integration (verify that a PR's technology claims match the catalog), and automated RVBP generation. These are not hypothetical -- the V2 CLI already has `verify-doc` and `generate-workflows` commands that depend on programmatic search.

### Alternative C: BM25 Instead of TF-IDF (Considered)

BM25 (Okapi BM25) is a ranking function that extends TF-IDF with document length normalization and term frequency saturation.

**Status**: Considered but not adopted for V3. BM25's advantages over TF-IDF are most pronounced on long documents where term frequency saturation matters. For the catalog's short technology descriptions (20-50 tokens each), the difference is marginal. TF-IDF with sublinear TF (`1 + log(tf)`) already provides similar saturation. BM25 is a candidate for V3.1 if field-weighted sparse TF-IDF proves insufficient.

## Evidence

### Hash Collision Analysis

V2's FNV-1a hash function maps terms to 128 buckets:

```
hash("model") % 128 = 47
hash("transformer") % 128 = 47   ← COLLISION
hash("gate") % 128 = 93
hash("gated") % 128 = 93         ← COLLISION
hash("batch") % 128 = 12
hash("clinical") % 128 = 12      ← COLLISION
```

These collisions are deterministic and affect every query. With 2,000+ terms in 128 buckets, the birthday problem guarantees extensive collisions. The expected number of collisions is: `C(n, 2) / d = C(2000, 2) / 128 = ~15,600 collision pairs`.

### Projected Precision with Sparse TF-IDF

| Query | V2 Precision (128-dim hashed) | V3 Projected (sparse + weighted) | Improvement Source |
|-------|------------------------------|----------------------------------|-------------------|
| Q1: hallucination detection | 40% (2/5 correct) | 80% (4/5) | useCases field + field weighting |
| Q2: out-of-scope books | 0% (0/5 correct) | 100% (correctly returns "no match") | Score threshold |
| Q3: database for mobile | 40% (2/5) | 80% (4/5) | useCases + deployment target filter |
| Q4: bio-inspired edge | 20% (1/5) | 60% (3/5) | Domain routing (nervous_system + edge) |
| Q5: healthcare | 0% (0/5) | 60% (3/5) | useCases + plainDescription matching |
| **Average** | **20%** | **76%** | |

## Notes

The CLI and CAG paths share the same underlying data model (catalog.json, extended per ADR-008). The CLI path transforms catalog.json into sparse TF-IDF vectors; the CAG path renders catalog.json into SKILL.md sections. Both benefit from the same data model improvements.
