# LaTeX Conventions — memoir, typography, citations

Depth relocated from the former `latex-book` skill (merged into book-publishing,
2026-09-09). Loaded on demand by Stage 1 (Skeleton Builder) and Stage 2 (BibTeX
Extractor) of the book-publishing pipeline; also useful stand-alone when hand-editing
a chapter.

## Document Class & Packages

**Always use `memoir` for books on arXiv** — not `article` or `book`. It provides
chapter styles, drop caps, microtype, and fine-grained layout control without fighting
LaTeX defaults.

```latex
\documentclass[12pt,a4paper,twoside,openright]{memoir}

% Typography
\usepackage{fontspec}           % XeLaTeX font selection
\setmainfont{EB Garamond}       % professional serif; fallback: mathpazo
\usepackage{microtype}          % hanging punctuation, optical margin alignment
\usepackage{lettrine}           % drop caps for chapter openers

% Citations
\usepackage[backend=biber,
            style=numeric-comp,
            sorting=none,
            maxbibnames=99]{biblatex}
\addbibresource{references.bib}

% URLs and links
\usepackage[hidelinks]{hyperref}
\usepackage{url}
```

## UK Typography Conventions

| Convention | Rule |
|------------|------|
| Dashes | UK spaced endash: ` -- ` not `---` (emdash) |
| First paragraph | No indent (standard book typography: `\setlength{\parindent}{0pt}` for first para after heading) |
| Scene breaks | Custom `\scenebreak` command replicating CSS `* * *` asterism |
| Drop caps | `\lettrine[lines=3]{F}{irst}` for chapter openers |

```latex
% Scene break (replicates CSS "* * *")
\newcommand{\scenebreak}{%
  \vspace{1em}
  \begin{center}*\quad*\quad*\end{center}
  \vspace{1em}
}
```

## Chapter Styles (memoir)

```latex
\makechapterstyle{dreambook}{%
  \renewcommand{\beforechapskip}{30pt}
  \renewcommand{\afterchapskip}{20pt}
  \renewcommand{\printchaptername}{}
  \renewcommand{\chapternamenum}{}
  \renewcommand{\printchapternum}{%
    \centering\Large\scshape\thechapter
  }
  \renewcommand{\afterchapternum}{%
    \par\nobreak\vskip 6pt
    {\centering\rule{0.4\textwidth}{0.4pt}\par}
    \vskip 6pt
  }
  \renewcommand{\printchaptertitle}[1]{%
    \centering\huge\itshape ##1
  }
}
\chapterstyle{dreambook}

% Suppress running headers on chapter-start pages
\aliaspagestyle{chapter}{plain}
```

## Citation Patterns

### Footnote-Based Sources (Journalism / Newsletters)

**Key insight:** URL-heavy sources from newsletters/journalism convert to `\footnote{}`
with inline `\url{}`/`\href{}` — NOT to `\cite{}` keys. These go in `@online` or
`@misc` biblatex entries only if they appear multiple times.

```latex
% Single-use URL citation → footnote
\footnote{\href{https://example.com/article}{Author, ``Title,'' \textit{Publication}, Date.}}

% Repeated citation → biblatex entry
@online{smith2024ai,
  author  = {Smith, Jane},
  title   = {The AI Revolution},
  url     = {https://example.com/article},
  urldate = {2024-01-15},
  year    = {2024}
}
```

### cite_mapping.json Pattern

The BibTeX Extractor stage (book-publishing SKILL.md, Stage 2) uses this format for
automated footnote-to-citation conversion across chapters:

```json
{
  "chapter_01": {
    "1": "smith2024ai",
    "2": "jones2023ml",
    "3": "url_only_footnote"
  }
}
```

`"url_only_footnote"` signals that footnote 3 stays as `\footnote{}` — no cite key.
Each chapter converter respects this mapping: URL-only footnotes stay `\footnote{}`,
multi-use citations become `\cite{key}`.

### BibTeX for 1000+ Citations

```latex
% In preamble
\usepackage[backend=biber,
            style=numeric-comp,
            sorting=none]{biblatex}

% Compile sequence
% latexmk -xelatex -biber main.tex
```

## Build Command

```bash
latexmk -xelatex -biber -interaction=nonstopmode main.tex

# Watch mode during editing
latexmk -xelatex -biber -pvc main.tex
```

## arXiv Compliance Checklist

- [ ] `memoir` class with compatible packages
- [ ] All fonts embedded (XeLaTeX with system fonts or `lmodern` fallback)
- [ ] `\pdfoutput=1` in preamble for arXiv detection
- [ ] No `\write18` shell-escape dependencies
- [ ] Bibliography compiled with biber, `.bbl` file submitted
- [ ] Images as PDF/PNG/JPG (no EPS without conversion)
- [ ] No absolute paths in `\input`/`\includegraphics`
- [ ] Source compiles clean with `latexmk -xelatex`

## Folder Structure

```
book/
├── main.tex               # Root document
├── references.bib         # All citations (biber)
├── chapters/
│   ├── ch01.tex
│   ├── ch02.tex
│   └── ...
├── front/
│   ├── preface.tex
│   └── intro.tex
├── appendices/
│   └── appA.tex
├── figures/
│   ├── wardley/           # .mmd + rendered .png
│   ├── tikz/              # .tex TikZ sources
│   └── charts/            # matplotlib PDF outputs
└── cite_mapping.json      # footnote→cite key map
```

## Related

- Pipeline stages that consume these conventions: [`../SKILL.md`](../SKILL.md) Stage 1
  (Skeleton Builder) and Stage 2 (BibTeX Extractor).
- `wardley-maps` — Wardley map generation and LaTeX integration.
- `latex-documents` — general LaTeX compilation (Beamer, articles) outside the book
  pipeline.
