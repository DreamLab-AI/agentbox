---
name: book-publishing
description: "End-to-end book publishing pipeline from markdown manuscript to arXiv/KDP/print-ready PDF. Orchestrates parallel agent swarms for LaTeX conversion, citation extraction, diagram generation, image upcycling, and visual verification. Use when publishing a book or preparing a manuscript for academic or commercial publication."
triggers:
  - /book-publishing
  - publish book
  - arxiv submission
  - KDP publishing
  - manuscript to PDF
  - book pipeline
---

# Book Publishing Skill

End-to-end pipeline: markdown manuscript → arXiv-compliant / KDP-ready PDF, using parallel agent swarms for each stage.

## Pipeline Overview

```
Markdown Source
      │
      ├─── [Skeleton Builder]     → main.tex skeleton (FIRST, blocking)
      ├─── [BibTeX Extractor]     → references.bib   (parallel)
      │
      ├─── [Chapter Converters × N]  → chapters/ch*.tex  (after skeleton)
      ├─── [Front Matter]            → front/            (after skeleton)
      ├─── [Appendix Converter]      → appendices/       (after skeleton)
      ├─── [Citation Index]          → cite_index.tex    (after bibtex)
      ├─── [Design Consultant]       → typography/styles (after skeleton)
      │
      ├─── [Diagram Engineer]        → TikZ + Mermaid .mmd   (parallel)
      ├─── [Market Analyst]          → matplotlib charts/PDF  (parallel)
      ├─── [Wardley Mapper]          → Wardley .mmd files     (parallel)
      ├─── [Research Verifier]       → citation verification  (parallel)
      │
      ├─── [Image Upcycler]          → Gemini-enhanced PNGs   (after diagrams)
      │
      └─── [Build + Verify]          → latexmk + PDF preview  (final)
```

## Stage 1: Skeleton Builder (Blocking — runs first)

Creates the root `main.tex` with:
- Document class: `memoir` (12pt, a4paper, twoside)
- Package imports (fontspec, microtype, biblatex, hyperref)
- Chapter `\include{}` stubs
- Front/back matter structure

**All other converters wait for skeleton before starting.**

## Stage 2: Parallel Foundation

Run simultaneously after skeleton:

```bash
# BibTeX Extractor
# Scans all markdown footnotes, extracts URLs and references
# Outputs: references.bib + cite_mapping.json
# cite_mapping.json format: {chapter: {footnote_num: cite_key}}

# Chapter Converters — split into batches of 6
# Batch A: chapters 1–6
# Batch B: chapters 7–12  
# Batch C: chapters 13–18
# (etc.)

# Each converter: markdown → LaTeX, respecting cite_mapping.json
# URL-only footnotes → \footnote{\href{...}{...}}
# Multi-use citations → \cite{key}
```

## Stage 3: Parallel Content Generation

All run simultaneously:

| Agent | Output | Notes |
|-------|--------|-------|
| Diagram Engineer | TikZ `.tex` files | Compile standalone, include via \includegraphics |
| Market Analyst | matplotlib `.pdf` charts | Python script, PDF for vector quality |
| Wardley Mapper | `.mmd` + rendered `.png` | See Wardley Maps skill |
| Research Verifier | verification report | Web search, flag unverifiable claims |

## Stage 4: Image Upcycling

After diagrams exist — submit to Gemini API for enhancement:

```python
import google.generativeai as genai
import os, base64

genai.configure(api_key=os.environ["GOOGLE_GEMINI_API_KEY"])
model = genai.GenerativeModel("gemini-2.0-flash-exp")

with open("diagram.png", "rb") as f:
    img_data = base64.b64encode(f.read()).decode()

response = model.generate_content([
    {
        "inline_data": {
            "mime_type": "image/png",
            "data": img_data
        }
    },
    "Enhance this diagram for professional publication. "
    "Preserve all text labels, data values, and structural relationships exactly. "
    "Improve visual clarity, contrast, and professional appearance. "
    "Output at 2x the input resolution minimum."
])
# Save response.parts[0] as enhanced PNG
```

