---
name: geo-content-optimizer
description: >
  Optimize content for AI citations (ChatGPT, Perplexity, AI Overviews, Gemini,
  Claude, Copilot) inside a toprank SEO workflow. Use when the task needs "optimize
  for AI", "get cited by ChatGPT", "GEO optimization", or "appear in AI answers"
  AS PART OF a broader SEO engagement (alongside seo-analysis, keyword-research,
  content-writer). For AI-citation work with NO SEO context, use `bencium-aeo`
  directly — this skill's technique library now lives there.
---

# GEO Content Optimizer (toprank sub-skill)

This is a **pointer**, not a deprecated stub: it stays invocable as toprank's
GEO entry point, but the technique library it used to carry has moved to
[`bencium-aeo/references/geo-techniques.md`](../../bencium-aeo/references/geo-techniques.md)
so the estate has one authority for AI-citation optimisation instead of two
overlapping ones.

## When to use this pointer vs `bencium-aeo` directly

- **Inside a toprank SEO workflow** — you're already running `seo-analysis`,
  `keyword-research`, or `content-writer` and want to layer GEO on top: read
  the reference below, apply the techniques, then hand off to
  [content-writer](../content-writer/SKILL.md).
- **Standalone AI-citation work with no SEO context** — invoke `bencium-aeo`
  directly; it owns the full workflow (analysis, generation, evidence panels,
  JSON-LD schema, testing protocol).

## Boundary with `bencium-aeo`

Same underlying techniques (18-token rule, evidence panels, freshness
signals, FAQ schema) — the boundary is workflow context, not technique. This
pointer exists so a toprank-driven SEO engagement can reach GEO technique
without leaving the suite; `bencium-aeo` is the standalone, SEO-context-free
workflow with its own analysis/generation/testing steps. `bencium-aeo/SKILL.md`
carries the reciprocal note under its own "Related skills" section.

## Reference materials (moved to bencium-aeo)

- [GEO Techniques](../../bencium-aeo/references/geo-techniques.md) — full technique library, CORE-EEAT checklist, worked example
- [AI Citation Patterns](../../bencium-aeo/references/ai-citation-patterns.md) — how each engine selects and cites sources
- [Quotable Content Examples](../../bencium-aeo/references/quotable-content-examples.md) — more before/after pairs
