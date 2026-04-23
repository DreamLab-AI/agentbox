# ADR-009: Benchmark Comparison -- All Approaches

**Status**: Accepted
**Date**: 2026-03-28
**Supersedes**: None
**Cross-references**: ADR-001 (CAG Architecture), ADR-002 (Problem-Solution Headers), ADR-003 (Scope Boundary), ADR-004 (Industry Verticals), ADR-005 (Non-Technical Adaptation), ADR-006 (Swarm Escalation), ADR-007 (CLI Search Fix), ADR-008 (Data Model Extensions)

---

## Context

The V3 ruvector-catalog skill redesign must be justified by measured evidence, not intuition. This ADR documents the actual benchmark data collected from three systematic tests of the existing approaches (Repo Search, V1 Skill, V2 Skill) and provides predicted performance for the V3 design based on that evidence. All numerical values for Repo Search, V1, and V2 are taken directly from the benchmark reports; none are estimated.

---

## 1. Methodology

### 1.1 Approaches Tested

| Approach | Description | Corpus | Search Method |
|----------|-------------|--------|---------------|
| **Repo Search** | Raw grep on `/ruvector/` source tree | 502 files (171 Cargo.toml + 160 lib.rs + 171 ADRs) | `grep -rl` with hand-picked regex patterns |
| **V1 Skill** | SKILL.md (22.6KB, 237 lines) + catalog.json (18KB, 705 lines) | 2 files, 40,589 bytes total | `grep -i -n -E` with hand-picked patterns |
| **V2 Skill** | TF-IDF semantic search CLI via `catalog.store.json` (207KB) | 1 store file, ~65 technology entries | Bun CLI with 128-dim TF-IDF cosine similarity |
| **V3 Predicted** | CAG with enhanced SKILL.md + industry verticals + scope guard + swarm escalation | Enhanced SKILL.md (~35KB) + vertical overlays | LLM context-window augmented generation with structured fallbacks |

### 1.2 Measurement Method

- **Wall-clock time**: Measured via `/usr/bin/time` wrapping each command.
- **Internal search time**: Reported by the V2 CLI engine (Bun runtime).
- **File read overhead**: Measured for V1 via `cat ... > /dev/null` with timing.
- **Quality grading criteria**:
  - **A+**: Correct primary answer in position 1, no false positives in top 3, appropriate scope handling.
  - **A**: Correct primary answer in top 3, minimal noise.
  - **B**: Correct answer present but buried or mixed with noise.
  - **C**: Some relevant results but primary answer missing or ranked poorly.
  - **D**: Mostly noise, correct answer absent or deeply buried.
  - **F**: Zero useful results, or actively misleading output with no scope signal.

### 1.3 Benchmark Queries

| ID | Query | Expected Best Answer | Scope |
|----|-------|---------------------|-------|
| Q1 | "detecting hallucinations in LLM output before it reaches users" | prime-radiant (coherence engine) | In-scope |
| Q2 | "draft best selling books from an idea using AI" | Out-of-scope signal | Out-of-scope |
| Q3 | "monitor all user actions on a computer and suggest efficiency improvements through AI and automation" | OSpipe (ScreenPipe integration) | In-scope |
| Q4 | "improve the ruvector-catalog skill and technology recommender" | SONA / HNSW / ReasoningBank | In-scope (meta) |
| Q5 | "explain at non-technical level what capabilities could add value to a clinical healthcare solution" | Healthcare vertical with plain language | In-scope (vertical + adaptation) |

---

## 2. Per-Query Results

### 2.1 Q1: "detecting hallucinations in LLM output before it reaches users"

| Metric | Repo Search | V1 Skill | V2 Skill | V3 Predicted |
|--------|-------------|----------|----------|--------------|
| **Latency** | 136.5ms | 44.73ms | 179ms (cold) / ~28ms (warm) | <5ms (CAG, in-context) |
| **Files/Docs Searched** | 502 | 2 | 1 (store file) | 0 (pre-loaded context) |
| **Top Result** | cognitum-gate-kernel | prime-radiant | CUSUM Drift Detection (0.32) | prime-radiant (predicted) |
| **Top Result Score** | N/A (no ranking) | Exact section header match | 0.32 cosine | N/A (LLM judgment) |
| **prime-radiant Position** | Present but unranked (1 of 48 crates) | #1 (exact section: "verify AI outputs / prevent hallucination / detect drift") | #4 (score: 0.15) | #1 (predicted, via ADR-002 intent header) |
| **False Positives in Top 5** | N/A (all 48 crates returned equally) | 3-4 tangential matches (financial coherence, FPGA) | 3 (Auto-Sharding, Agentic Robotics, Spiking Graph Attention) | 0-1 (predicted) |
| **Correct Answer Found?** | Yes, but buried in 48 results | Yes, #1 position | Yes, but at #4 with score 0.15 | Yes (predicted) |
| **Quality Grade** | **D** | **A** | **C** | **A+** (predicted) |

