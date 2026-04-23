---
name: "Report Builder"
description: "Build world-class comprehensive reports with LaTeX, Python analytics, Wardley maps, diagrams-as-code (TikZ + Mermaid), Nano Banana AI infographics, multi-LLM research swarms, and automated quality control. Use when creating research reports, white papers, sector analyses, technical documentation, policy briefs, or any document requiring professional presentation with data-driven charts, citations, and strategic visualisations."
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

- For simple markdown documents that do not need LaTeX formatting -- just write markdown directly
- For presentations -- use Beamer via the latex-documents skill instead
- For single-figure chart generation -- use Python directly without the full report pipeline
- For API documentation -- use the docs-alignment skill instead
- For diagrams only without a full report -- use the mermaid-diagrams skill instead

## What This Skill Produces

A complete report package:
- **Compiled PDF** (LaTeX book class, A4, professional typography)
- **Python-generated charts** (matplotlib/seaborn, PDF vector output)
- **Diagrams-as-code** (TikZ + Mermaid with Nano Banana infographic upgrade)
- **Full bibliography** (BibLaTeX/Biber with 100+ cited sources)
- **Index, glossary, list of figures/tables**
- **Appendices** with deep technical data
- **Git-tracked** with clean commits at each version

---

## Prerequisites Check

The skill auto-detects and reports on available tools. Run the preflight check:

```bash
# The skill runs this automatically — or invoke manually:
python3 ~/.claude/skills/report-builder/scripts/preflight.py
```

### Required
- `pdflatex` / `xelatex` / `lualatex` (TeX Live)
- `biber` (BibLaTeX backend)
- `makeglossaries`, `makeindex`
- Python 3.10+ with `matplotlib`, `pandas`, `numpy`, `seaborn`
- `PyMuPDF` (fitz) for PDF verification

### Optional (Enhanced Features)
- **Gemini API key** (`GOOGLE_GEMINI_API_KEY`) — enables Nano Banana infographic generation
- **Perplexity API key** (`PERPLEXITY_API_KEY`) — enables real-time web research
- **Mermaid CLI** (`mmdc`) — enables Mermaid diagram rendering
- **Multi-user LLMs** (gemini-user, openai-user, deepseek-user) — enables cross-LLM review
- **Claude Flow MCP** — enables swarm coordination, memory, hooks
- **UI/UX Pro Max skill** — enables professional design system guidance

### API Keys (check with preflight)
| Key | Purpose | Required? |
|-----|---------|-----------|
| `GOOGLE_GEMINI_API_KEY` | Nano Banana image gen (needs billing) | Optional |
| `PERPLEXITY_API_KEY` | Real-time web research | Optional |
| `OPENAI_API_KEY` | Cross-LLM review | Optional |
| `DEEPSEEK_API_KEY` | DeepSeek reasoner review | Optional |

---

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

### 2. The Skill Executes This Pipeline

```
Phase 1: RESEARCH (parallel agents)
  ├── Deploy research swarm (6-8 agents per topic)
  ├── Perplexity web search for current data
  ├── Extract statistics, citations, data tables
  └── Compile structured research data files

Phase 2: STRUCTURE (architecture)
  ├── Design report structure from research findings
  ├── Create LaTeX document skeleton (book class)
  ├── Design cross-cutting narrative connections
  └── Plan figures, tables, and diagrams

Phase 3: WRITE (parallel chapter agents)
  ├── Write all chapters in parallel
  ├── Generate Python analytics and charts
  ├── Create TikZ/Mermaid diagrams
  ├── Build BibLaTeX bibliography
  └── Compile and verify PDF

Phase 4: VISUALISE (diagram pipeline)
  ├── Render TikZ diagrams to standalone PNG
  ├── Render Mermaid diagrams to PNG/SVG
  ├── Send to Nano Banana for infographic upgrade (3 iterations)
  ├── Compare original vs infographic, choose best
  └── Wire all assets into LaTeX

Phase 5: REVIEW (multi-agent quality control)
  ├── Deploy 4 specialist reviewers
  ├── Cross-LLM review (Gemini, OpenAI, DeepSeek if available)
  ├── Evaluate feedback, prioritise corrections
  ├── Apply data corrections and fill gaps
  └── Recompile and verify

Phase 6: PUBLISH (final assembly)
  ├── Clean LaTeX build (3-pass + biber + glossaries + index)
  ├── Verify PDF via PyMuPDF rendering
  ├── Asset audit (zero unused figures)
  ├── Screenshot verification on VNC (if available)
  └── Git commit and push
```

---

## Detailed Phase Guide

### Phase 1: Research Swarm

The skill deploys a **hierarchical mesh swarm** of research agents:

```bash
# Swarm topology
npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized
```

