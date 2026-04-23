# RVBP: RuVector Catalog V3 — Research Proposal

**Date**: 2026-03-29
**Authors**: Byzantine Consensus Hive Mind (Architecture Agent, V1 Analyst, V2 Analyst, Healthcare Specialist)
**Status**: Research Proposal (do not implement)
**Supersedes**: V1 (grep-based SKILL.md), V2 (TF-IDF semantic search CLI)

---

## Executive Summary

V3 combines V1's winning architecture (human-curated problem-solution map in a single context-window-sized file) with V2's strengths (ranked output, programmatic API, RVBP generation) while eliminating both systems' failures. The core insight from benchmarking: **for a catalog of 200 technologies consumed by an LLM, the best retrieval engine is the LLM itself, operating on a well-structured document.** V3 optimizes the document, not the search engine.

### Target: Beat V1 on All 5 Benchmarks

| Query | V1 Grade | V3 Target | How |
|-------|----------|-----------|-----|
| Q1: Hallucination detection | A | A+ | Preserve section headers + add ranking |
| Q2: Draft books from idea | C (noisy false positives) | A | Explicit "not in scope" section |
| Q3: Monitor user actions | A (found OSpipe) | A+ | Synonym-rich headers + SONA mapping |
| Q4: Improve the catalog | B (84% noise) | A | Dedicated meta-query section |
| Q5: Healthcare capabilities | C (genomics only) | A | Industry vertical overlays + non-technical mode |

---

## 1. Why V1 Wins (Consensus Finding)

All 4 agents converged on the same conclusion:

**V1's SKILL.md is a manually curated inverted index disguised as a markdown file.** Its 17 problem-solution section headers (e.g., "I need to verify AI outputs / prevent hallucination / detect drift") are pre-computed queries mapped to pre-ranked answer sets. When a user's query aligns with a header, retrieval precision is near-perfect.

### V1's Structural Primitives (must preserve in V3)

| Primitive | Size | Function |
|-----------|------|----------|
| 17 problem-solution headers | ~500 bytes | Intent-based retrieval anchors |
| ~200 named technologies with crate mappings | ~15KB | Actionable recommendations |
| ~97 explicitly named algorithms | ~2KB | Activation triggers + disambiguation |
| 44 named examples with parenthetical descriptions | ~2KB | Proof of integration + use-case mapping |
| 4-level progressive depth (L1→L2→L3→L4) | 22KB→2000 lines→1.58M lines | Context-window-optimized funnel |
| Inline performance metrics (61μs, <1ms, 11.8KB) | Embedded | Credibility + decision support |

### V1's Measured Strengths

- **Q1 (hallucination)**: Exact section header match → 5 highly relevant crates in 5 lines
- **Q3 (monitoring)**: OSpipe found via ScreenPipe section header
- **Latency**: 44ms average (grep on 40KB)
- **Zero dependencies**: No runtime, no build step, no node_modules

### V1's Measured Weaknesses

- **Q2 (books)**: 5 false-positive lines, no "out of scope" signal
- **Q4 (catalog)**: 44 lines matched, 84-89% noise rate — no ranking
- **Q5 (healthcare)**: Found only genomics line (185), missed ADR-028 eHealth architecture, nervous system for vitals, graph DB for drug interactions, SONA for outcome learning
- **No ranking**: All grep matches have equal weight
- **No semantic bridging**: "efficiency improvements" does not match "models that improve with use" (SONA)

---

## 2. Why V2 Loses (Consensus Finding)

### Root Cause: TF-IDF in 128-Dimensional Feature-Hashed Space

All agents identified the same technical failure chain:

