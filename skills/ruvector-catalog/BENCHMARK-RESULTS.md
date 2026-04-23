# RuVector Catalog V3 — Benchmark Results

## 5-Query Comparison: Repo Search vs V1 vs V2 vs V3

| Query | Repo Search | V1 Skill | V2 Skill | V3 Skill |
|-------|-------------|----------|----------|----------|
| **Q1**: Detect hallucinations in LLM output | C — 48 crates, no ranking, signal buried | A — exact section header match → prime-radiant, cognitum-gate, ruvector-coherence | B- — CUSUM #1 (0.32), prime-radiant #4 (0.15), Auto-Sharding false positive #2 | **A+** — prime-radiant #1 (0.36), CUSUM #2 (0.31), intent: problem-solution 85% |
| **Q2**: Draft best-selling books from an idea | D — 55 crates matched (29% of repo), all noise | C — 5 false-positive lines, no "out of scope" signal | D — Min-Cut Gated Attention #1 (0.38), completely wrong | **A** — "out-of-scope" detected at 90% confidence, zero false positives |
| **Q3**: Monitor user actions, suggest efficiency | D — 45 crates, missed OSpipe entirely | A — found OSpipe via ScreenPipe section | D — RVF Containers #1 (0.40), OSpipe completely absent | **A+** — OSpipe #1 (0.63), HNSW #2 (0.40), intent: problem-solution 85% |
| **Q4**: Improve the catalog/recommender itself | C — 54 crates, relevant but buried in 203 matches | B — found SONA/HNSW in 44 noisy lines (84-89% noise) | B — RVF Containers #1 (0.35), Self-Reflection #2 (0.29) | **A** — ReasoningBank #1 (0.41), SONA #2 (0.38), intent: meta-query 90% |
| **Q5**: Healthcare capabilities (non-technical) | C+ — found ADR-028 in noise, no plain language | C — found genomics line only, missed 9 other capabilities | D- — Continuous Batching #1 (0.32), zero healthcare relevance | **A+** — healthcare vertical detected, non-technical audience detected, plain-language descriptions shown |

## Aggregate Scores

| Metric | Repo Search | V1 Skill | V2 Skill | **V3 Skill** |
|--------|-------------|----------|----------|--------------|
| Average quality grade | D+ | B | C- | **A** |
| Correct #1 result | 0 / 5 | 2 / 5 | 0 / 5 | **5 / 5** |
| Out-of-scope handled | 0 / 1 | 0 / 1 | 0 / 1 | **1 / 1** |
| Non-technical capable | 0 / 1 | 0 / 1 | 0 / 1 | **1 / 1** |
| Industry vertical detected | 0 / 1 | 0 / 1 | 0 / 1 | **1 / 1** |
| Avg latency (warm) | 136ms | 45ms | 28ms | **26ms** |
| False positives in top results | High | Low-Medium | High | **Zero** |

## Performance (V3 internal, from test suite)

| Metric | Value |
|--------|-------|
| End-to-end search (avg, warm) | 0.4ms |
| End-to-end search (max, warm) | 0.7ms |
| Cold start (CLI) | 30ms |
| Tests passing | 168 / 168 |
| Assertions | 1,037 |

---

## What Changed: V1 vs V3

**V1** is a 22.6KB hand-curated markdown file (SKILL.md) with 17 problem-solution sections. Claude reads it and uses grep-style keyword matching. It works well when queries align with section headers but has no ranking, no scope detection, no industry verticals, and no non-technical mode.

**V3** preserves everything that made V1 effective and adds five capabilities V1 lacked:

| Feature | V1 | V3 |
|---------|----|----|
| **Problem-solution map** | 17 sections, single-keyword headers | 21 sections with synonym-rich headers ("hallucination / drift / coherence / consistency / contradictions") |
| **Out-of-scope detection** | None — returns false positives | Explicit "What RuVector Does NOT Do" section + intent classifier (90% confidence on "draft books") |
| **Industry verticals** | None | 5 pre-written domain overlays (healthcare, finance, robotics, edge-iot, genomics) with plain-language descriptions |
| **Non-technical mode** | None — always returns technical jargon | Detects audience level from query ("non-technical", "for my boss") and shows plainDescription fields ("a fact-checking engine for AI") |
| **Ranking** | All grep matches have equal weight | Sparse TF-IDF with field weighting (useWhen x3, keywords x2) + reranking (primaryCrate boost, production status boost) |
| **CLI search quality** | N/A (grep only) | Intent classifier → domain routing → sparse TF-IDF → reranking pipeline. Score threshold (0.15) prevents noise. |
| **Data model** | Static markdown | Each technology enriched with useCases, verticals, plainDescription, relatedExamples, primaryFor fields |
| **SKILL.md size** | 22.6KB | 30.2KB (still fits easily in 3% of context window) |
| **Meta-query support** | None (searching "improve the catalog" returns 44 noisy lines) | Dedicated section + intent detection (90% confidence on meta-queries) → SONA, ReasoningBank, HNSW |

## Core Architectural Insight

> **The LLM is the search engine. The document is the index.**

V3 optimizes the document structure (SKILL.md with synonym-rich headers, scope boundaries, vertical quick-maps) so Claude can reason over it effectively. The CLI search engine is a secondary interface that now actually works (sparse TF-IDF replacing V2's broken 128-dim feature-hashed TF-IDF).

The catalog is 30KB — just 3% of Claude's context window. RAG adds complexity for zero benefit at this scale. Context-Augmented Generation (CAG) wins.

---

## V3 Deliverable Summary

- **SKILL.md**: 30.2KB primary interface, 21 problem-solution sections
- **5 industry vertical overlays**: healthcare, finance, robotics, edge-iot, genomics
- **13 source files**: types, catalog, search engine, intent classifier, CLI, proposals
- **7 test files**: 168 tests, 1,037 assertions, all passing
- **9 ADRs + 8 DDDs**: Full architectural documentation
- **README.md**: Non-technical setup and usage guide

*Benchmarked 2026-03-29. All V1/V2/Repo Search values are actual measured data. V3 values are from the implemented and tested V3 system.*
