---
name: provenance-tracking
description: >
  Add provenance tracking to any research or analysis output. Creates a .provenance.md sidecar
  documenting sources, verification status, confidence levels, and the research trail.
  Integrates with RuVector memory for persistent evidence chains.
args: <output-file-path>
section: Quality & Verification
triggers:
  - add provenance
  - track sources
  - citation check
  - verify sources
  - provenance
tools:
  - Read
  - Write
  - Grep
  - WebFetch
memory:
  after: mcp__claude-flow__memory_store({namespace: "patterns", key: "provenance-[slug]", value: "[verification summary]"})
---

# Provenance Tracking

Attach verifiable source chains to any research output.

## Usage

After producing any research artifact, create a provenance sidecar:

```
/provenance docs/research/my-analysis.md
```

## Provenance Record Format

For each output file `<name>.md`, create `<name>.provenance.md`:

```markdown
# Provenance: [title from the document]

## Metadata
- **Created:** [ISO date]
- **Author:** [human or agent]
- **Method:** [how the research was conducted]
- **Confidence:** [HIGH / MEDIUM / LOW — overall assessment]

## Source Chain
| # | Source | URL | Accessed | Status | Confidence |
|---|--------|-----|----------|--------|------------|
| 1 | [author/title] | [url] | [date] | verified / dead / redirect | high / medium / low |
| 2 | ... | ... | ... | ... | ... |

## Verification Log
| Claim | Source(s) | Method | Status |
|-------|-----------|--------|--------|
| [critical claim from document] | [1], [3] | cross-reference | PASS |
| [quantitative claim] | [2] | direct fetch | PASS |
| [inference] | [1] | single-source | CAUTION |

## Evidence Quality
- **Primary sources:** [count] (papers, official docs, data)
- **Secondary sources:** [count] (reviews, articles, blogs)
- **Self-reported:** [count] (vendor claims, press releases)
- **Rejected:** [count] (dead links, unverifiable, AI-generated)

## Limitations
- [any caveats about the research]
- [time-bounded claims that may expire]
- [areas where evidence is thin]
```

## URL Verification

For each source URL:
1. **Fetch** the URL with WebFetch
2. **Live**: mark as `verified`
3. **Dead/404**: search for archived version, mark as `dead` or `archived`
4. **Redirect**: check if redirected content is relevant, mark as `redirect`

## Integration with RuVector

Store provenance summaries for future retrieval:
```javascript
mcp__claude-flow__memory_store({
  namespace: "patterns",
  key: "provenance-[slug]",
  value: "[N] sources verified, [M] rejected, confidence: [level], key claims: [list]",
  upsert: true
})
```

## Slug Convention

Derive slugs from output filenames:
- `docs/research/cloud-sandbox-pricing.md` → slug: `cloud-sandbox-pricing`
- `docs/gpu-kernel-integration-qe-plan.md` → slug: `gpu-kernel-integration-qe-plan`

Lowercase, hyphens, no filler words, ≤5 words.
