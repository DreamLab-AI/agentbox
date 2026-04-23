# ADR-006: Swarm-Escalated Deep Analysis

**Date**: 2026-03-28
**Status**: Proposed
**Deciders**: Mark Allen
**Related ADRs**: ADR-001, ADR-004, ADR-007

---

## Context

The V3 benchmark included a "hive mind" session that spawned 4 specialized agents (Healthcare Specialist, Scope Analyst, Cross-Domain Mapper, Synthesis Lead) to analyze the 5 benchmark queries. This session took 3-5 minutes and consumed approximately 50-100K tokens across all agents. The results were dramatically richer than any single-pass approach.

**Comparative quality across approaches**:

| Query | V1 (CAG, ~3K tokens) | V2 (RAG, ~1K tokens) | Hive Mind (4 agents, ~80K tokens) |
|-------|----------------------|----------------------|-----------------------------------|
| Q1: hallucination detection | A (5 crates) | B- (noisy matches) | A+ (5 crates + integration architecture) |
| Q2: out-of-scope books | D (false positives) | F (hash collision) | A (correctly identified out-of-scope) |
| Q3: database for mobile | B+ (2 matches) | C+ (1 match) | A (3 matches + deployment guidance) |
| Q4: bio-inspired edge | A- (cross-ref) | C (partial match) | A+ (full intersection + performance data) |
| Q5: healthcare non-technical | C (genomics only) | D- (wrong matches) | A+ (10 clinical use cases) |

The hive mind's Q5 response is the flagship example. The Healthcare Specialist agent:

1. Read ADR-028 (Drug Interaction Prediction) -- 400+ lines
2. Read rvDNA source code (`examples/dna/`) -- CYP2D6/CYP2C19 details
3. Read nervous-system documentation -- spiking network specs for real-time monitoring
4. Read SONA federated learning documentation -- multi-hospital compliance
5. Cross-referenced ruvector-graph's Cypher queries with clinical trial matching workflows

This produced a 10-capability clinical mapping with non-technical explanations and concrete use cases. No single-pass approach -- reading only SKILL.md -- could produce this depth because the required information spans ADRs, source code, example READMEs, and domain-specific documentation.

However, the hive mind's 3-5 minute latency and ~80K token cost makes it impractical for simple queries. Q1 ("hallucination detection") is perfectly answered by CAG in under a second. Running 4 agents for 3 minutes to produce a marginally better answer is wasteful.

## Decision

**V3 implements a 2-phase architecture for technology recommendations.**

### Phase 1: Instant CAG (Default)

Claude reads SKILL.md (including problem-solution headers, scope boundary, vertical quick-map). Returns section matches with technology recommendations. Latency: sub-second. Cost: ~3K tokens.

This handles the 80% case: queries that map cleanly to a section header or vertical quick-map entry.

### Phase 2: Swarm Deep Analysis (Triggered)

When Phase 1 is insufficient, a multi-agent swarm is spawned to perform deep analysis. The swarm reads ADRs, source code, example READMEs, and domain overlay files in parallel, then synthesizes results into a detailed RVBP (RuVector Booster Proposal).

**Trigger conditions** (any of):
1. **Explicit request**: User says "deeply analyze," "detailed proposal," "full RVBP," or "comprehensive assessment."
2. **Low confidence**: Claude determines that SKILL.md does not contain enough information to answer the query well. (This is a qualitative judgment, not a numeric threshold.)
3. **Multi-domain intersection**: The query spans 3+ capability domains and requires cross-referencing that exceeds what the section headers provide.
4. **Industry-specific depth**: The query requires domain expertise beyond what the vertical quick-map provides, and the domain overlay file (ADR-004) is insufficient.

**Swarm composition** (2-4 agents depending on query):

| Agent | Role | Reads |
|-------|------|-------|
| Domain Specialist | Maps technologies to domain-specific use cases | Domain overlay, relevant ADRs, example READMEs |
| Architecture Analyst | Evaluates integration patterns and deployment feasibility | Source code, dependency graphs, WASM crate listings |
| Cross-Domain Mapper | Finds non-obvious connections between capability domains | Full SKILL.md, catalog.json, multiple ADRs |
| Synthesis Lead | Combines agent outputs into a coherent RVBP | All agent outputs |

**Output format**: A structured RVBP document with:
- Problem statement (rephrased from user query)
- Recommended technologies with confidence levels
- Integration architecture (how the technologies fit together)
- Domain-specific use cases (from Domain Specialist)
- Deployment considerations (from Architecture Analyst)
- Non-obvious connections (from Cross-Domain Mapper)
- Risks and alternatives

### Escalation Protocol

```
User Query
    |
    v
Phase 1: Claude reads SKILL.md
    |
    ├── Match found, confidence high → Return recommendation (sub-second)
    |
    ├── Match found, needs depth → Claude reads domain overlay (ADR-004) → Return (1-2 seconds)
    |
    └── Low confidence / explicit request / multi-domain → Spawn Phase 2 swarm (30-90 seconds)
                                                              |
                                                              v
                                                        Return detailed RVBP
```