**Fallback (no API):**
```bash
convert diagram.png -resize 200% -sharpen 0x1.0 diagram_hires.png
```

**Note:** High output resolution (≥2x) mitigates AI text hallucinations in enhanced images.

## Stage 5: Build and Verify

```bash
# Full build
latexmk -xelatex -biber -interaction=nonstopmode main.tex

# Visual verification via browser sidecar
# Navigate to output PDF, screenshot pages for review
browser_navigate({ url: "file:///path/to/main.pdf" })
browser_take_screenshot({ filename: "page_verify.png", fullPage: false })
```

## Swarm Topology (claude-flow)

```javascript
// Initialize swarm
mcp__claude-flow__swarm_init({
  topology: "hierarchical",
  maxAgents: 15,
  strategy: "book-conversion"
})

// Stage 1: skeleton (blocking)
await mcp__claude-flow__agent_spawn({
  type: "coder",
  name: "skeleton-builder",
  task: "Build main.tex skeleton with memoir class, all chapter stubs, preamble"
})

// Stage 2: parallel foundation (after skeleton signals complete)
await Promise.all([
  mcp__claude-flow__agent_spawn({ type: "coder", name: "bibtex-extractor", ... }),
  mcp__claude-flow__agent_spawn({ type: "coder", name: "chapter-conv-A", ... }),
  mcp__claude-flow__agent_spawn({ type: "coder", name: "chapter-conv-B", ... }),
  mcp__claude-flow__agent_spawn({ type: "coder", name: "chapter-conv-C", ... }),
  mcp__claude-flow__agent_spawn({ type: "coder", name: "front-matter", ... }),
  mcp__claude-flow__agent_spawn({ type: "coder", name: "appendix-conv", ... }),
  mcp__claude-flow__agent_spawn({ type: "coder", name: "design-consultant", ... }),
  mcp__claude-flow__agent_spawn({ type: "coder", name: "diagram-engineer", ... }),
  mcp__claude-flow__agent_spawn({ type: "analyst", name: "market-analyst", ... }),
  mcp__claude-flow__agent_spawn({ type: "researcher", name: "research-verifier", ... }),
  mcp__claude-flow__agent_spawn({ type: "coder", name: "wardley-mapper", ... }),
])

// Stage 3: after diagrams
await mcp__claude-flow__agent_spawn({ type: "coder", name: "image-upcycler", ... })
```

## Publication Targets

### arXiv
- memoir class, XeLaTeX, biber-compiled `.bbl`
- All fonts embedded, no shell-escape
- Submit: source `.tex` + `.bbl` + figures (PDF/PNG/JPG)

### KDP (Kindle Direct Publishing)
- PDF/X-1a or PDF/X-4 for print
- Bleed: 3mm all sides (`\setlrmarginsandblock` in memoir)
- Cover: separate high-res PDF (300 DPI minimum)
- Interior: 6×9 inch (memoir `[6in,9in]`)

### Print-on-Demand (general)
- Trim size specified in `\setstocksize{9in}{6in}`
- Spine calculation: pages × 0.002252 inches (60gsm paper)

## Quality Gates

Before shipping:
- [ ] `latexmk` exits 0 (no errors)
- [ ] Zero overfull hbox warnings > 10pt
- [ ] All `\cite{}` keys resolve (biber reports 0 unresolved)
- [ ] All `\includegraphics` paths exist
- [ ] PDF opens and pages render correctly (browser sidecar check)
- [ ] First 3 and last 3 chapters spot-checked visually

## Related Skills

- `latex-book` — LaTeX conventions, memoir class, citation patterns
- `wardley-maps` — Wardley map generation with LaTeX integration
- `art` — Gemini API image enhancement (diagram upcycling)
- `browser` — PDF preview, Mermaid rendering workaround
- `latex-documents` — general LaTeX compilation
