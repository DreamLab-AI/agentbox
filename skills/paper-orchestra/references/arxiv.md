# arXiv: format, preflight, metadata, package

arXiv is the only target. These rules were read from arXiv's own help pages
(`info.arxiv.org/help/submit_tex` and `/help/prep`) on 2026-11-14. arXiv
changes them: re-read both pages before a submission if this date is more than
a few months old, and correct this file.

## Format

- `article` class, single column, pdfLaTeX. Template:
  the `latex-documents` template `templates/arxiv/arxiv-preprint.tex`.
- Figures as PDF, PNG or JPEG. arXiv converts nothing: no EPS under pdfLaTeX,
  and no `-eps-converted-to.pdf` files.
- No shell escape (`\write18`, `minted`), no absolute paths, no JavaScript or
  embedded media in the PDF.
- Only packages in arXiv's TeX Live (2025 is the default, 2023 selectable).
  Ship any private `.sty` with the source.
- Do not use `\today` in `\date`: arXiv rebuilds PDFs and the date changes.
- `\pdfoutput=1` is no longer needed; arXiv detects the processor. It is
  harmless if present.

## Bibliography

arXiv now runs BibTeX or Biber itself. Either ship the `.bib` files, or ship a
pre-built `.bbl`:

- A `.bbl` must have the main file's name (`main.tex` and `main.bbl`). If
  present it is used and the `.bib` is ignored.
- natbib with BibTeX: either route is safe. Shipping the `.bbl` pins the
  reference list exactly as built.
- biblatex: a shipped `.bbl` must match arXiv's versions (TeX Live 2025:
  biblatex 3.20, Biber 2.20, bbl format 3.3) and the backend that built the
  paper. This image's Biber may be newer than arXiv's. For a biblatex paper,
  ship the `.bib` and let arXiv build it, unless the versions are known to
  match.

## Preflight

Run on the tree that will be packaged, after the paper's own build:

```bash
paper-orchestra arxiv-preflight --source build/ --main main.tex --log build/main.log --json preflight.json
```

The preflight detects the engine (pdfLaTeX, XeLaTeX or LuaLaTeX) and the
bibliography tool from the source, so a memoir-class book built with XeLaTeX
and Biber is checked by the same command.

| Class | Checks |
|---|---|
| Error (exit 2) | bibliography neither shipped as `<main>.bbl` nor as its `.bib`; a cited key missing from the `.bbl`; an undefined reference or citation in the log; an `\includegraphics` target that does not resolve; a figure format pdfLaTeX cannot take; shell escape; an absolute path; abstract over 1,920 characters |
| Warning (exit 1) | an overfull box more than 5 pt wide; a multiply defined label; missing characters; auxiliary or output files in the tree; figure files nothing includes; `\today` in `\date`; non-ASCII or TeX formatting left in the title or abstract; a biblatex `.bbl` |
| Information | `\pdfoutput=1` present or absent; honorifics in `\author` |

Fix every error. Read every warning: an overfull box of 40 pt is a table
running into the margin and is worth a rebuild; one of 6 pt usually is not.

## Metadata

The submission form is separate from the PDF and has its own rules.

- **Title and abstract are ASCII.** Accents as TeX (`\'e`), maths in `$...$`
  (rendered by MathJax). No `\emph`, `\textbf`, `~`, `\,` or private macros.
- **Abstract**: 1,920 characters at most, no leading "Abstract", one
  paragraph, no line starting with white space.
- **Authors**: `Firstname Lastname`, comma separated, no honorifics or
  degrees, affiliation in parentheses.
- **Comments**: page and figure counts, and anything a reader should know
  ("58 pages, 7 figures; code and results ledger at ...").
- **Categories**: one primary, cross-lists only where the paper would be read.
- **Licence**: chosen per paper by the author and not changeable afterwards.

Write the metadata to `final/arxiv-metadata.txt` so the author pastes it.
`arxiv-preflight` checks the abstract in the source; check the pasted version
has the same text with the TeX removed.

## Package

Include: the main `.tex`, section files, figures actually used, `<main>.bbl`
or the `.bib`, private style files. Exclude: `.aux .log .out .toc .blg .fls
.fdb_latexmk .synctex.gz`, the PDF, build scripts' scratch output, unused
figures, review notes.

For a ledger-built paper, package the **built** tree (macros already
substituted), not the source tree: arXiv does not run the build script.

Then prove the package builds on its own:

```bash
mkdir /tmp/arxiv-check && tar -xf arxiv.tar.gz -C /tmp/arxiv-check
cd /tmp/arxiv-check && latexmk -pdf main.tex && pdfinfo main.pdf | grep Pages
```

The page count and text must match the reviewed PDF. Record the checksums of
`main.tex` and `main.bbl` with the package.

## Before the author submits

- `prose-sanitiser` is clean on the built text.
- The author has decided, and the paper states: licence, funding sentence or
  its absence, competing interests, AI-use statement or its absence, data and
  code availability.
- A replacement of an existing submission is a new public version. The
  comment field says what changed.

Submission is the author's action. This skill stops at a verified package and
the metadata file.

## Other targets

A book or memoir-class manuscript for arXiv follows `book-publishing`, which
keeps its own checklist for XeLaTeX and Biber.
