# ADR-004: Industry Vertical Overlays

**Date**: 2026-03-28
**Status**: Proposed
**Deciders**: Mark Allen
**Related ADRs**: ADR-001, ADR-005, ADR-006, ADR-008

---

## Context

RuVector's 200+ technologies are described in engineering terms (crate names, algorithm complexities, API signatures). When a user asks about a specific industry application, there is a semantic gap between the engineering description and the domain-specific need.

**Benchmark Q5**: "I work in healthcare and want to understand how RuVector could help with clinical applications. Explain at a non-technical level."

- **V1 (CAG)**: Found the single line under "Specialized Domains > Genomics" mentioning rvDNA (20-SNP biomarker scoring, 23andMe genotyping, CYP2D6/CYP2C19 pharmacogenomics). Returned raw technical output. Grade: C.
- **V2 (RAG)**: Returned Continuous Batching (0.41 similarity) as the top match. The embedder matched "clinical" to "batch" via hash collision. Grade: D-.
- **Hive Mind Healthcare Specialist Agent**: Read ADR-028 (Drug Interaction Prediction), rvDNA source code, and nervous-system documentation. Produced a 10-capability clinical mapping:
  1. Drug interaction prediction (rvDNA CYP2D6/CYP2C19 + ruvector-graph)
  2. Patient similarity search (ruvector-core HNSW + ruvector-filter)
  3. Clinical decision support (prime-radiant coherence gate)
  4. Genomic variant analysis (rvDNA 64-dim profile vectors)
  5. Medical image analysis (ruvector-cnn)
  6. Clinical trial matching (ruvector-graph + ruvector-core)
  7. Adverse event detection (ruvector-delta-core behavioral change tracking)
  8. Treatment pathway optimization (ruvector-mincut graph partitioning)
  9. Real-time patient monitoring (ruvector-nervous-system spiking networks)
  10. Federated learning for multi-hospital data (SONA federated learning)

  Grade: A+. Each mapping included a non-technical explanation and concrete clinical use case.

The gap between V1's C and the hive mind's A+ is not a search problem -- it is a knowledge problem. The hive mind agent had domain expertise that allowed it to map engineering capabilities to clinical workflows. This knowledge must be pre-computed and available to the primary CAG path without requiring a 3-5 minute multi-agent session.

## Decision

**V3 includes a `domains/` directory with per-vertical overlay files. SKILL.md includes a quick-reference map per vertical. Claude reads detailed overlay files on demand.**

The structure:

```
ruvector-catalog-v3/
  SKILL.md                      # Primary file -- includes vertical quick-map
  domains/
    healthcare.md               # 10+ clinical use cases with technology mappings
    finance.md                  # Trading, risk, compliance use cases
    robotics.md                 # Perception, control, SLAM use cases
    edge-iot.md                 # Constrained devices, WASM, real-time use cases
    genomics.md                 # Sequencing, pharmacogenomics, biomarker use cases
```

### SKILL.md Quick-Map Format

Inside SKILL.md, a new section:

```markdown
## Industry Verticals (Quick Map)

### Healthcare
rvDNA (pharmacogenomics), prime-radiant (clinical decision support), ruvector-core (patient similarity),
ruvector-cnn (medical imaging), ruvector-graph (drug interactions), SONA (federated multi-hospital learning)
> For detailed clinical use cases: read domains/healthcare.md

### Finance
neural-trader-* (market events, coherence-gated trading), ruvector-graph (risk networks),
prime-radiant (trade verification), ruvector-delta-* (real-time behavioral change detection)
> For detailed financial use cases: read domains/finance.md
```

### Overlay File Format

Each domain overlay file (~2-4KB) follows a standard structure:

```markdown
# Healthcare Applications

## Clinical Use Cases

### 1. Drug Interaction Prediction
**Technologies**: rvDNA (CYP2D6/CYP2C19 metabolism), ruvector-graph (interaction networks)
**Non-technical**: Predicts how a patient's genetics affect drug metabolism -- like a compatibility check before prescribing.
**Technical**: CYP2D6/CYP2C19 pharmacogenomic scoring combined with graph-based drug interaction traversal.
**Evidence**: ADR-028, rvDNA source code (examples/dna)
```

Each use case includes both a non-technical and technical description (see ADR-005).

## Consequences

### Positive

- **Bridges the engineering-to-domain semantic gap**: A healthcare user asking about "clinical decision support" will find it in the quick-map without needing to know that it maps to prime-radiant's sheaf cohomology.
- **Pre-computed expertise**: The hive mind's A+ healthcare mapping took 3-5 minutes of multi-agent deliberation. Pre-computing this in a 3KB file makes it available instantly via CAG.
- **Modular growth**: New verticals can be added as individual files without modifying SKILL.md's core structure. The quick-map section adds ~50 tokens per vertical.
- **Demand-driven loading**: Claude reads the quick-map (in SKILL.md, always loaded) and only reads the full overlay file when the conversation requires depth. A finance question never loads healthcare.md.

