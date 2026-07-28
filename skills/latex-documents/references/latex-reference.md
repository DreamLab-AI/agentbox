# LaTeX Reference — classes, packages, workflows, troubleshooting

Deep-reference material moved out of `SKILL.md`. The lean guide there covers the
quick path; consult this when you need the full catalog or are debugging a
compile.

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

## Mathematical Typesetting

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

## Multi-File Projects

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

## Error Handling

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

Related skills: **jupyter-notebooks** (generate LaTeX from notebooks),
**report-builder** (create figures for inclusion).

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
