---
name: LaTeX Documents
description: Professional document preparation with LaTeX - compile papers, presentations, and technical documentation
---

# LaTeX Documents Skill

Comprehensive LaTeX document preparation system with TeX Live toolchain for academic papers, technical documentation, and professional typesetting.

## Capabilities

- Compile LaTeX documents to PDF
- Bibliography management with BibTeX/Biber
- Support for common document classes (article, report, book, beamer)
- Mathematical typesetting with AMS packages
- Figure and table management
- Cross-references and citations
- Multi-file projects with \include and \input
- Bibliography styles (IEEE, ACM, APA, etc.)
- Incremental compilation with latexmk
- Error diagnostics and log parsing

## When to Use This Skill

Use this skill when you need to:
- Write academic papers and research articles
- Create technical documentation
- Generate professional presentations (Beamer)
- Typeset mathematical equations
- Produce publication-quality documents
- Manage bibliographies and citations
- Create multi-chapter books or theses
- Generate consistent formatted output

## When Not To Use

- For simple markdown documents that do not need LaTeX formatting -- just write markdown directly
- For comprehensive reports with multi-LLM research, charts, and Wardley maps -- use the report-builder skill instead
- For diagrams and flowcharts as code -- use the mermaid-diagrams skill instead
- For web-based documentation that will not be compiled to PDF -- markdown or HTML is more appropriate
- For slide decks outside Beamer (e.g. HTML/reveal.js) -- standard web tools are a better fit

## Prerequisites

- **TeX Live packages**: texlive-basic, texlive-bin, texlive-binextra, texlive-fontsrecommended, texlive-latexrecommended
- **Bibliography**: biber for biblatex processing
- **Tools**: pdflatex, xelatex, lualatex, latexmk

## Available Commands

### Compilation
- `pdflatex <file>.tex` - Standard LaTeX to PDF
- `xelatex <file>.tex` - Unicode and modern fonts
- `lualatex <file>.tex` - Lua-enhanced LaTeX
- `latexmk -pdf <file>.tex` - Automated build with dependencies

### Bibliography
- `bibtex <file>` - Traditional BibTeX processing
- `biber <file>` - Modern biblatex backend

### Utilities
- `texdoc <package>` - View package documentation
- `kpsewhich <file>` - Locate TeX files

## Instructions

### Creating a Basic Document

1. **Create .tex file** with document structure:
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

2. **Compile** using:
```bash
pdflatex document.tex
```

### Bibliography Workflow

1. **Create .bib file** (references.bib):
```bibtex
@article{author2025,
  author = {Author, First},
  title = {Paper Title},
  journal = {Journal Name},
  year = {2025}
}
```

2. **In .tex file**:
```latex
\usepackage[backend=biber,style=ieee]{biblatex}
\addbibresource{references.bib}

% In document
\cite{author2025}

% At end
\printbibliography
```

3. **Compile sequence**:
```bash
pdflatex document.tex
biber document
pdflatex document.tex
pdflatex document.tex
```

Or use latexmk:
```bash
latexmk -pdf -bibtex document.tex
```

### Mathematical Typesetting

Common math environments:
```latex
% Inline math
$E = mc^2$

% Display math
\[
  \int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
\]

% Numbered equations
\begin{equation}
  \nabla \times \mathbf{E} = -\frac{\partial \mathbf{B}}{\partial t}
\end{equation}

% Aligned equations
\begin{align}
  a &= b + c \\
  d &= e \cdot f
\end{align}
```

### Creating Presentations (Beamer)

Complete presentation creation system with the AmurMaple theme.

#### AmurMaple Theme Overview

Professional Beamer theme with multiple color variants and layout options.

**Installation:**
- Theme location: `/themes/amurmaple/`
- Files: `beamerthemeAmurmaple.sty` and `img/` directory
- License: LPPL 1.3 (LaTeX Project Public License)
- Author: Maxime CHUPIN

**Available Templates:**
- `templates/beamer/amurmaple-basic.tex` - Simple presentation template
- `templates/beamer/amurmaple-academic.tex` - Research presentation with bibliography
- `templates/beamer/amurmaple-technical.tex` - Technical/engineering presentation

**Demo and Examples:**
- `examples/beamer/demo-presentation.tex` - Complete feature showcase
- `examples/beamer/compile-beamer.sh` - Automated compilation script

