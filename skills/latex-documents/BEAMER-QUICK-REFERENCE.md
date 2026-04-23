# Beamer with AmurMaple Theme - Quick Reference

## Installation

Theme already installed at: `/themes/amurmaple/`

## Quick Start

```latex
\documentclass{beamer}
\usetheme{Amurmaple}

\title{My Presentation}
\author{Your Name}
\date{\today}

\begin{document}
\frame{\titlepage}

\begin{frame}{First Slide}
  Content here
\end{frame}

\thanksframe{Thank you!}
\end{document}
```

## Color Variants

| Variant | Command |
|---------|---------|
| Red (default) | `\usetheme{Amurmaple}` |
| Blue | `\usetheme[amurmapleblue]{Amurmaple}` |
| Green | `\usetheme[amurmaplegreen]{Amurmaple}` |
| Black | `\usetheme[amurmapleblack]{Amurmaple}` |

## Essential Options

```latex
% Sidebar navigation
\usetheme[sidebar]{Amurmaple}

% Left-aligned titles
\usetheme[leftframetitle]{Amurmaple}

% Add decorative rule
\usetheme[rule]{Amurmaple}

% Combine options
\usetheme[sidebar,rule,amurmapleblue]{Amurmaple}
```

## Frame Types

```latex
% Basic frame
\begin{frame}{Title}
  Content
\end{frame}

% Fragile frame (for code)
\begin{frame}[fragile]{Code}
  \begin{lstlisting}
  code here
  \end{lstlisting}
\end{frame}

% Plain frame (fullscreen)
\begin{frame}[plain]
  Fullscreen content
\end{frame}
```

## Blocks

```latex
% Standard block
\begin{block}{Title}
  Content
\end{block}

% Alert block
\begin{alertblock}{Alert}
  Important info
\end{alertblock}

% Example block
\begin{exampleblock}{Example}
  Example content
\end{exampleblock}

% Information box
\begin{information}[Title]
  Information with icon
\end{information}

% Theorem
\begin{theorem}[Name]
  Statement
\end{theorem}
```

## Sections

```latex
\section{Introduction}
\sepframe  % Auto separator with TOC

% Custom separator
\sepframe[title={Custom Title}]
```

## Overlays

```latex
% Progressive reveal
\begin{itemize}
  \item<1-> First (slide 1+)
  \item<2-> Second (slide 2+)
  \item<3-> Third (slide 3+)
\end{itemize}

% Highlighting
\begin{itemize}
  \item<1-| alert@1> Highlighted on slide 1
  \item<2-| alert@2> Highlighted on slide 2
\end{itemize}

% Pause
\begin{itemize}
  \item First
  \pause
  \item Second
\end{itemize}
```

## Columns

```latex
\begin{columns}[T]
  \begin{column}{0.48\textwidth}
    Left content
  \end{column}
  \begin{column}{0.48\textwidth}
    Right content
  \end{column}
\end{columns}
```

## Special Commands

```latex
% Frame subsection
\framesection{Subsection Title}

% Inline alert
Regular text with \boxalert{alert}

% Metadata
\mail{email@example.com}
\webpage{https://example.com}
\collaboration{Joint work with...}

% Thank you slide
\thanksframe{Thank you!}
```

## Mathematics

```latex
% Inline: $E = mc^2$

% Display:
\[
  \int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
\]

% Aligned:
\begin{align}
  a &= b + c \\
  d &= e \cdot f
\end{align}
```

## Bibliography

```latex
% Preamble
\usepackage[backend=biber,style=ieee]{biblatex}
\addbibresource{references.bib}

% Citation
Recent work \cite{author2024}

% Bibliography frame
\begin{frame}[allowframebreaks]{References}
  \printbibliography[heading=none]
\end{frame}
```

## Code Listings

```latex
% Preamble
\usepackage{listings}
\lstset{
  basicstyle=\ttfamily\small,
  keywordstyle=\color{blue}\bfseries,
  backgroundcolor=\color{gray!10}
}

% In fragile frame
\begin{frame}[fragile]{Code}
  \begin{lstlisting}[language=Python]
  def hello():
      print("Hello!")
  \end{lstlisting}
\end{frame>
```

## Compilation

```bash
# Basic
pdflatex presentation.tex
pdflatex presentation.tex

# With bibliography
pdflatex presentation.tex
biber presentation
pdflatex presentation.tex
pdflatex presentation.tex

# Using script
./compile-beamer.sh presentation.tex --biber

# Handout
./compile-beamer.sh presentation.tex --handout

# LuaLaTeX (for delaunay)
./compile-beamer.sh presentation.tex --lualatex
```

## Templates

| Template | Use Case |
|----------|----------|
| `amurmaple-basic.tex` | Quick presentations |
| `amurmaple-academic.tex` | Research talks |
| `amurmaple-technical.tex` | Code/engineering |

## File Locations

```
latex-documents/
├── templates/beamer/          # Templates
│   ├── amurmaple-basic.tex
│   ├── amurmaple-academic.tex
│   └── amurmaple-technical.tex
├── examples/beamer/           # Examples
│   ├── demo-presentation.tex
│   ├── compile-beamer.sh
│   ├── references.bib
│   └── README.md
└── themes/amurmaple/          # Theme files
    ├── beamerthemeAmurmaple.sty
    └── img/
```

## Common Patterns

### Two-Column Code + Explanation
```latex
\begin{columns}[T]
  \begin{column}{0.48\textwidth}
    \begin{lstlisting}[language=Python]
    code here
    \end{lstlisting}
  \end{column}
  \begin{column}{0.48\textwidth}
    Explanation here
  \end{column}
\end{columns}
```

### Progressive Theorem Proof
```latex
\begin{frame}{Proof}
  \begin{theorem}<1->
    Statement
  \end{theorem}

  \begin{proof}<2->
    \begin{itemize}
      \item<3-> Step 1
      \item<4-> Step 2
      \item<5-> Conclusion
    \end{itemize}
  \end{proof}
\end{frame>
```

### Section with Image
```latex
\section{Results}
\sepframe[
  title={Our Results},
  image={\includegraphics[width=2cm]{logo.png}}
]
```

## All Theme Options

```latex
\usetheme[
  amurmapleblue,      % or amurmaplegreen, amurmapleblack
  sidebar,            % Add sidebar navigation
  sidebarwidth=70pt,  % Custom sidebar width
  leftframetitle,     % Left-align frame titles
  toplogo,            % Logo at top of sidebar
  rule,               % Decorative rule
  rulecolor=blue,     % Custom rule color
  nogauge,            % Disable progress gauge
  nomail,             % Disable email display
  delaunay            % Delaunay background (LuaLaTeX only)
]{Amurmaple}
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Theme not found | Use `compile-beamer.sh` script |
| Code in frame fails | Add `[fragile]` option |
| Overlays not working | Check syntax: `<1->`, not `<1>` |
| Bibliography empty | Run biber: `biber presentation` |
| Delaunay not working | Use LuaLaTeX: `--lualatex` |

## Quick Tips

1. **One idea per frame** - Keep slides focused
2. **6-7 lines max** - Avoid text-heavy slides
3. **Use overlays sparingly** - Don't overanimate
4. **Code = fragile** - Always use `[fragile]` for code
5. **Test early** - Compile frequently
6. **Handouts** - Generate with `--handout` option

## Resources

- Full documentation: `SKILL.md`
- Examples: `examples/beamer/`
- Templates: `templates/beamer/`
- Overleaf: https://www.overleaf.com/learn/latex/Beamer