1. **128-dim feature hashing** collapses 2,000+ vocabulary terms into 128 buckets (~15 terms/bucket average), creating uncontrolled hash collisions
2. **Cosine similarity between near-random vectors** produces scores of 0.20-0.40 for completely unrelated concepts (Auto-Sharding scored 0.28 for "hallucination detection")
3. **No out-of-scope detection** — always returns 5 results with positive scores, even for "draft books" (outside RuVector's domain entirely)
4. **Flat field concatenation** gives `status: "production"` equal weight to `capability: "hallucination detection"`
5. **Examples not indexed** — OSpipe (the only monitoring technology) exists as a `CatalogExample`, not a `Technology`, and is invisible to search

### V2's Specific Failures (from actual benchmark data)

| Query | V2 Top Result | Correct Answer | Failure Mode |
|-------|--------------|----------------|--------------|
| Q1: Hallucinations | CUSUM Drift (0.32) | prime-radiant | Token overlap bias ("detecting" matched literally) |
| Q2: Draft books | Min-Cut Attention (0.38) | OUT OF SCOPE | Hash collision noise, no scope guard |
| Q3: User monitoring | RVF Containers (0.40) | OSpipe | Examples not indexed; document length bias |
| Q4: Improve catalog | RVF Containers (0.35) | SONA, HNSW | Generic descriptions match everything |
| Q5: Healthcare | Continuous Batching (0.32) | prime-radiant, rvDNA, graph | Zero healthcare mapping in data model |

### V2's Strengths (preserve in V3)

- CLI interface: sub-second, scriptable (`search`, `rvbp` commands)
- RVBP proposal generation: well-structured blueprints with integration plans
- Ranked output with scores (when scoring works)
- Clean TypeScript data model (`Technology`, `Capability`, `Algorithm` types)
- Pure TypeScript HNSW implementation (correct algorithm, wrong vectors)
- Keyword search fallback with weighted fields

---

## 3. V3 Architecture

### 3.1 Design Principle

> **The LLM is the search engine. The document is the index.**

V3's primary interface is an enhanced SKILL.md loaded into Claude's context window. Claude's language understanding is vastly superior to any 128-dim TF-IDF vector. V3 optimizes the document structure so Claude can reason about it effectively.

The CLI exists as a secondary interface for programmatic/CI use, with a properly functioning search engine (not TF-IDF).

### 3.2 File Structure

```
ruvector-catalog-v3/
├── SKILL.md                          # PRIMARY: 25-30KB, Claude-readable
│   ├── [Frontmatter: activation keywords]
│   ├── [Problem-Solution Map: 20+ sections]
│   ├── [Industry Verticals: healthcare, finance, robotics, edge]
│   ├── [What RuVector Does NOT Do]
│   ├── [Named Algorithms: ~100]
│   ├── [Named Examples: 44+]
│   ├── [Meta: How to Use This Catalog]
│   └── [Freshness: version, commit, scope stats]
│
├── catalog.json                      # SECONDARY: Structured data (source of truth)
│   ├── capabilities[] with technologies[]
│   ├── examples[] (NOW INDEXED)
│   ├── industry_verticals{}
│   └── out_of_scope[]
│
├── domains/                          # Industry vertical overlays
│   ├── healthcare.md                 # Non-technical healthcare mappings
│   ├── finance.md                    # Trading, compliance, risk
│   ├── robotics.md                   # ROS3, perception, planning
│   ├── genomics.md                   # Sequencing, pharma, biomarkers
│   └── edge-iot.md                   # WASM, constrained devices
│
├── docs/                             # Level 2: per-capability deep docs
│   ├── vector_search.md
│   ├── coherence_safety.md
│   ├── ... (16 capability docs)
│   └── adr/                          # Catalog-specific ADRs
│
├── src/                              # CLI (secondary interface)
│   ├── search.ts                     # Fixed: 384+ dim embeddings, field weighting
│   ├── generator.ts                  # RVBP generation (preserved from V2)
│   ├── intent.ts                     # NEW: Intent classifier + scope guard
│   └── vertical.ts                   # NEW: Industry vertical resolver
│
├── scripts/
│   ├── generate-skill.ts             # Auto-generate SKILL.md from catalog.json
│   └── update-submodule.sh
│
├── tests/
│   ├── benchmark-q1-hallucination.ts
│   ├── benchmark-q2-books.ts
│   ├── benchmark-q3-monitoring.ts
│   ├── benchmark-q4-self-improve.ts
│   ├── benchmark-q5-healthcare.ts
│   └── regression.ts                 # Ensures V3 beats V1 on all 5
│
└── templates/
    ├── rvbp-template.md
    └── non-technical-template.md     # NEW: Plain-language response format
```

### 3.3 SKILL.md Enhancements Over V1

#### A. Expanded Problem-Solution Map (20+ sections, synonym-rich headers)

V1's 17 headers are preserved and enhanced with synonym variants:

```markdown
### "I need to verify AI outputs / prevent hallucination / detect drift / ensure consistency / catch contradictions"
```

New sections added:

```markdown
### "I need to monitor, record, or analyze what happens on a user's screen / track desktop activity / observe user behavior"
→ OSpipe (ScreenPipe integration), SONA (learn from patterns), ruvector-nervous-system (event processing)

### "I need to improve this catalog / the technology recommender itself"
→ SONA (self-learning), ruvector-core HNSW (better embeddings), Matryoshka (adaptive precision), ReasoningBank (pattern learning)
```

#### B. Explicit Scope Boundary ("What RuVector Does NOT Do")

```markdown
## What RuVector Does NOT Do

RuVector is infrastructure for AI/ML systems. It does NOT provide:
- Content generation (writing, art, music, video production, book drafting)
- End-user applications (CMS, CRM, e-commerce, social media)
- General-purpose web development (frontend frameworks, CSS, routing)
- Database administration tools (backup GUIs, migration wizards)
- Cloud provider services (hosting, DNS, CDN, email)

If your task is primarily about generating content or building a consumer application,
RuVector may provide supporting infrastructure (search, learning, safety) but is not
the primary tool. Consider pairing RuVector with an LLM API for generation tasks.
```

This directly solves Q2 ("draft books") — Claude reads this section and correctly responds: "Book drafting is content generation, which is outside RuVector's scope. However, RuVector could provide supporting infrastructure: SONA for learning from reader feedback, vector search for research retrieval, and coherence checking for factual consistency."

#### C. Industry Vertical Quick-Maps

```markdown
## Industry Applications

### Healthcare
**Patient Safety**: prime-radiant (catches contradictions before they reach clinicians)
**Clinical Search**: ruvector-core Hybrid Search (find similar cases by meaning, not just codes)
**Drug Interactions**: ruvector-graph (model medication-diagnosis relationships)
**Genomics**: rvDNA example (pharmacogenomics, CYP2D6 dosing, 12ms analysis)
**Vital Monitoring**: ruvector-nervous-system (spiking neurons for ICU streams)
**HIPAA Compliance**: rvf-federation (PII stripping), Blake3 witness chains (audit trail)
**Outcome Learning**: SONA (improves from actual patient outcomes via federated learning)
**Architecture Reference**: ADR-028-ehealth-platform-architecture (50M patient, sub-100ms search)

### Finance
**Trading Signals**: neural-trader-core + neural-trader-coherence (coherence-gated strategies)
**Fraud Detection**: ruvector-graph PageRank + Louvain (unusual billing clusters)
**Compliance Audit**: prime-radiant witness chains (immutable decision records)
**Market Regime Detection**: CUSUM drift (distribution change detection)

### Robotics
**Perception**: ruvector-cnn (image embeddings), ruvector-attention (scene attention)
**Planning**: ruvector-dag (causal inference), ruvector-solver (optimization)
**Safety**: ruvector-verified (formal verification), prime-radiant (coherence gating)
**Framework**: agentic-robotics-* (ROS3, Zenoh, RTIC+Embassy for embedded)
```

This directly solves Q5 — Claude reads the Healthcare section and produces a comprehensive, domain-specific response.

#### D. Non-Technical Response Mode

SKILL.md includes a directive:

```markdown
## Response Adaptation

When the user asks for non-technical explanations, plain-language descriptions,
or explanations for leadership/executives/non-engineers:

1. Read the relevant `domains/<vertical>.md` file for pre-written plain-language descriptions
2. Lead with business value, not technical specifications
3. Use analogies (e.g., "coherence checking works like a pharmacist double-checking prescriptions")
4. Include concrete use cases with patient/user impact
5. Cite performance numbers in human terms ("searches 50 million records in under a tenth of a second")
```

The `domains/healthcare.md` file contains the full non-technical healthcare response (as drafted by the Healthcare Specialist agent), ready for Claude to use verbatim or adapt.

### 3.4 CLI Search Fixes (Secondary Interface)

For programmatic use, V3 fixes V2's search engine:

| V2 Problem | V3 Fix | Impact |
|------------|--------|--------|
| 128-dim feature hashing | Sparse TF-IDF (full vocabulary, no hashing) OR pre-computed 384-dim neural embeddings | Eliminates hash collision noise |
| Flat field concatenation | Weighted fields: `useWhen` x3, `keywords` x2, `name` x1, `status` x0 | Boosts discriminative fields |
| Examples not indexed | Index `CatalogExample` entries alongside `Technology` entries | OSpipe becomes discoverable |
| No out-of-scope detection | Score threshold (0.25 minimum) + domain routing | Q2 returns "out of scope" |
| No intent classification | `intent.ts`: classify query → problem-section, technology-lookup, or out-of-scope | Routes queries to best retrieval path |
| No use-case context | Add `useCases: string[]` field to Technology type | Direct term overlap for natural queries |
| No query expansion | Synonym map: "hallucination"→["drift","coherence","safety","verification"] | Bridges vocabulary gaps |
| No re-ranking | Post-retrieval re-rank: boost primaryCrate, capability keyword overlap, production status | Corrects initial retrieval errors |

### 3.5 Data Model Enhancements

```typescript
interface TechnologyV3 extends Technology {
  // NEW: Natural-language use case scenarios
  useCases: string[];           // ["detect hallucinations in LLM output", "verify clinical recommendations"]

  // NEW: Problem domains this technology addresses
  problemDomains: string[];     // ["healthcare AI safety", "financial compliance"]

  // NEW: Industry vertical applicability
  verticals: string[];          // ["healthcare", "finance", "robotics"]

  // NEW: Plain-language description for non-technical audiences
  plainDescription?: string;    // "Catches contradictions before they reach users"

  // NEW: Related examples
  relatedExamples: string[];    // ["OSpipe", "neural-trader"]
}

interface CatalogV3 extends CatalogStoreData {
  // NEW: Explicit scope boundaries
  outOfScope: string[];         // ["content generation", "web development", ...]

  // NEW: Industry vertical mappings
  verticals: Record<string, VerticalMapping>;

  // NEW: Problem-solution index (the section headers, machine-readable)
  problemSolutionMap: ProblemSection[];
}

interface ProblemSection {
  header: string;               // "I need to verify AI outputs / prevent hallucination"
  synonyms: string[];           // ["catch contradictions", "ensure consistency", "check for errors"]
  technologies: string[];       // ["prime-radiant", "cognitum-gate-kernel", ...]
  primaryCrate: string;         // "prime-radiant"
}
```

---

## 4. Predicted V3 Benchmark Results

### Q1: "detecting hallucinations in LLM output before it reaches users"

**V3 (SKILL.md path)**: Claude reads the Problem-Solution Map, finds the section "I need to verify AI outputs / prevent hallucination / detect drift / ensure consistency / catch contradictions." Returns: prime-radiant (primary), cognitum-gate-kernel, cognitum-gate-tilezero, ruvector-coherence, mcp-gate. **Grade: A+**

**V3 (CLI path)**: Intent classifier routes to `coherence_safety` domain. Sparse TF-IDF with use-case fields matches "hallucination detection" to prime-radiant (useCases includes "detect hallucinations in LLM output"). Re-ranker boosts prime-radiant as primaryCrate. **Grade: A**

### Q2: "draft best selling books from an idea using AI"

**V3 (SKILL.md path)**: Claude reads the "What RuVector Does NOT Do" section, finds "Content generation (writing, art, music, video production, book drafting)." Responds: "Book drafting is outside RuVector's scope. However, RuVector can provide supporting infrastructure: SONA for learning from reader engagement, Hybrid Search for research retrieval, and the coherence engine for factual consistency checking." **Grade: A** (correct scope identification + helpful alternative framing)

**V3 (CLI path)**: Intent classifier scores below 0.25 threshold. Domain routing finds no matching domain. Returns: "No technologies matched. This query appears to be outside RuVector's scope (content generation). RuVector provides infrastructure for: [16 capability domains listed]." **Grade: A-**

### Q3: "monitor all user actions on a computer and suggest efficiency improvements"

**V3 (SKILL.md path)**: Claude finds the enhanced section "I need to monitor, record, or analyze what happens on a user's screen / track desktop activity / observe user behavior." Returns: OSpipe (primary, with ScreenPipe integration details), SONA (for learning from usage patterns), ruvector-nervous-system (event-driven processing). **Grade: A+**

**V3 (CLI path)**: OSpipe now indexed as a technology (not just an example). useCases includes "monitor desktop activity", "track user behavior." Scores high. SONA surfaces via query expansion ("efficiency improvements" → "improve from experience"). **Grade: A**

### Q4: "improve the ruvector-catalog skill and technology recommender"

**V3 (SKILL.md path)**: Claude finds the new dedicated section "I need to improve this catalog / the technology recommender itself." Returns: SONA (self-learning), ruvector-core HNSW (better embeddings), Matryoshka Embeddings (adaptive precision), ReasoningBank (pattern learning), mcp-brain (knowledge sharing). **Grade: A**

**V3 (CLI path)**: Intent classifier identifies as meta-query. Routes to technologies tagged with problemDomain "search and recommendation." Returns ranked list led by SONA and HNSW. **Grade: A-**

### Q5: "explain at non-technical level what capabilities could add value to a clinical healthcare solution"

**V3 (SKILL.md path)**: Claude detects "non-technical level" and "clinical healthcare." Reads the Healthcare industry vertical section in SKILL.md, then reads `domains/healthcare.md` for pre-written plain-language descriptions. Produces a response covering: patient safety (coherence engine), clinical search (hybrid search), drug interactions (graph DB), genomics (rvDNA pharmacogenomics), vital monitoring (nervous system), HIPAA compliance (RVF federation + witness chains), outcome learning (SONA), audit trail (proof-gated mutations). References ADR-028 for architectural detail. **Grade: A+**

**V3 (CLI path)**: Domain routing activates healthcare vertical. Returns technologies tagged `verticals: ["healthcare"]` with `plainDescription` fields. Non-technical template formats output. **Grade: A**

### Summary: V3 vs V1 vs V2 (Predicted)

| Query | V1 (actual) | V2 (actual) | V3 (predicted) |
|-------|-------------|-------------|----------------|
| Q1: Hallucinations | A | B- | **A+** |
| Q2: Book drafting | C | D | **A** |
| Q3: User monitoring | A | D | **A+** |
| Q4: Self-improvement | B | B | **A** |
| Q5: Healthcare | C | D- | **A+** |
| **Average** | **B** | **C-** | **A** |

---

## 5. Implementation Priorities

| Priority | Task | Effort | Impact |
|----------|------|--------|--------|
| **P0** | Write V3 SKILL.md with expanded headers, scope boundary, verticals | 1 day | Solves Q2, Q5, improves Q3/Q4 |
| **P0** | Write `domains/healthcare.md` with non-technical descriptions | 1 day | Solves Q5 completely |
| **P1** | Enhance catalog.json with useCases, verticals, plainDescription fields | 2 days | Enables CLI fixes |
| **P1** | Index examples alongside technologies in search | 0.5 day | Solves Q3 for CLI path |
| **P1** | Add `generate-skill.ts` to auto-generate SKILL.md from catalog.json | 1 day | Ensures consistency |
| **P2** | Replace TF-IDF with sparse vectors or 384-dim neural embeddings | 2 days | Eliminates hash collision noise |
| **P2** | Add intent classifier + scope guard to CLI | 1 day | Prevents out-of-scope hallucinations |
| **P2** | Write finance, robotics, edge-iot vertical overlays | 2 days | Extends vertical coverage |
| **P3** | Add benchmark regression tests (must beat V1 on all 5) | 1 day | Prevents quality regression |
| **P3** | Field-weighted embedding + re-ranking pass | 1 day | Fine-tunes CLI ranking |

**Total estimated effort**: 10-12 days for full V3 implementation.
**P0 alone (SKILL.md + healthcare overlay)**: 2 days, delivers most of the quality improvement.

---

## 6. Key Architectural Decisions

### Decision 1: SKILL.md remains the primary interface

**Rationale**: The benchmarks prove that Claude reading a 25KB structured document outperforms any programmatic search engine we can build at this scale. The LLM IS the retrieval engine. Our job is to give it the best possible document to reason over.

### Decision 2: Problem-solution headers are hand-curated, not generated

**Rationale**: The headers' effectiveness comes from being written in the user's natural voice. Auto-generated headers would lose this quality. catalog.json generates the technology details beneath each header; the headers themselves require human authorship.

### Decision 3: Industry verticals are separate overlay files, not inline

**Rationale**: Healthcare alone requires 2-3KB of non-technical descriptions. Inlining all verticals would bloat SKILL.md beyond the 30KB target. Claude reads the vertical file on-demand when an industry query is detected.

### Decision 4: CLI uses sparse TF-IDF (no feature hashing), not neural embeddings

**Rationale**: The corpus is small (~80 technologies). Sparse vectors in full vocabulary space are sufficient and require no model dependencies. Neural embeddings are better but add a runtime dependency (ONNX or @xenova/transformers). Sparse TF-IDF with proper field weighting is the pragmatic choice for V3; neural can follow in V3.1.

### Decision 5: Out-of-scope is explicit, not inferred

**Rationale**: A hand-written "What RuVector Does NOT Do" section is cheap to maintain, easy for Claude to interpret, and eliminates an entire class of errors (Q2). Inference-based scope detection is harder to get right and harder to debug when wrong.

---

## 7. Risks

| Risk | Mitigation |
|------|------------|
| SKILL.md exceeds 30KB, degrading LLM attention | Auto-generate from catalog.json with strict size budgets per section |
| Hand-curated headers become stale as capabilities evolve | `generate-skill.ts` validates headers against catalog.json; flags orphaned headers |
| Industry vertical files are accessed but user's actual vertical isn't covered | Include a "General AI/ML Infrastructure" catch-all that maps to core capabilities |
| CLI sparse TF-IDF still produces poor results on edge cases | The CLI is secondary; SKILL.md is primary. CLI quality is nice-to-have, not critical. |
| Benchmark regression — V3 update accidentally breaks a query | Automated regression tests (5 queries, must match or beat V1 grades) run on every change |

---

## 8. Consensus Statement

This proposal was produced by 4 independent agents using byzantine consensus:

- **Architecture Agent**: Identified "the LLM is the search engine" as the core V3 principle. Specified multi-stage retrieval with intent classification. Recommended context-window-primary, CLI-secondary architecture.
- **V1 Analyst**: Inventoried V1's 17 section headers, ~97 algorithms, 44 examples, 4-level depth. Identified section headers as "pre-computed queries." Specified what V3 must preserve.
- **V2 Analyst**: Dissected TF-IDF embedder failure chain (128-dim hashing → collisions → noise). Identified 8 specific fixes with priority ordering. Confirmed V2's data model and CLI are worth preserving.
- **Healthcare Specialist**: Mapped 10 RuVector technologies to clinical use cases. Drafted the non-technical healthcare response V3 should produce. Graded all 3 approaches on Q5 (V1: C, V2: D-, Repo: C+). Specified industry vertical overlay architecture.

**All 4 agents agree**: V3's primary interface must be an enhanced SKILL.md, not a search engine. The document structure IS the retrieval strategy. The CLI is a secondary interface that benefits from proper engineering but is not the primary quality driver.

---

*Generated by hive mind with byzantine consensus — 2026-03-29*
*Research only. Do not implement without review.*
