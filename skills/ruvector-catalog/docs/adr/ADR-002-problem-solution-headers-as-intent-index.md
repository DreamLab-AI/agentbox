# ADR-002: Problem-Solution Section Headers as Intent Index

**Date**: 2026-03-28
**Status**: Proposed
**Deciders**: Mark Allen
**Related ADRs**: ADR-001, ADR-003, ADR-008

---

## Context

V1's SKILL.md organizes its 200+ technologies under 17 section headers written as natural-language problem statements:

```
### "I need to find similar things"
### "I need relationships between entities"
### "I need to process sequences or route attention"
### "I need something that learns from experience"
### "I need to verify AI outputs / prevent hallucination / detect drift"
### "I need bio-inspired computation"
### "I need advanced mathematics"
### "I need to run LLMs"
### "I need CNN / image embeddings"
### "I need quantum computing"
### "I need distributed systems"
### "I need agents"
### "I need a database"
### "I need it in browser/edge/WASM"
### "I need to work with ScreenPipe"
### "I need formal verification"
### "I need a cognitive OS kernel"
```

These headers function as a **manually curated inverted index** -- they map user intent (expressed as a problem) to technology clusters (the solution set beneath each header). This is the mechanism by which CAG achieves its A- benchmark grade.

**Benchmark evidence for header effectiveness**:

- **Q1** ("verify AI outputs / prevent hallucination / detect drift"): The query is nearly identical to section header #5. Claude performs exact match and returns all 5 technologies listed beneath it (prime-radiant, cognitum-gate-kernel, cognitum-gate-tilezero, ruvector-coherence, mcp-gate). Grade: A.
- **Q4** ("bio-inspired computation for edge devices"): Claude matches to header #6 ("bio-inspired computation") AND header #14 ("browser/edge/WASM"), performing intersection reasoning. Grade: A-.
- **Q3** ("database for my mobile app"): Claude matches to header #13 ("I need a database") and identifies rvlite as the best match for mobile (embedded, WASM, IndexedDB). Grade: B+.

V2 eliminated these headers in favor of a thin router SKILL.md, relying on HNSW search to find technologies. This removed the human-curated intent layer, and quality dropped from A- to C-.

## Decision

**V3 preserves and extends V1's problem-solution section headers to 20+ entries with synonym variants.**

Specifically:

1. **Headers are hand-curated, not auto-generated**. Each header is written in the user's voice -- the way someone actually describes their problem, not the way an engineer describes a capability.

2. **Synonym variants are added to each header** to improve Claude's pattern matching:
   ```
   ### "I need to verify AI outputs / prevent hallucination / detect drift / ensure consistency / fact-check"
   ```
   The additional phrases ("ensure consistency," "fact-check") cost ~10 tokens each but dramatically improve recall for variant phrasings.

3. **Technologies beneath each header are auto-generated from catalog.json**. The header is human-authored; the content is machine-generated from the structured data model. This separates the curation concern (which technologies belong under which problem?) from the data concern (what are the technology details?).

4. **New headers added for V3**:
   - "I need to trade financial instruments" (covers neural-trader-*)
   - "I need genomics / pharmacogenomics" (covers rvDNA)
   - "I need thermodynamic / physics simulation" (covers thermorust)
   - Specialized Domains subsections elevated to top-level headers where appropriate

5. **Cross-references between headers** are made explicit:
   ```
   ### "I need it in browser/edge/WASM"
   > See also: Every crate above with a `-wasm` suffix. Key ones: ...
   ```

## Consequences

### Positive

- **Preserves V1's strongest mechanism**: The section headers are why V1 scored A- on benchmarks. They encode domain expertise about how users phrase problems.
- **Low maintenance cost**: ~20 headers, each a single line. Editing a header takes seconds.
- **Improves recall with synonyms**: A user asking about "fact-checking AI" will match the hallucination-detection section thanks to the synonym variant, without requiring any embedding pipeline.
- **Clean separation of concerns**: Headers are curated intent mappings. Technology details are generated from data. Neither depends on the other's format.
- **Natural information architecture**: Readers (both Claude and humans) can scan headers to orient before diving into details. This is the standard document navigation pattern.

