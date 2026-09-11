---
name: provenance-tracking
description: >
  Add provenance tracking to any research or analysis output. Use when you need source
  verification, citation tracking, or evidence chains. Creates a .provenance.md sidecar
  documenting sources, verification status, and confidence levels. Integrates with RuVector.
triggers:
  - add provenance
  - track sources
  - citation check
  - verify sources
  - provenance
---

# Provenance Tracking

Attach verifiable source chains to any research output. Uses Read, Write, Grep,
and WebFetch to build the sidecar below.

## When Not To Use

This is a file-sidecar workflow for research you have already produced — it
does not fetch or verify anything live beyond the URLs already in your output.
For live citation verification tools (`verify_citation`, `audit_bibliography`,
`citation_graph`) during active research, use `web-researcher` instead.

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

After completing a provenance record, store a summary for future retrieval —
`mcp__claude-flow__memory_store({namespace: "patterns", key: "provenance-[slug]",
value: "[verification summary]"})`:
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