### Negative

- **Each vertical requires domain-expert authoring**: The healthcare overlay cannot be auto-generated from technology descriptions -- it requires someone who understands clinical workflows to map "sheaf cohomology" to "clinical decision support." This is the same quality of work the hive mind's Healthcare Specialist agent performed, but done once and stored.
- **Maintenance burden**: When RuVector adds a new crate relevant to healthcare (e.g., a medical imaging pipeline), the healthcare overlay must be updated. This is manual unless a regeneration pipeline detects domain-relevant changes.
- **Incomplete coverage**: The initial set covers 4-5 verticals. Users in unlisted verticals (education, legal, manufacturing) get no domain-specific mapping and fall back to the generic Problem-Solution Map.
- **Context budget for overlays**: Each overlay file is 2-4KB (~500-1,000 tokens). Loading one overlay is cheap. Loading all 5 simultaneously would add ~5,000 tokens, which is still within budget but not free.

### Neutral

- **Overlay quality varies**: Some verticals have rich RuVector support (healthcare has rvDNA, neural-trader covers finance). Others will be thinner (edge-iot is mostly a WASM deployment story). This is acceptable -- the overlay should honestly reflect what RuVector offers, not stretch capabilities to fill a template.

## Alternatives Considered

### Alternative A: Inline All Verticals in SKILL.md (Rejected)

Add all vertical mappings directly to SKILL.md.

**Why rejected**: At ~500-1,000 tokens per vertical, 5 verticals would add 2,500-5,000 tokens to SKILL.md, pushing it from ~7,500 to ~12,500 tokens. This exceeds the 30KB budget and bloats the primary file with domain-specific content that most conversations will not need. The quick-map (50 tokens per vertical) provides a signal; the overlay provides depth on demand.

### Alternative B: Generate Verticals Dynamically from catalog.json (Rejected)

Auto-generate domain overlay files by matching technology descriptions against industry keyword lists.

**Why rejected**: The healthcare overlay's value comes from domain expertise, not keyword matching. Auto-generation would produce "rvDNA: Contains pharmacogenomics keywords, likely relevant to healthcare" instead of "Drug Interaction Prediction: Predicts how a patient's genetics affect drug metabolism." The former is what V2's TF-IDF already does (and it scored D-). The latter is the hive mind's contribution.

### Alternative C: Hive Mind On-Demand for Every Vertical Query (Rejected for Primary Path, Preserved in ADR-006)

Spawn a domain-specialist agent whenever a vertical question is asked.

**Why rejected for primary path**: 30-60 second latency for a question that could be answered instantly from a pre-computed file. The hive mind approach IS the authoring tool -- it generates the overlay files. But serving pre-computed overlays is strictly faster and cheaper than re-deriving them each time.

**Preserved**: ADR-006 describes swarm-escalated deep analysis for questions that go beyond what the overlay covers. The overlay handles the 80% case; the swarm handles the 20%.

## Evidence

### Hive Mind Healthcare Session Analysis

The Healthcare Specialist agent produced its 10-capability mapping by:

1. Reading ADR-028 (Drug Interaction Prediction) -- 400+ lines of detailed architecture
2. Reading rvDNA source code (`examples/dna/`) -- CYP2D6/CYP2C19 pharmacogenomic scoring
3. Reading nervous-system documentation -- spiking networks for real-time monitoring
4. Reading prime-radiant documentation -- sheaf cohomology mapped to clinical decision support
5. Cross-referencing SONA's federated learning with HIPAA compliance requirements

Total reading: ~15,000 tokens of source material. Total output: ~2,000 tokens of domain-mapped recommendations.

This 7.5x compression ratio (15,000 input tokens to 2,000 output tokens) is exactly what the overlay file captures. The overlay IS the compressed domain expertise.

### Vertical Coverage Assessment

| Vertical | RuVector Depth | Key Technologies | Overlay Richness |
|----------|---------------|-----------------|------------------|
| Healthcare | Deep | rvDNA, prime-radiant, ruvector-cnn, SONA, ruvector-graph | 10+ use cases |
| Finance | Deep | neural-trader-*, ruvector-delta-*, prime-radiant | 8+ use cases |
| Robotics | Medium | agentic-robotics-*, ruvector-nervous-system, ruvector-core | 6+ use cases |
| Edge/IoT | Broad | 25+ WASM crates, micro-hnsw-wasm (11.8KB), ruvector-fpga-transformer | 5+ use cases |
| Genomics | Focused | rvDNA (single crate, deep functionality) | 3+ use cases |

## Notes

The overlay files are living documents. As the hive mind performs deep analyses for new vertical queries (ADR-006), the results should be distilled back into the overlay files. This creates a flywheel: swarm analysis produces domain expertise, which is pre-computed into overlays, which reduces future swarm invocations.