## Consequences

### Positive

- **Right-sized response for every query**: Simple queries get instant answers. Complex queries get deep analysis. No single approach is forced to handle both.
- **Preserves the hive mind's quality**: The A+ healthcare response is reproducible via the swarm path, not lost because "we chose CAG."
- **Cost-proportional**: ~3K tokens for simple queries, ~50-100K tokens for deep analysis. Users (and token budgets) only pay for depth when they need it.
- **Flywheel with domain overlays**: Swarm deep analysis results can be distilled back into domain overlay files (ADR-004), improving Phase 1 quality over time and reducing future swarm invocations.
- **Natural escalation UX**: Users can start with a quick recommendation and then say "tell me more" or "give me a detailed proposal" to trigger Phase 2. This matches how real consulting engagements work.

### Negative

- **Requires claude-flow swarm integration**: Phase 2 depends on the ability to spawn 2-4 specialized agents, coordinate their work, and synthesize results. This is infrastructure that must exist and be reliable.
- **30-90 second latency for Phase 2**: Users must wait. A progress indicator or streaming partial results would mitigate but not eliminate the wait.
- **Cost for Phase 2 is significant**: ~50-100K tokens per swarm analysis at Claude Opus 4.6 pricing. This is appropriate for high-value queries (enterprise evaluation, architecture decisions) but expensive for casual exploration.
- **Trigger heuristics are imperfect**: Claude's "low confidence" assessment is subjective. Some queries that deserve deep analysis might not trigger it; some simple queries might unnecessarily escalate.
- **Agent quality variance**: The swarm's output quality depends on the individual agents' instructions, which must be carefully authored and maintained.

### Neutral

- **Phase 2 is optional**: The catalog functions fully in Phase 1 mode. Phase 2 is an enhancement, not a dependency. If swarm infrastructure is unavailable, the catalog still provides A- quality via CAG.

## Alternatives Considered

### Alternative A: Always Use Swarm (Rejected)

Run the multi-agent analysis for every query.

**Why rejected**: 30-90 second latency for Q1 ("hallucination detection"), which CAG answers perfectly in sub-second, is an unacceptable degradation. Users asking simple questions would abandon the tool. The 80% case (simple query, section header match) does not benefit from swarm depth and should not pay the latency cost.

### Alternative B: Never Use Swarm (Rejected)

Rely entirely on CAG + domain overlays, no multi-agent escalation.

**Why rejected**: The healthcare example proves that some queries require depth that a single file cannot provide. The hive mind's A+ grade on Q5 required reading 15,000+ tokens of source material across ADRs, example code, and documentation. Pre-computing ALL of this into domain overlays is infeasible -- there are too many possible cross-domain intersections. The swarm handles the long tail of complex queries.

### Alternative C: User-Triggered Only (Considered)

Only run swarm analysis when the user explicitly requests it (no automatic escalation).

**Status**: Partially accepted. Explicit request is the primary trigger. Automatic escalation (low confidence, multi-domain intersection) is a secondary trigger that Claude applies with discretion. The decision errs on the side of Phase 1 -- escalation is opt-in by default.

## Evidence

### Token Cost Comparison

| Approach | Tokens Per Query | Quality (Avg) | Latency |
|----------|-----------------|---------------|---------|
| V1 CAG (SKILL.md only) | ~3,000 | A- | <1s |
| V2 RAG (CLI search) | ~1,000 | C- | ~2s |
| Hive Mind (4 agents) | ~80,000 | A+ | 3-5 min |
| V3 Phase 1 (CAG + overlays) | ~4,000-5,000 | A (projected) | 1-2s |
| V3 Phase 2 (swarm) | ~50,000-100,000 | A+ (projected) | 30-90s |

### Swarm Session Breakdown (Hive Mind Benchmark)

| Agent | Tokens Read | Tokens Generated | Key Contribution |
|-------|------------|-----------------|------------------|
| Healthcare Specialist | ~15,000 | ~2,000 | 10 clinical use cases |
| Scope Analyst | ~8,000 | ~500 | Out-of-scope identification for Q2 |
| Cross-Domain Mapper | ~12,000 | ~1,500 | Bio-inspired + WASM intersection for Q4 |
| Synthesis Lead | ~5,000 (agent outputs) | ~3,000 | Unified RVBP format |
| **Total** | **~40,000** | **~7,000** | |

Overhead (agent coordination, prompting): ~33,000 tokens. Total session: ~80,000 tokens.

## Notes

The swarm composition is not fixed. For a finance-specific deep analysis, the Domain Specialist would be configured with finance context rather than healthcare. The 4-agent template is a starting point; queries that span only 2 domains might use 2 agents.

The flywheel effect is the most important long-term consequence: every Phase 2 analysis that produces high-quality domain mappings should be reviewed and distilled into domain overlay files (ADR-004). Over time, the domain overlays get richer, and Phase 2 is triggered less frequently.
