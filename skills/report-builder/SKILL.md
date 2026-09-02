---
name: report-builder
description: "Generate publication-quality LaTeX reports — white papers, sector analyses, policy briefs, technical documentation — with data-driven charts, diagrams-as-code, citations, and multi-agent quality review. Use when a document needs professional typesetting with figures, tables, bibliography, and strategic visualisations (Wardley maps, causal diagrams); not for a plain markdown write-up."
---

# Report Builder — Comprehensive Research Report Generator

Build publication-quality reports using a hierarchical mesh swarm of specialist agents, multi-LLM research, professional LaTeX typesetting, Python-generated analytics, diagrams-as-code, and AI-powered infographic generation.

## When to Use This Skill

- Creating research reports, white papers, or sector analyses
- Building comprehensive documents with data, charts, and citations
- Producing policy briefs or government-quality publications
- Any document needing professional LaTeX with figures, tables, bibliography
- Reports requiring Wardley maps, causal diagrams, or strategic visualisations

## When Not To Use

- For simple markdown documents that do not need LaTeX formatting — just write markdown directly
- For presentations — use Beamer via the `latex-documents` skill instead
- For single-figure chart generation — use Python directly without the full report pipeline
- For API documentation — use the `docs-alignment` skill instead
- For diagrams only without a full report — use the `mermaid-diagrams` skill instead

## What This Skill Produces

A complete report package:
- **Compiled PDF** (LaTeX book class, A4, professional typography)
- **Python-generated charts** (matplotlib/seaborn, PDF vector output)
- **Diagrams-as-code** (TikZ + Mermaid with Nano Banana infographic upgrade)
- **Full bibliography** (BibLaTeX/Biber with 100+ cited sources)
- **Index, glossary, list of figures/tables**
- **Appendices** with deep technical data
- **Git-tracked** with clean commits at each version

## Quick Start

### 1. Define Your Report

```markdown
/report-builder "UK Water Sector Analysis" --topics 5 --depth comprehensive
```

Or provide a brief:

```markdown
/report-builder --brief "Analyse the five most pressing challenges facing
the UK water sector, with data-driven projections, Wardley mapping,
and policy recommendations. Target audience: government policy makers."
```

### 2. Preflight

```bash
report-preflight   # on PATH from the agentbox-ops crate
```

Preflight reports which tools and API keys are available and degrades gracefully
when optional features (Nano Banana infographics, cross-LLM review, Perplexity
research) are unavailable. Full prerequisite matrix in
[`references/reference.md`](references/reference.md#prerequisites-check).

### 3. The Six-Phase Pipeline

```
Phase 1 RESEARCH   → parallel research swarm, Perplexity search, structured data
Phase 2 STRUCTURE  → LaTeX skeleton (book class), figure/table/diagram plan
Phase 3 WRITE      → parallel chapter agents, Python charts, BibLaTeX, compile
Phase 4 VISUALISE  → TikZ/Mermaid renders, Nano Banana infographic upgrade
Phase 5 REVIEW     → 4 specialist reviewers + optional cross-LLM review
Phase 6 PUBLISH    → clean 3-pass build, PDF verify, asset audit, git commit
```

Per-phase mechanics — swarm topology, report directory layout, chart style,
diagram commands, reviewer roles, the final clean-build script, and quality gates —
are in [`references/pipeline.md`](references/pipeline.md).

## Quality Gates

- 0 LaTeX errors
- Every `\includegraphics` resolves to an existing file; no unused generated assets
- PDF renders correctly via PyMuPDF
- UK English throughout (babel british)

## References

- [`references/pipeline.md`](references/pipeline.md) — detailed six-phase guide (topology, structure, charts, diagram pipeline, review, final assembly).
- [`references/reference.md`](references/reference.md) — prerequisites, configuration (`report-config.yaml`, colour schemes), skill integration map, troubleshooting, example output, scripts/resources catalog.

## Scripts

| Script | Purpose |
|--------|---------|
| `report-preflight` | Check all prerequisites and API keys |
| `scripts/compile_report.sh` | Full LaTeX build pipeline with verification |
| `scripts/asset_audit.sh` | Check all figures referenced and present |

See [`references/reference.md`](references/reference.md#scripts-reference) for the full script and resource catalog (including templates and figure/pipeline generators).