**Key findings**:
- V1 excels here because SKILL.md has an exact section header: "I need to verify AI outputs / prevent hallucination / detect drift". Grep matches it immediately. This validates ADR-002's decision to preserve problem-solution headers.
- V2 fails badly: the TF-IDF engine ranks CUSUM Drift Detection (a financial trading tool) at #1 with 0.32, while the actual best answer (prime-radiant) ranks #4 with only 0.15. Auto-Sharding (consensus/replication, completely irrelevant) ranks #2. The 128-dim TF-IDF space cannot distinguish "hallucination detection" from "drift detection in financial models."
- Repo Search returns 48 unique crates and 214 file matches. The signal-to-noise ratio is approximately 7:48 (15%).

### 2.2 Q2: "draft best selling books from an idea using AI"

| Metric | Repo Search | V1 Skill | V2 Skill | V3 Predicted |
|--------|-------------|----------|----------|--------------|
| **Latency** | 115.1ms | 45.17ms | 28ms | <5ms (CAG, in-context) |
| **Files/Docs Searched** | 502 | 2 | 1 | 0 |
| **Top Result** | ruvllm (matched on "LLM") | ruvector-filter (matched on "text") | Min-Cut Gated Attention (0.38) | Out-of-scope signal (predicted) |
| **Top Result Score** | N/A | N/A (false positive) | 0.38 cosine | N/A |
| **Out-of-Scope Signal?** | No | No | No | Yes (predicted, via ADR-003 scope guard) |
| **False Positives in Top 5** | All (29 Cargo.toml, 44 lib.rs, 172 ADRs) | All 5 SKILL.md matches, 1 catalog.json match | All 5 (Min-Cut, Dynamic Min-Cut, Mamba S5, Hyperbolic Attention, Graph Transformer) | 0 (predicted) |
| **Correct Answer Found?** | No (correct answer is "out of scope") | No (correct answer is "out of scope") | No (correct answer is "out of scope") | Yes (predicted) |
| **Quality Grade** | **F** | **F** | **F** | **A+** (predicted) |

**Key findings**:
- This is the critical failure case that motivated ADR-003 (Scope Boundary). All three existing approaches confidently return results for a query that is entirely outside RuVector's capabilities.
- V2 is the worst offender: it returns Min-Cut Gated Attention with the highest confidence score of any query (0.38), suggesting RuVector can help draft books via graph-based attention gating. This is actively misleading.
- V1 returns 5 SKILL.md matches that are all false positives ("text" in payload filtering, "write" in copy-on-write). The V1 report correctly identifies that "grep cannot distinguish 'no match because irrelevant query' from 'no match because bad search terms.'"
- Repo Search returns 245 file matches (the most of any query) because broad terms like "generation", "text", "agent", and "pipeline" match nearly everything.
- None of the three approaches can say "RuVector does not do this."

### 2.3 Q3: "monitor all user actions on a computer and suggest efficiency improvements through AI and automation"

| Metric | Repo Search | V1 Skill | V2 Skill | V3 Predicted |
|--------|-------------|----------|----------|--------------|
| **Latency** | 147.8ms | 43.93ms | 27ms | <5ms (CAG, in-context) |
| **Files/Docs Searched** | 502 | 2 | 1 | 0 |
| **Top Result** | agentic-robotics (matched on "agent") | OSpipe (matched on "ScreenPipe") | RVF Cognitive Containers (0.40) | OSpipe (predicted) |
| **Top Result Score** | N/A | Section header match | 0.40 cosine | N/A |
| **OSpipe Position** | Not found (0 matches for "screenpipe" or "OSpipe") | #1 (section: "I need to work with ScreenPipe") | Not in top 5 | #1 (predicted) |
| **False Positives in Top 5** | All 45 crates (none directly relevant) | 8-10 tangential (spiking attention, coherence monitoring) | 4 (PostgreSQL Extension, RVLite, DiskANN, Spiking Graph Attention) | 0-1 (predicted) |
| **Correct Answer Found?** | No | Yes | No | Yes (predicted) |
| **Quality Grade** | **F** | **B+** | **D** | **A+** (predicted) |