#### Basic Presentation Structure

```latex
\documentclass{beamer}
\usetheme{Amurmaple}

% Required packages
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}

% Metadata
\title{Presentation Title}
\subtitle{Optional Subtitle}
\author{Your Name}
\institute{Your Institution}
\date{\today}

% Optional metadata
\mail{your.email@example.com}
\webpage{https://example.com}
\collaboration{Joint work with...}

\begin{document}

% Title slide
\frame{\titlepage}

% Content frames
\begin{frame}{Frame Title}
  \begin{itemize}
    \item Point 1
    \item Point 2
    \item Point 3
  \end{itemize}
\end{frame}

% Thank you slide
\thanksframe{Thank you for your attention!}

\end{document}
```

#### Theme Color Variants

Choose from four professional color schemes:

```latex
% Red (default)
\usetheme{Amurmaple}

% Blue variant
\usetheme[amurmapleblue]{Amurmaple}

% Green variant
\usetheme[amurmaplegreen]{Amurmaple}

% Black variant
\usetheme[amurmapleblack]{Amurmaple}
```

#### Theme Options

Customize layout and appearance:

```latex
% Sidebar navigation
\usetheme[sidebar]{Amurmaple}

% Custom sidebar width
\usetheme[sidebar,sidebarwidth=70pt]{Amurmaple}

% Left-aligned frame titles
\usetheme[leftframetitle]{Amurmaple}

% Decorative rule
\usetheme[rule]{Amurmaple}

% Custom rule color
\usetheme[rule,rulecolor=blue]{Amurmaple}

% Disable progress gauge
\usetheme[nogauge]{Amurmaple}

% Top logo positioning
\usetheme[sidebar,toplogo]{Amurmaple}

% Delaunay triangulation background (LuaLaTeX only)
\usetheme[delaunay]{Amurmaple}

% Disable email display
\usetheme[nomail]{Amurmaple}

% Combine multiple options
\usetheme[sidebar,rule,leftframetitle,amurmapleblue]{Amurmaple}
```

#### Frame Types and Sections

**Basic Frame:**
```latex
\begin{frame}{Title}
  Content here
\end{frame}
```

**Frame with Subtitle:**
```latex
\begin{frame}{Title}{Subtitle}
  Content here
\end{frame}
```

**Fragile Frame (for code):**
```latex
\begin{frame}[fragile]{Code Example}
  \begin{lstlisting}
  code here
  \end{lstlisting}
\end{frame}
```

**Plain Frame (no decorations):**
```latex
\begin{frame}[plain]
  Full screen content
\end{frame}
```

**Sections and Navigation:**
```latex
\section{Introduction}  % Creates section in TOC

\sepframe  % Automatic separation frame with TOC

% Custom separation frame
\sepframe[title={Custom Title}]

% With image
\sepframe[image={\includegraphics[width=2cm]{logo.png}}]
```

**Frame Subsections:**
```latex
\begin{frame}{Main Title}
  \framesection{Subsection 1}
  Content for subsection 1

  \framesection{Subsection 2}
  Content for subsection 2
\end{frame}
```

#### Block Types

**Standard Blocks:**
```latex
\begin{block}{Block Title}
  Standard content block
\end{block}

\begin{alertblock}{Alert}
  Important warning or alert
\end{alertblock}

\begin{exampleblock}{Example}
  Example or case study
\end{exampleblock}
```

**Mathematical Blocks:**
```latex
\begin{theorem}[Theorem Name]
  Statement of theorem
\end{theorem}

\begin{definition}[Definition Name]
  Definition content
\end{definition}

\begin{corollary}
  Corollary statement
\end{corollary}

\begin{proof}
  Proof details
\end{proof}
```

**Custom AmurMaple Blocks:**
```latex
\begin{information}[Title]
  Information with icon
\end{information}

\begin{remark}[Optional Note]
  Additional remarks
\end{remark}

\begin{abstract}
  Presentation abstract or summary
\end{abstract}

\begin{quotation}[Author Name]
  "Quote text here"
\end{quotation}
```

**Inline Alerts:**
```latex
Regular text with \boxalert{highlighted alert} inline.
```

#### Overlays and Animations

