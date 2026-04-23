# ADR-005: Non-Technical Response Adaptation

**Date**: 2026-03-28
**Status**: Proposed
**Deciders**: Mark Allen
**Related ADRs**: ADR-004, ADR-008

---

## Context

All three approaches tested in the V3 benchmark returned raw technical output for every query, regardless of the audience. This is a systemic failure for the catalog's intended user base, which includes non-technical decision-makers evaluating RuVector for their organization.

**Benchmark Q5**: "I work in healthcare and want to understand how RuVector could help with clinical applications. Explain at a non-technical level."

The query explicitly requests non-technical language. Results:

- **V1 (CAG)**: "examples/dna -- rvDNA: 20-SNP biomarker scoring, 23andMe genotyping, CYP2D6/CYP2C19 pharmacogenomics, streaming anomaly detection, 64-dim profile vectors." This is incomprehensible to a healthcare administrator. Grade: C.
- **V2 (RAG)**: Returned Continuous Batching, FlashAttention-3, and Mixed Curvature Attention with similarity scores. Grade: D-.
- **Hive Mind Healthcare Specialist**: "Drug Interaction Prediction -- Predicts how a patient's genetics affect drug metabolism, like a compatibility check before prescribing." This is exactly the right register. Grade: A+.

The hive mind agent succeeded because it was explicitly instructed to produce non-technical output. The V1 and V2 approaches have no such instruction. SKILL.md contains only technical descriptions, so Claude reproduces them verbatim.

This is not just a Q5 problem. Any stakeholder conversation ("explain to my CTO," "put this in the board deck," "what does this mean for our patients") requires response adaptation. The catalog should not force users to translate engineering jargon themselves.

## Decision

**V3 implements response adaptation through three mechanisms:**

### 1. Response Adaptation Directive in SKILL.md

A new section near the top of SKILL.md:

```markdown
## Response Adaptation

When audience markers are detected in the query, adapt response language:

| Marker | Response Style |
|--------|---------------|
| "non-technical", "plain English", "simple terms" | Lead with business value. Use analogies. No jargon. |
| "for my boss", "for leadership", "for the board" | Lead with ROI and competitive advantage. Quantify where possible. |
| "for developers", "technical details", "how does it work" | Full technical depth. Include API signatures and complexity. |
| "for my team", "explain to engineers" | Technical but contextualized. Include integration effort. |
| No marker detected | Default to technical with context (current V1 behavior). |
```

### 2. `plainDescription` Field on Technology Type

Each technology in catalog.json gets a new `plainDescription` field (ADR-008):

```json
{
  "name": "prime-radiant",
  "crate": "prime-radiant",
  "useWhen": "Verify coherence of AI outputs using sheaf cohomology",
  "plainDescription": "A fact-checking engine for AI. Catches contradictions, verifies consistency, and flags when an AI system is making things up."
}
```

The `useWhen` field retains its technical content. The `plainDescription` field provides a non-technical alternative. Claude selects which to use based on the detected audience.

### 3. Pre-Written Non-Technical Descriptions in Domain Overlays

Each domain overlay file (ADR-004) includes both technical and non-technical descriptions for every use case:

```markdown
### Drug Interaction Prediction
**Non-technical**: Predicts how a patient's genetics affect drug metabolism --
like a compatibility check before prescribing.
**Technical**: CYP2D6/CYP2C19 pharmacogenomic scoring combined with
graph-based drug interaction traversal using ruvector-graph's Cypher queries.
```

## Consequences

### Positive

- **Fixes the Q5 failure completely**: With `plainDescription` and the response adaptation directive, Claude has the raw material to produce non-technical responses without ad-hoc paraphrasing.
- **Consistent quality**: Pre-written plain descriptions ensure that non-technical explanations are carefully authored once, not improvised differently each time Claude responds. "A fact-checking engine for AI" is a better explanation than anything Claude would generate on the fly from "sheaf cohomology H^0 global sections."
- **Audience-aware by default**: The directive table makes audience detection explicit rather than hoping Claude infers it from context clues.
- **Low overhead**: The `plainDescription` field adds ~10-15 words per technology. At 80 technologies, this is ~800-1,200 additional words in catalog.json (~1,000 tokens). The response adaptation directive in SKILL.md is ~100 tokens.