**Key findings**:
- Repo Search completely fails: zero matches for "screenpipe" or "OSpipe" because those terms exist in the catalog/skill files but not in the ruvector crate source code. OSpipe lives in `examples/OSpipe`, which was not in the grep search path. This is a fundamental corpus gap.
- V1 succeeds because SKILL.md contains the section "I need to work with ScreenPipe" which grep finds via the "pipe" and "screen" terms. However, V1 also returns 14 noisy matches and misses SONA (the self-learning engine relevant to "suggest improvements") because "sona" does not appear in any grep pattern.
- V2 returns RVF Cognitive Containers at #1 (0.40) and PostgreSQL Extension at #2 (0.36). Neither has anything to do with desktop monitoring. OSpipe does not appear in the top 5 results at all. The TF-IDF vectors for "monitor user actions on a computer" point toward database/container technologies rather than the ScreenPipe integration.

### 2.4 Q4: "improve the ruvector-catalog skill and technology recommender"

| Metric | Repo Search | V1 Skill | V2 Skill | V3 Predicted |
|--------|-------------|----------|----------|--------------|
| **Latency** | 142.7ms | 44.70ms | 29ms | <5ms (CAG, in-context) |
| **Files/Docs Searched** | 502 | 2 | 1 | 0 |
| **Top Result** | micro-hnsw-wasm (matched on "HNSW") | SONA (matched on "improve") | RVF Cognitive Containers (0.35) | SONA or HNSW (predicted) |
| **Top Result Score** | N/A | Keyword match in context | 0.35 cosine | N/A |
| **SONA/HNSW in Top 3?** | HNSW present but unranked (1 of 54 crates) | SONA found on line 110, HNSW on line 17 | Neither in top 3 (Matryoshka Embeddings at #3, 0.28) | Yes (predicted) |
| **False Positives in Top 5** | 49+ (nearly all crates match "search" or "embedding") | 20+ noisy line matches (84-89% noise rate per V1 report) | 3 (RVF Containers, Self-Reflection, Sheaf Attention) | 0-1 (predicted) |
| **Correct Answer Found?** | Partially (HNSW found, SONA found, but buried) | Partially (found but buried in 44 line matches) | Partially (Domain Expansion at #4, 0.27) | Yes (predicted) |
| **Quality Grade** | **D** | **C** | **C** | **A** (predicted) |

**Key findings**:
- This is a meta-query (about the skill itself). All approaches struggle with it because the concept of "improve the recommender" requires understanding the system's own architecture.
- Repo Search returns 54 unique crates (32% of the entire codebase) because "search", "embedding", and "skill" are ubiquitous terms.
- V1 returns 27 SKILL.md lines and 17 catalog.json lines (44 total). The V1 report measures an 84-89% noise rate.
- V2 returns RVF Cognitive Containers at #1 again (0.35), which is the same top result as Q3. This suggests the TF-IDF model has a bias toward RVF's broad description matching many query types.
- The actually relevant technologies (SONA for self-learning, HNSW for vector search, ReasoningBank for pattern learning) are either absent from V2's top 5 or ranked low.

### 2.5 Q5: "explain at non-technical level what capabilities could add value to a clinical healthcare solution"

**Note**: Q5 was not included in any of the three benchmark runs. The values below are predicted based on each approach's demonstrated behavior on Q1-Q4.

| Metric | Repo Search (predicted) | V1 Skill (predicted) | V2 Skill (predicted) | V3 Predicted |
|--------|------------------------|---------------------|---------------------|--------------|
| **Latency** | ~135ms | ~45ms | ~28ms | <5ms (CAG) |
| **Files/Docs Searched** | 502 | 2 | 1 | 0 |
| **Top Result** | Likely ruvector-coherence or neural-trader-* (matched on "clinical" or "health") | Likely no section match (no healthcare header in SKILL.md) | Likely database or container technology (TF-IDF bias) | Healthcare vertical overlay with plain-language descriptions (predicted, via ADR-004 + ADR-005) |
| **Non-Technical Language?** | No (returns crate names and code paths) | No (returns technical grep output) | No (returns crate names with technical descriptions) | Yes (predicted, via ADR-005 response adaptation) |
| **Healthcare Context?** | No (no healthcare-specific content in crate code) | No (no healthcare vertical in current SKILL.md) | No (no healthcare vertical in catalog.store.json) | Yes (predicted, via ADR-004 industry verticals) |
| **Correct Answer Found?** | No | No | No | Yes (predicted) |
| **Quality Grade** | **F** (predicted) | **F** (predicted) | **F** (predicted) | **A** (predicted) |

**Key findings**:
- None of the existing approaches have healthcare-specific content or the ability to adapt technical descriptions into non-technical language. All three would return raw technical output that a clinical stakeholder could not act on.
- V3 addresses this through two ADRs: ADR-004 (Industry Vertical Overlays) adds healthcare-specific use case mappings, and ADR-005 (Non-Technical Response Adaptation) provides plain-language reformatting of capabilities.

---

## 3. Aggregate Performance Summary

| Metric | Repo Search | V1 Skill | V2 Skill | V3 Predicted |
|--------|-------------|----------|----------|--------------|
| **Avg Latency (Q1-Q4 measured)** | 135.5ms | 44.63ms | 65.75ms* | <5ms |
| **Avg Quality Grade (Q1-Q4)** | D (1.25/4) | B- (2.5/4) | D+ (1.5/4) | A+ (3.75/4) |
| **Queries w/ Correct #1 Result** | 0/5 | 2/5 (Q1, Q3) | 0/5 | 4/5 (predicted) |
| **Queries w/ Correct Answer in Top 3** | 0/5 | 2/5 | 0/5 | 5/5 (predicted) |
| **Queries w/ Out-of-Scope Handling** | 0/1 | 0/1 | 0/1 | 1/1 (predicted) |
| **Queries w/ Non-Technical Capability** | 0/1 | 0/1 | 0/1 | 1/1 (predicted) |
| **Avg False Positives in Top 5** | N/A (no ranking) | 5-10 per query | 3.25 per query | <1 (predicted) |

*V2 average includes the 179ms cold-start for Q1. Warm average for Q2-Q4 is 28ms.

---

## 4. Failure Analysis Per Approach

### 4.1 Repo Search: Noise Overwhelms Signal

**Root cause**: Searching 502 raw source files with regex patterns guarantees massive over-matching. Every query returns 183-245 file matches and 45-55 unique crates (26-32% of all 171 crates match every query).

**Specific failures**:
- Q1: 48 crates returned with no ranking. `ruvector-bench` matches "verification" in a benchmarking context alongside the actually relevant `prime-radiant`.
- Q2: `cognitum-gate-kernel` matches because it has a `generation: u16` counter field. 172 of 171 ADRs match "generation|text|LLM|agent|pipeline|workflow".
- Q3: Zero matches for "screenpipe" or "OSpipe" because those concepts exist in the catalog but not in crate source code. Fundamental corpus gap.
- Q4: 54 crates match because "search" and "embedding" appear in nearly every crate's documentation.

**Why V3 fixes this**: CAG eliminates search entirely for the common case (ADR-001). The LLM reads the curated SKILL.md in its context window and applies semantic judgment, not regex matching.

### 4.2 V1 Skill: Grep on Curated Doc Works But Lacks Ranking

**Root cause**: The SKILL.md problem-solution section headers are an excellent retrieval mechanism when queries align with them. But grep returns all matching lines with equal weight and cannot rank, filter, or signal scope boundaries.

**Specific failures**:
- Q1: SUCCESS. The exact header "I need to verify AI outputs / prevent hallucination / detect drift" delivers prime-radiant immediately. This validates the design preserved in ADR-002.
- Q2: FAIL. Returns 5 false-positive lines ("text" in filtering, "write" in copy-on-write). Cannot indicate "out of scope."
- Q3: PARTIAL. Finds OSpipe via "ScreenPipe" keyword overlap but misses SONA because the grep terms do not include "sona" or "learn." A human curating the grep pattern would need domain knowledge to get full recall.
- Q4: NOISY. 44 line matches at 84-89% noise rate. Every mention of "search" or "index" across the corpus matches.

**What V3 preserves**: ADR-002 keeps the problem-solution headers as the primary intent index because they are the single most effective feature of V1.

**What V3 adds**: LLM semantic judgment replaces grep, providing ranking, noise filtering, and scope detection.

### 4.3 V2 Skill: TF-IDF in 128-dim Fails on Intent

**Root cause**: The 128-dimensional TF-IDF embedding space has insufficient resolution to distinguish semantically different uses of similar vocabulary. Cosine similarity scores are universally low (0.12-0.40 range) and do not correlate with actual relevance.

**Specific failures by score analysis**:

| Query | Top Score | Top Result | Actually Relevant? | Best Relevant Score | Best Relevant Rank |
|-------|-----------|------------|-------------------|--------------------|--------------------|
| Q1 | 0.32 | CUSUM Drift Detection | Tangential (financial) | 0.15 (prime-radiant) | #4 |
| Q2 | 0.38 | Min-Cut Gated Attention | No | N/A (out of scope) | N/A |
| Q3 | 0.40 | RVF Cognitive Containers | No | OSpipe not in top 5 | >5 |
| Q4 | 0.35 | RVF Cognitive Containers | No | 0.27 (Domain Expansion) | #4 |

**Pattern**: RVF Cognitive Containers appears as #1 for two different queries (Q3 and Q4) with scores of 0.40 and 0.35. This suggests the RVF description ("19 sub-crate container format with crypto, runtime, federation") has a broad TF-IDF footprint that matches many query types, creating a "popularity bias" unrelated to actual relevance.

**Score distribution problem**: The highest score across all 20 results (4 queries, 5 results each) is only 0.40. The lowest is 0.12. This narrow 0.28-point spread means the ranking signal is extremely weak -- the difference between "best match" and "worst match" is smaller than the noise floor.

**V2 internal timing vs. wall-clock**: The V2 report shows internal search time of 0.2-0.3ms but wall-clock time of 27-179ms. The 100-600x overhead is Bun JIT compilation and process startup, not search. This means the TF-IDF approach adds process overhead without improving result quality.

**Why V3 replaces this**: ADR-001 (CAG) eliminates the external search process entirely. The LLM context window provides semantic understanding that 128-dim TF-IDF cannot.

### 4.4 V3 Predicted: How Each ADR Addresses a Specific Failure

| ADR | Failure Addressed | Evidence from Benchmarks |
|-----|-------------------|-------------------------|
| **ADR-001** (CAG Architecture) | V2 TF-IDF returns irrelevant results with false confidence | V2 Q2: Min-Cut Gated Attention at 0.38 for "draft books"; V2 Q3: RVF Containers at 0.40 for "monitor user actions" |
| **ADR-002** (Problem-Solution Headers) | V1 succeeds when headers match but fails otherwise | V1 Q1: exact header match delivers prime-radiant at #1; V1 Q4: no matching header, 84-89% noise |
| **ADR-003** (Scope Boundary) | All approaches return results for out-of-scope queries | Q2: all three return confident results for "draft books" -- zero scope signals |
| **ADR-004** (Industry Verticals) | No approach has domain-specific context | Q5: no healthcare content exists in any corpus; all approaches would return raw technical output |
| **ADR-005** (Non-Technical Adaptation) | All output is technical crate names and scores | Q5: a clinical stakeholder cannot act on "CUSUM Drift Detection (0.32)" or "cognitum-gate-kernel" |
| **ADR-006** (Swarm Escalation) | Complex queries need deeper analysis than a catalog can provide | Q4 (meta-query): all approaches struggle because "improve the recommender" requires architectural reasoning |
| **ADR-007** (CLI Search Fix) | V2 process startup overhead negates sub-ms search speed | V2 Q1 cold start: 179ms wall-clock for 0.3ms internal search (596x overhead) |
| **ADR-008** (Data Model Extensions) | Catalog schema lacks fields for scope, verticals, complexity | Q2 failure: no "scope: in/out" field; Q5 failure: no "vertical: healthcare" field |

---

## 5. V3 Benchmark Regression Test Specification

The following acceptance criteria define PASS/FAIL for V3 implementation testing. Every criterion is derived from a measured failure in the V1/V2/Repo benchmarks.

### 5.1 Per-Query Pass Criteria

#### Q1: "detecting hallucinations in LLM output before it reaches users"
- **PASS**: `prime-radiant` appears in top 3 results
- **PASS**: `cognitum-gate-kernel` or `ruvector-coherence` also present
- **PASS**: `Auto-Sharding` (ruvector-cluster) does NOT appear in top 3
- **FAIL**: prime-radiant ranked below #3, or absent
- **Regression source**: V2 ranked prime-radiant at #4 (score 0.15) behind Auto-Sharding (0.28)

#### Q2: "draft best selling books from an idea using AI"
- **PASS**: Response includes explicit "out of scope" or "not applicable" signal
- **PASS**: Response does NOT recommend specific RuVector technologies as solutions
- **PASS**: Response may optionally mention general-purpose components (ruvllm, rvAgent) as building blocks with appropriate caveats
- **FAIL**: Any RuVector technology recommended as a direct solution for book drafting
- **Regression source**: V2 returned Min-Cut Gated Attention (0.38) as the top recommendation

#### Q3: "monitor all user actions on a computer and suggest efficiency improvements through AI and automation"
- **PASS**: `OSpipe` appears in top 3 results
- **PASS**: Description references ScreenPipe integration, semantic AI memory
- **PASS**: `RVF Cognitive Containers` does NOT appear in top 3
- **FAIL**: OSpipe absent from top 3, or storage/DB technologies dominate results
- **Regression source**: V2 returned RVF Cognitive Containers at #1 (0.40); OSpipe not in top 5; Repo Search had zero OSpipe matches

#### Q4: "improve the ruvector-catalog skill and technology recommender"
- **PASS**: At least one of `SONA`, `HNSW`, or `ReasoningBank` appears in top 3
- **PASS**: Response addresses the meta-nature of the query (recommendations about the recommender)
- **FAIL**: Generic database or container technologies dominate top 3
- **Regression source**: V2 returned RVF Cognitive Containers at #1 (same as Q3); V1 had 84-89% noise rate

#### Q5: "explain at non-technical level what capabilities could add value to a clinical healthcare solution"
- **PASS**: Response includes healthcare-specific use case descriptions
- **PASS**: Response uses plain language (no unexplained crate names, no cosine scores, no complexity notation)
- **PASS**: Response maps RuVector capabilities to clinical workflows (e.g., patient safety monitoring, clinical decision support)
- **PASS**: At least 3 distinct capability areas mentioned
- **FAIL**: Response is raw technical output, or contains no healthcare context
- **Regression source**: No existing approach has healthcare vertical content or non-technical adaptation

### 5.2 Cross-Query Pass Criteria

| Criterion | Required | Source ADR |
|-----------|----------|-----------|
| Average latency < 10ms (in-context, no external process) | Required | ADR-001, ADR-007 |
| Zero external process invocations for standard queries | Required | ADR-001 |
| Out-of-scope queries return explicit boundary signal | Required | ADR-003 |
| At least 1 industry vertical (healthcare) available | Required | ADR-004 |
| Non-technical adaptation available on demand | Required | ADR-005 |
| Swarm escalation triggers for meta/complex queries | Optional | ADR-006 |
| All problem-solution headers from V1 SKILL.md preserved | Required | ADR-002 |

### 5.3 Regression Prevention

Any change to the V3 SKILL.md or catalog data model MUST be re-tested against all 5 queries before merge. The test harness should:

1. Run each query through the V3 skill.
2. Assert the per-query pass criteria above.
3. Measure latency and assert < 10ms for CAG path.
4. Log results to `tests/benchmark-v3-report.md` in the same format as the V1/V2 reports.

---

## 6. Decision

The benchmark evidence supports the V3 architecture defined in ADR-001 through ADR-008. The key quantitative findings are:

1. **V2 TF-IDF search is not merely slow -- it is wrong.** In 4 out of 4 measured queries, the top result was irrelevant. The highest-confidence result across all queries (Q2, 0.38) was the most misleading.

2. **V1 grep succeeds only when queries align with hand-written section headers.** This works for Q1 and Q3 but fails for Q2, Q4, and Q5. The section headers themselves are valuable and must be preserved (ADR-002).

3. **Repo Search is the worst approach despite searching the most data.** More data does not help when there is no semantic understanding or ranking.

4. **No existing approach can handle scope boundaries, industry verticals, or non-technical adaptation.** These are not optimization problems -- they are missing capabilities that require architectural additions (ADR-003, ADR-004, ADR-005).

5. **CAG eliminates the latency-vs-quality tradeoff.** V2's sub-millisecond internal search (0.2ms) is negated by 27-179ms process overhead. CAG operates in the LLM's context window with zero external process cost.

The V3 predicted performance values in this ADR serve as the acceptance criteria for implementation. If V3 fails to meet them, the architecture must be revised before shipping.
