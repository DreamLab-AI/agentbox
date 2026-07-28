# Report Builder — Detailed Phase Guide

The full six-phase pipeline. `SKILL.md` carries the high-level overview; this file
carries the per-phase mechanics.

## The Pipeline at a Glance

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

## Phase 1: Research Swarm

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

## Phase 2: Report Architecture

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

## Phase 3: Writing and Charts

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

**Key principle:** Every `\includegraphics` reference should have a corresponding file. The skill audits this at the end.

## Phase 4: Diagram Pipeline

### TikZ Diagrams
Created inline in LaTeX chapters. Also compiled as standalone PNGs:
```bash
# Standalone compilation
pdflatex -interaction=nonstopmode -output-directory diagrams/standalone diagram.tex
# Convert to PNG via PyMuPDF
python3 -c "import fitz; doc=fitz.open('diagram.pdf'); doc[0].get_pixmap(dpi=200).save('diagram.png')"
```

### Mermaid Diagrams
```bash
# Render via browsercontainer sidecar
mmdc-sidecar.sh -i diagram.mmd -o diagram.png
```

### Nano Banana Infographic Upgrade
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

## Phase 5: Review Swarm

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

## Phase 6: Final Assembly

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