### Negative

- **Requires authoring effort**: Each technology needs a `plainDescription`. For technologies like "Sheaf Attention -- algebraic topology, restriction maps, residual-sparse," writing a plain-English description requires understanding the technology well enough to simplify it. This is harder than it sounds.
- **Dual maintenance**: When a technology's capabilities change, both `useWhen` and `plainDescription` must be updated. Risk of drift between the two descriptions.
- **Over-simplification risk**: A `plainDescription` of "a fact-checking engine for AI" elides important nuances about prime-radiant's actual capabilities. A non-technical user might expect it to fact-check arbitrary claims against the internet, when it actually verifies internal consistency of AI reasoning chains.

### Neutral

- **Does not change default behavior**: When no audience marker is detected, Claude defaults to technical descriptions (current V1 behavior). Existing technical users see no change.

## Alternatives Considered

### Alternative A: Always Use Technical Language (Rejected)

Keep the current behavior. Let users ask follow-up questions if they need simplification.

**Why rejected**: Fails Q5 entirely. A healthcare administrator asking "how can RuVector help with clinical applications" at a "non-technical level" and receiving "CYP2D6/CYP2C19 pharmacogenomics, streaming anomaly detection, 64-dim profile vectors" will not ask a follow-up question. They will leave the conversation concluding that RuVector is not relevant to their work.

### Alternative B: Dual SKILL.md Versions (Rejected)

Maintain two SKILL.md files: `SKILL-technical.md` and `SKILL-plain.md`. Load the appropriate one based on detected audience.

**Why rejected**: Doubles maintenance burden. Every technology addition or description change must be applied to both files. The `plainDescription` field approach keeps both descriptions in the same record, ensuring they are updated together.

### Alternative C: Let Claude Paraphrase on the Fly (Rejected as Primary Approach)

Rely on Claude's ability to simplify technical language without pre-written plain descriptions.

**Why rejected as primary**: Claude CAN simplify, but the quality varies. "Sheaf cohomology H^0 global sections" might be paraphrased as "a mathematical verification technique" (too vague) or "algebraic topology applied to knowledge graphs" (still jargon). Pre-written `plainDescription` values ensure consistent, tested, audience-appropriate language. Claude's paraphrasing ability is a fallback for technologies that lack a `plainDescription`, not the primary mechanism.

## Evidence

### Response Quality by Audience Adaptation Method

| Method | Q5 Grade | Consistency | Maintenance Cost |
|--------|----------|-------------|------------------|
| No adaptation (V1/V2) | C / D- | N/A | Zero |
| Claude ad-hoc paraphrasing | B- (variable) | Low | Zero |
| Pre-written plainDescription | A- | High | Medium |
| Domain overlay + plainDescription | A+ (hive mind quality) | High | Medium-High |

### Non-Technical Description Examples

| Technology | Technical (useWhen) | Plain (plainDescription) |
|------------|-------------------|--------------------------|
| prime-radiant | Verify coherence of AI outputs using sheaf cohomology | A fact-checking engine for AI -- catches contradictions and flags when an AI is making things up |
| SONA | Adaptive learning with 3-loop MicroLoRA/LoRA/EWC++ | A system that gets smarter the more you use it -- learns from every interaction and remembers what works |
| ruvector-core HNSW | Sub-millisecond nearest-neighbor search O(log n) | Finds the most similar items in a collection of millions, in under a millisecond -- like a librarian who instantly knows which books are most relevant |
| rvDNA | 20-SNP biomarker scoring, CYP2D6/CYP2C19 pharmacogenomics | Analyzes genetic data to predict how patients will respond to medications -- personalized medicine at the DNA level |

## Notes

The `plainDescription` field is the minimum viable implementation. For V3.1+, consider adding `audienceDescriptions` as a map:

```json
{
  "executive": "Reduces AI errors by 40% through mathematical verification",
  "clinical": "Catches when AI clinical decision support contradicts itself",
  "developer": "Sheaf cohomology H^0 global sections with GNN learned restriction maps"
}
```

This level of audience granularity is not needed for V3 but is a natural extension of the architecture.