**Step-by-Step Reveals:**
```latex
\begin{itemize}
  \item<1-> Appears on slide 1
  \item<2-> Appears on slide 2
  \item<3-> Appears on slide 3
  \item<4-> Appears on slide 4
\end{itemize}
```

**Highlighting:**
```latex
\begin{itemize}
  \item<1-| alert@1> Highlighted on slide 1
  \item<2-| alert@2> Highlighted on slide 2
  \item<3-| alert@3> Highlighted on slide 3
\end{itemize}
```

**Conditional Display:**
```latex
\only<1>{Content only on slide 1}
\only<2>{Content only on slide 2}

\onslide<1-2>{Content on slides 1-2}
\onslide<3->{Content from slide 3 onwards}
```

**Pausing:**
```latex
\begin{itemize}
  \item First item
  \pause
  \item Second item (appears after pause)
  \pause
  \item Third item (appears after second pause)
\end{itemize}
```

#### Column Layouts

**Two Columns:**
```latex
\begin{columns}[T]  % T for top alignment
  \begin{column}{0.48\textwidth}
    Left column content
  \end{column}
  \begin{column}{0.48\textwidth}
    Right column content
  \end{column}
\end{columns}
```

**Three Columns:**
```latex
\begin{columns}
  \begin{column}{0.32\textwidth}
    Column 1
  \end{column}
  \begin{column}{0.32\textwidth}
    Column 2
  \end{column}
  \begin{column}{0.32\textwidth}
    Column 3
  \end{column}
\end{columns}
```

**Mixed Content Columns:**
```latex
\begin{columns}[T]
  \begin{column}{0.48\textwidth}
    \framesection{Code}
    \begin{lstlisting}
    code here
    \end{lstlisting}
  \end{column}
  \begin{column}{0.48\textwidth}
    \framesection{Explanation}
    Text explanation here
  \end{column}
\end{columns}
```

#### Mathematical Presentations

**Equations:**
```latex
% Inline math
The formula $E = mc^2$ is famous.

% Display math
\[
  \int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
\]

% Numbered equation
\begin{equation}
  \nabla \times \mathbf{E} = -\frac{\partial \mathbf{B}}{\partial t}
\end{equation}

% Aligned equations
\begin{align}
  f(x) &= x^2 + 2x + 1 \\
  g(x) &= \sin(x) + \cos(x)
\end{align}
```

**Matrices:**
```latex
\[
  A = \begin{bmatrix}
    a_{11} & a_{12} \\
    a_{21} & a_{22}
  \end{bmatrix}
\]
```

#### Code Listings

**Setup for Code Highlighting:**
```latex
\usepackage{listings}
\usepackage{xcolor}

\lstset{
  basicstyle=\ttfamily\small,
  keywordstyle=\color{blue}\bfseries,
  commentstyle=\color{gray}\itshape,
  stringstyle=\color{red},
  showstringspaces=false,
  breaklines=true,
  frame=single,
  numbers=left,
  numberstyle=\tiny\color{gray},
  backgroundcolor=\color{gray!10}
}
```

**Code in Frames:**
```latex
\begin{frame}[fragile]{Python Example}
  \begin{lstlisting}[language=Python]
def fibonacci(n):
    a, b = 0, 1
    while a < n:
        print(a)
        a, b = b, a + b
  \end{lstlisting}
\end{frame}
```

**Inline Code:**
```latex
Use the \lstinline{print()} function.
```

#### Bibliography in Presentations

**Setup:**
```latex
\usepackage[backend=biber,style=ieee]{biblatex}
\addbibresource{references.bib}
```

**Citations:**
```latex
\begin{frame}{Literature Review}
  Recent work by Smith et al. \cite{smith2024}
  shows promising results.
\end{frame}
```

**Bibliography Frame:**
```latex
\begin{frame}[allowframebreaks]{References}
  \printbibliography[heading=none]
\end{frame}
```

#### Graphics and Figures

**Include Images:**
```latex
\usepackage{graphicx}

\begin{frame}{Results}
  \begin{figure}
    \centering
    \includegraphics[width=0.8\textwidth]{results.pdf}
    \caption{Experimental results}
  \end{figure}
\end{frame}
```