### Negative

- **Requires human maintenance**: When a new capability domain is added to RuVector (e.g., "audio processing"), someone must write a new section header. This cannot be fully automated because the header must be in the user's voice.
- **Header assignment is a judgment call**: When a technology spans multiple domains (e.g., ruvector-gnn could live under "relationships between entities" OR "bio-inspired computation"), a human must decide the primary assignment. Cross-references mitigate but do not eliminate this ambiguity.
- **Ceiling of ~25 headers**: Beyond ~25 top-level sections, SKILL.md becomes a table of contents rather than a readable document. If RuVector grows to 30+ distinct capability domains, a hierarchical structure will be needed.

### Neutral

- **Technology count per section varies**: The "attention mechanisms" section has 18+ technologies; the "formal verification" section has 1. This is acceptable because the sections map to user problems, not to engineering taxonomies.

## Alternatives Considered

### Alternative A: Auto-Generated Headers from Technology Descriptions (Rejected)

Use clustering or topic modeling on technology descriptions to automatically generate section headers.

**Why rejected**: Auto-generated headers lose the "user's voice" quality that makes them effective. A clustering algorithm would produce headers like "Spectral Methods and Eigenvalue Computation" instead of "I need advanced mathematics." The former is an engineering taxonomy; the latter is how a user actually asks the question. The entire value of CAG depends on Claude matching user intent to section headers, and that match works best when the header is written the way a user thinks.

### Alternative B: Flat Alphabetical Listing (Rejected)

List all technologies alphabetically with tags/keywords for filtering.

**Why rejected**: V2's SKILL.md router effectively implements this -- a flat list of technologies searchable by the HNSW pipeline. The benchmark results show this approach scores C- because there is no intent-level organization. A user asking "I need something for preventing my model from drifting" would need to scan 80+ alphabetically listed technologies to find prime-radiant. The section headers eliminate this scan entirely.

### Alternative C: Tag-Based Faceted Navigation (Considered, Partially Adopted)

Each technology gets multiple tags (domain, deployment target, maturity). Claude filters by tags.

**Status**: Partially adopted via the `problemDomains` and `verticals` fields in ADR-008. Tags supplement section headers but do not replace them. Tags are machine-readable attributes; section headers are human-readable intent mappings. Both are needed.

## Evidence

### Section Header Match Quality

Analysis of V1's 17 headers against the 5 benchmark queries:

| Query | Matching Header | Match Type | Result Quality |
|-------|----------------|------------|----------------|
| Q1: hallucination detection | "verify AI outputs / prevent hallucination / detect drift" | Near-exact | A |
| Q2: draft best-selling books | None | No match (out-of-scope) | D (false positives) |
| Q3: database for mobile app | "I need a database" | Direct match | B+ |
| Q4: bio-inspired edge | "bio-inspired computation" + "browser/edge/WASM" | Intersection | A- |
| Q5: healthcare non-technical | None (buried in Specialized Domains) | Weak match | C |

Q2 failure is addressed by ADR-003 (explicit scope boundary). Q5 failure is addressed by ADR-004 (industry vertical overlays) and ADR-005 (non-technical response adaptation).

### Token Cost Analysis

Each section header (with synonym variants) costs approximately 15-25 tokens. 20 headers = 300-500 tokens. This is less than 0.25% of the context window -- negligible cost for the retrieval quality it provides.

## Notes

The distinction between "human-curated headers" and "auto-generated technology details" is critical. A regeneration pipeline (triggered when catalog.json updates) can rewrite the technology bullets beneath each header without touching the header itself. This means SKILL.md stays current with RuVector's crate inventory while preserving the curated intent layer.
