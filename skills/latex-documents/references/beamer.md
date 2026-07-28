# Beamer Presentations (AmurMaple theme)

Complete presentation creation system with the AmurMaple theme. This is the
full detail moved out of `SKILL.md`; the lean quick-start lives there, and a
one-page cheat-sheet is in `../BEAMER-QUICK-REFERENCE.md`.

## AmurMaple Theme Overview

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

## Basic Presentation Structure

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

## Theme Color Variants

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

## Theme Options

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

## Frame Types and Sections

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

## Block Types

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

## Overlays and Animations

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

## Column Layouts

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

## Mathematical Presentations

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

## Code Listings

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

## Bibliography in Presentations

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

## Graphics and Figures

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

## Handout Generation

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

## Notes Pages

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

## Compilation

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

## Complete Presentation Workflow

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

## AmurMaple Special Features

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

## Best Practices

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

## Troubleshooting

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