**Agent types deployed per topic:**
- `researcher` — deep web search and data extraction
- `perplexity-research` skill — real-time citations with URLs

**Research output format:**
Each agent produces structured data files in `report/data/`:
- Statistics with exact source URLs
- Pre-formatted LaTeX tables
- BibTeX entries for every source
- Time-series data for Python charts

### Phase 2: Report Architecture

The skill creates a standard report structure:

```
report/
├── main.tex              # Master document (book class)
├── references.bib        # BibLaTeX bibliography
├── chapters/
│   ├── titlepage.tex     # Custom TikZ title page
│   ├── abstract.tex
│   ├── executive_summary.tex
│   ├── ch1_introduction.tex
│   ├── ch2_*.tex ... chN_*.tex  # Topic chapters
│   ├── chN+1_interplay.tex      # Cross-cutting analysis
│   ├── chN+2_wardley.tex        # Wardley map chapter
│   ├── chN+3_conclusions.tex    # Recommendations
│   └── appendices.tex           # Deep technical appendices
├── figures/              # Python-generated PDFs
├── diagrams/
│   ├── standalone/       # TikZ/Mermaid renders
│   └── infographics/     # Nano Banana outputs
├── scripts/
│   ├── generate_figures.py
│   └── nano_banana_pipeline.py
├── data/                 # Research data files
└── bib/                  # Additional .bib files
```

**LaTeX features included by default:**
- Custom colour palette (dark professional theme)
- Custom environments: `keyfinding`, `crisisalert`, `policybox`, `datanote`, `interplaybox`
- Wardley map TikZ macros
- `fancyhdr` headers, `hyperref` links, `cleveref` cross-references
- `booktabs` tables, `tcolorbox` boxes, `pgfplots` charts
- Full glossary with acronyms, index, list of figures/tables

### Phase 3: Writing and Charts

**Chapter writing** uses parallel agents (one per chapter) with full context from research data.

**Python figure generation:**
```python
# Standard chart style
plt.rcParams.update({
    'font.family': 'serif',
    'axes.grid': True, 'grid.alpha': 0.3,
    'figure.facecolor': 'white'
})
# All figures exported as PDF for vector quality
fig.savefig('figures/chart_name.pdf', dpi=300, bbox_inches='tight')
```

**Key principle:** Every `\includegraphics` reference MUST have a corresponding file. The skill audits this at the end.

### Phase 4: Diagram Pipeline

#### TikZ Diagrams
Created inline in LaTeX chapters. Also compiled as standalone PNGs:
```bash
# Standalone compilation
pdflatex -interaction=nonstopmode -output-directory diagrams/standalone diagram.tex
# Convert to PNG via PyMuPDF
python3 -c "import fitz; doc=fitz.open('diagram.pdf'); doc[0].get_pixmap(dpi=200).save('diagram.png')"
```

#### Mermaid Diagrams
```bash
# If mmdc available:
mmdc -i diagram.mmd -o diagram.png -w 2000 -H 1200 --backgroundColor transparent
# Fallback: use Python mermaid-py or skip
```

#### Nano Banana Infographic Upgrade
```python
# 3-iteration refinement pipeline
# Iteration 1: Transform diagram to professional infographic
# Iteration 2: Refine typography, colour, layout
# Iteration 3: Final polish for print quality

# API call format:
curl -s "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${KEY}" \
  -H 'Content-Type: application/json' \
  -d '{
    "contents": [{"parts": [
      {"text": "Transform into world-class infographic..."},
      {"inline_data": {"mime_type": "image/png", "data": "<base64>"}}
    ]}],
    "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]}
  }'
```

**Selection logic:** If Nano Banana produces a clear, labelled infographic, use it. If the output loses labels or accuracy, keep the original TikZ/Mermaid render. The skill renders both and lets the operator compare.

### Phase 5: Review Swarm

**4 specialist reviewers** (deployed as Claude agents):
1. **Infrastructure/Data Expert** — checks statistics, flags outdated figures
2. **Policy/Regulation Expert** — checks regulatory accuracy, political feasibility
3. **Environmental/Science Expert** — checks scientific claims, identifies gaps (PFAS, emerging contaminants)
4. **Digital/Technology Expert** — checks tech deployments, Wardley map positioning

**Cross-LLM review** (if API keys available):
- Gemini via `GOOGLE_GEMINI_API_KEY`
- OpenAI via `OPENAI_API_KEY`
- DeepSeek via `DEEPSEEK_API_KEY`
- Z.AI via local service (port 9600)

**Review actions:**
- Data corrections applied surgically
- Missing sections added
- Bibliography expanded
- Figures regenerated with corrected data

### Phase 6: Final Assembly