**TikZ Diagrams:**
```latex
\usepackage{tikz}

\begin{frame}{Flowchart}
  \begin{center}
    \begin{tikzpicture}[node distance=2cm]
      \node[rectangle,draw] (start) {Start};
      \node[rectangle,draw,below of=start] (process) {Process};
      \node[rectangle,draw,below of=process] (end) {End};
      \draw[->] (start) -- (process);
      \draw[->] (process) -- (end);
    \end{tikzpicture}
  \end{center}
\end{frame}
```

#### Handout Generation

Create printable handouts without overlays:

```bash
# Command line option
pdflatex "\PassOptionsToClass{handout}{beamer}\input{presentation.tex}"

# In document preamble
\documentclass[handout]{beamer}

# Using compilation script
./compile-beamer.sh presentation.tex --handout
```

**Handout-specific content:**
```latex
\mode<handout>{
  \setbeamercolor{background canvas}{bg=white}
  \pgfpagesuselayout{2 on 1}[a4paper,border shrink=5mm]
}
```

#### Notes Pages

Add speaker notes:

```latex
% Enable notes
\setbeameroption{show notes}

\begin{frame}{Title}
  Content here
  \note{Speaker notes here}
\end{frame}

% Notes on separate page
\setbeameroption{show notes on second screen=right}
```

#### Compilation

**Using pdfLaTeX:**
```bash
pdflatex presentation.tex
pdflatex presentation.tex  # Second pass for TOC
```

**With Bibliography:**
```bash
pdflatex presentation.tex
biber presentation
pdflatex presentation.tex
pdflatex presentation.tex
```

**Using Compilation Script:**
```bash
# Basic compilation
./compile-beamer.sh presentation.tex

# With bibliography
./compile-beamer.sh presentation.tex --biber

# LuaLaTeX for delaunay option
./compile-beamer.sh presentation.tex --lualatex

# Generate handout
./compile-beamer.sh presentation.tex --handout

# Clean and recompile
./compile-beamer.sh presentation.tex --clean --biber
```

**Using latexmk:**
```bash
latexmk -pdf -pdflatex="pdflatex -interaction=nonstopmode" presentation.tex
```

#### Complete Presentation Workflow

1. **Choose Template:**
   - Basic: Quick presentations
   - Academic: Research with citations
   - Technical: Code-heavy presentations

2. **Customize Theme:**
   - Select color variant
   - Choose layout options
   - Configure sidebar/navigation

3. **Structure Content:**
   - Define sections with `\section{}`
   - Use `\sepframe` for section transitions
   - Organise frames logically

4. **Add Content:**
   - Text, lists, and blocks
   - Mathematics and equations
   - Code listings
   - Graphics and diagrams

5. **Compile:**
   ```bash
   cd examples/beamer
   ./compile-beamer.sh your-presentation.tex --biber
   ```

6. **Generate Handouts:**
   ```bash
   ./compile-beamer.sh your-presentation.tex --handout
   ```

#### AmurMaple Special Features

**Progress Gauge:**
- Visual indicator of presentation progress
- Automatically positioned in sidebar or margin
- Disable with `nogauge` option

**Automatic Page Numbering:**
- Main slides: Arabic numerals (1/20)
- Appendix: Roman numerals (i/v)

**Email and Webpage Display:**
- Use `\mail{}` and `\webpage{}` commands
- Automatically formatted on title page
- Optional display with `nomail` option

**Custom Thank You Frame:**
```latex
\thanksframe{Thank you for your attention!}

% With custom graphic
\thanksframe[\includegraphics{logo.png}]{Thank you!}
```

#### Best Practices

1. **Keep it Simple:**
   - One main idea per frame
   - Limited text (6-7 lines max)
   - Use bullet points

2. **Visual Hierarchy:**
   - Use `\framesection{}` for subsections
   - Consistent block types
   - Color for emphasis (sparingly)

3. **Animations:**
   - Use overlays purposefully
   - Don't overuse animations
   - Progressive reveals for complex content

4. **Code Presentations:**
   - Keep code snippets short
   - Highlight important lines
   - Use fragile frames

5. **Bibliography:**
   - Keep citations minimal on slides
   - Full bibliography at end
   - Use consistent citation style

