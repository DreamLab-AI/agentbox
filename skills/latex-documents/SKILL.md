---
name: latex-documents
description: "Compile LaTeX documents to PDF - academic papers, theses, Beamer presentations, technical docs with math, bibliographies, and multi-file projects. Use when writing or compiling .tex/.bib source, typesetting equations, or building Beamer slides."
---

# LaTeX Documents

LaTeX document preparation with the TeX Live toolchain: papers, reports, books,
Beamer presentations, math typesetting, and bibliography management.

## Quick path

Basic document → PDF:
```latex
\documentclass{article}
\usepackage[utf8]{inputenc}
\usepackage{amsmath, amssymb}

\title{Document Title}
\author{Author Name}
\date{\today}

\begin{document}
\maketitle
\section{Introduction}
Content here...
\end{document}
```
```bash
pdflatex document.tex          # single pass
latexmk -pdf document.tex      # preferred: auto-resolves passes + bib deps
```

With a bibliography (`references.bib` + biblatex/biber):
```latex
\usepackage[backend=biber,style=ieee]{biblatex}
\addbibresource{references.bib}
% ... \cite{author2025} ... \printbibliography
```
```bash
latexmk -pdf -bibtex document.tex
# or manually: pdflatex → biber document → pdflatex → pdflatex
```

Math (inline `$E = mc^2$`, display `\[...\]`, `equation`, `align`) → see
`references/latex-reference.md`.

## When to use

Academic papers, research articles, theses, technical reports, publication-quality
typesetting, math-heavy documents, Beamer presentations, and multi-chapter books
managed with `\include`/`\input`.

## When not to use

- Simple markdown that doesn't need LaTeX formatting — write markdown directly.
- Comprehensive reports with multi-LLM research, charts, Wardley maps — use **report-builder**.
- Diagrams/flowcharts as code — use **mermaid-diagrams**.
- Web docs not compiled to PDF — markdown or HTML fits better.
- Slide decks outside Beamer (HTML/reveal.js) — standard web tools.

## Prerequisites

- **TeX Live**: texlive-basic, texlive-bin, texlive-binextra, texlive-fontsrecommended, texlive-latexrecommended
- **Bibliography**: biber for biblatex processing
- **Engines/tools**: pdflatex, xelatex, lualatex, latexmk

Missing package → `tlmgr install <package>`. Use xelatex/lualatex for system fonts.

## Beamer presentations

Quick start with the bundled AmurMaple theme:
```latex
\documentclass{beamer}
\usetheme{Amurmaple}
\title{My Presentation}\author{Your Name}\date{\today}
\begin{document}
\frame{\titlepage}
\begin{frame}{First Slide}
  \begin{itemize}\item Point 1\item Point 2\end{itemize}
\end{frame}
\thanksframe{Thank you!}
\end{document}
```

Start from a template and compile with the helper script:
```bash
# templates/beamer/{amurmaple-basic,amurmaple-academic,amurmaple-technical}.tex
cd examples/beamer
./compile-beamer.sh your-presentation.tex --biber      # add --handout / --lualatex as needed
```

Full theme detail (color variants, options, frame/block types, overlays, columns,
code listings, TikZ, handouts, notes, troubleshooting) is in
**`references/beamer.md`**. One-page cheat-sheet: **`BEAMER-QUICK-REFERENCE.md`**.
Live examples: `examples/beamer/` (demo + `USAGE-EXAMPLES.md`).

## Deeper reference

`references/latex-reference.md` holds the full catalog and cookbook:
- Command reference (compile engines, bib tools, utilities)
- Document classes (`article`/`report`/`book`/`beamer`/`IEEEtran`/`acmart`)
- Common packages (essential, bibliography, tables/figures, code listings)
- Multi-file projects, math environments, output formats
- Best practices, compilation/bibliography/font troubleshooting
- Jupyter → LaTeX export, technical details

Beamer specifics: `references/beamer.md`. Module implementation notes:
`BEAMER-MODULE-SUMMARY.md`.

## Related skills

- **jupyter-notebooks** — generate LaTeX from notebooks.
- **report-builder** — create figures for inclusion.