```bash
# Clean build pipeline
rm -f main.{aux,bbl,bcf,blg,run.xml,toc,lof,lot,idx,ind,ilg,ist,acn,acr,alg,glo,gls,glg,out,log}
pdflatex -interaction=nonstopmode main.tex
biber main
makeglossaries main
makeindex main
pdflatex -interaction=nonstopmode main.tex
pdflatex -interaction=nonstopmode main.tex

# Verify
python3 -c "import fitz; d=fitz.open('main.pdf'); print(f'{len(d)} pages')"

# Asset audit
grep -rh 'includegraphics' chapters/*.tex | sed 's/.*{(.*)}/\1/' | sort -u | while read f; do
  [ ! -f "$f" ] && echo "BROKEN: $f"
done
```

**Quality gates:**
- 0 LaTeX errors
- All `\includegraphics` resolve to existing files
- No unused generated assets
- PDF renders correctly via PyMuPDF
- UK English throughout (babel british)

---

## Configuration

### Report Style Options

```yaml
# report-config.yaml (optional — sensible defaults used if absent)
title: "Report Title"
subtitle: "Subtitle"
date: "March 2026"
document_class: book        # book | report
paper: a4paper
font_size: 11pt
colour_scheme: professional # professional | academic | government | corporate
bibliography_style: authoryear-comp
include_wardley: true
include_infographics: true
include_index: true
include_glossary: true
max_research_agents: 8
nano_banana_iterations: 3
review_agents: 4
```

### Colour Schemes

| Scheme | Primary | Accent | Background | Use Case |
|--------|---------|--------|------------|----------|
| `professional` | Navy #0B2545 | Cyan #00D4FF | White | Government, consultancy |
| `academic` | Dark blue #1B4F72 | Green #1E8449 | White | Research papers |
| `government` | Black #1C1C1C | Red #C0392B | White | Policy documents |
| `corporate` | Blue #2471A3 | Gold #F39C12 | White | Business reports |

---

## Integration with Other Skills

This skill composes with:

| Skill | Integration |
|-------|------------|
| `latex-documents` | LaTeX compilation, bibliography management |
| `perplexity-research` | Real-time web research with citations |
| `ui-ux-pro-max` | Professional design guidance for infographics and layout |
| `build-with-quality` | Quality gates, TDD for Python scripts |
| `sparc-methodology` | SPARC phases for structured development |
| `swarm-orchestration` | Hierarchical mesh swarm coordination |
| `hooks-automation` | Pre/post task hooks for quality checks |
| `memory` | Persistent cross-session learning |

---

## Troubleshooting

### LaTeX won't compile
```bash
# Check for errors
grep "^!" main.log | head -10
# Common: missing package → install with pacman/tlmgr
# Common: undefined glossary entry → add \newacronym in main.tex
# Common: broken \includegraphics → run asset audit
```

### Nano Banana returns 403/quota error
- Requires a **billing-enabled** Google AI Studio account
- Free tier has zero quota for image generation models
- Fallback: use clean TikZ/Mermaid originals (still professional quality)

### Biber can't find citations
```bash
# Check .bcf file includes all bib resources
grep "datasource" main.bcf
# Ensure \addbibresource{} for each .bib file in main.tex
```

### Python figures fail to generate
```bash
# Use venv with clean PYTHONPATH
PYTHONPATH="" /opt/venv/bin/python3 scripts/generate_figures.py
```

---

## Example Output

The skill was developed and validated by producing a **129-page report** on the UK water sector:
- 11 main chapters + 8 appendix chapters
- 22 figures (17 Python charts + 5 Nano Banana infographics)
- 170+ bibliography entries
- 35+ data tables
- 3 Wardley maps, causal loop diagram, system architecture diagrams
- Full index, glossary, list of figures/tables
- 4 review iterations with data corrections

See `/home/devuser/workspace/waterworks/report/` for the complete example.

---

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `scripts/preflight.py` | Check all prerequisites and API keys |
| `scripts/generate_figures.py` | Template for Python chart generation |
| `scripts/nano_banana_pipeline.py` | TikZ/Mermaid → infographic pipeline |
| `scripts/compile_report.sh` | Full LaTeX build pipeline with verification |
| `scripts/asset_audit.sh` | Check all figures referenced and present |
| `scripts/init_report.py` | Initialize new report from template |

## Resources

- `resources/templates/main_template.tex` — LaTeX master template
- `resources/templates/chapter_template.tex` — Chapter template
- `resources/templates/colour_schemes.yaml` — Colour palette definitions

## Advanced Topics

See [docs/ADVANCED.md](docs/ADVANCED.md) for:
- Custom Wardley map macros
- Multi-report series management
- Automated periodic report generation
- Integration with GitHub Actions for CI/CD compilation