6. **File Organisation:**
   ```
   presentation/
   ├── presentation.tex
   ├── references.bib
   ├── figures/
   │   ├── plot1.pdf
   │   └── diagram.pdf
   └── code/
       └── example.py
   ```

#### Troubleshooting

**Theme Not Found:**
```bash
# Set TEXINPUTS environment variable
export TEXINPUTS=./themes/amurmaple:$TEXINPUTS
pdflatex presentation.tex
```

**Compilation Errors:**
- Use `[fragile]` option for frames with code
- Check for unescaped special characters
- Ensure all `\begin{}` have matching `\end{}`

**Overlays Not Working:**
- Verify overlay specifications: `<1->`, `<2-4>`, etc.
- Check frame is not marked `[plain]`
- Ensure not in handout mode

**Bibliography Issues:**
- Run biber after first pdflatex pass
- Check .bib file syntax
- Verify `\addbibresource{}` path

**Delaunay Option:**
- Only works with LuaLaTeX
- Use: `lualatex presentation.tex`
- Or: `./compile-beamer.sh presentation.tex --lualatex`

### Multi-File Projects

Main file (main.tex):
```latex
\documentclass{book}
\begin{document}
\include{chapter1}
\include{chapter2}
\end{document}
```

Chapter files (chapter1.tex):
```latex
\chapter{Introduction}
Content...
```

### Error Handling

Common errors and fixes:
- **Missing package**: Install via `tlmgr install <package>`
- **Undefined control sequence**: Check package imports
- **Missing references**: Run biber/bibtex and recompile
- **File not found**: Check paths and \graphicspath

## Document Classes

Available classes:
- `article` - Journal articles, short papers
- `report` - Technical reports, theses
- `book` - Books, longer documents
- `beamer` - Presentations
- `IEEEtran` - IEEE journal format
- `acmart` - ACM publication format

## Common Packages

### Essential
- `amsmath, amssymb` - Math symbols and environments
- `graphicx` - Include images
- `hyperref` - PDF hyperlinks
- `geometry` - Page layout
- `fancyhdr` - Custom headers/footers

### Bibliography
- `biblatex` - Modern bibliography (use with biber)
- `natbib` - Natural sciences citations

### Tables & Figures
- `booktabs` - Professional tables
- `multirow` - Multi-row cells
- `subcaption` - Subfigures

### Code Listings
- `listings` - Source code formatting
- `minted` - Syntax highlighting (requires Python Pygments)

## Output Formats

- **PDF** - Primary output format
- **DVI** - Intermediate format (convert with dvipdf)
- **PS** - PostScript (convert with dvips)

## Best Practices

1. **Use latexmk** for automated builds
2. **Version control** .tex and .bib files (exclude .aux, .log, .pdf)
3. **Modular structure** for large documents
4. **Consistent formatting** with packages like `cleveref`
5. **Float placement** - Let LaTeX manage figure positions
6. **Cross-references** - Use \label and \ref

## Troubleshooting

### Compilation Issues
- **Check .log file** for detailed errors
- **Clear auxiliary files**: `rm *.aux *.bbl *.blg *.log`
- **Update TeX Live**: `tlmgr update --self --all`

### Bibliography Not Showing
- Ensure `\addbibresource{file.bib}` before \begin{document}
- Run biber: `biber main`
- Check .blg file for biber errors
- Recompile LaTeX twice after biber

### Missing Fonts
- Use xelatex or lualatex for system fonts
- Install font packages: `tlmgr install <font-package>`

## Integration with Jupyter

Export Jupyter notebooks to LaTeX:
```bash
jupyter nbconvert --to latex notebook.ipynb
pdflatex notebook.tex
```

## Related Skills

- **jupyter-notebooks** - Generate LaTeX from notebooks
- **report-builder** - Create figures for inclusion

## Technical Details

- **TeX engine**: pdfTeX, XeTeX, LuaTeX
- **Distribution**: TeX Live (basic installation)
- **Version**: TeX Live 2024+
- **Additional packages**: Install via `tlmgr`

## Notes

- Basic TeX Live installation (~500MB)
- Full TeX Live is ~7GB (install packages as needed)
- PDF generation typically takes 1-5 seconds
- Multi-pass compilation required for references
- Unicode support via XeLaTeX or LuaLaTeX
- Compatible with Overleaf projects (copy .tex and .bib files)
