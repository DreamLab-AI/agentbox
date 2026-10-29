# Rendering, LaTeX & Integration

## Rendering Architecture

Mermaid renders with **Pele** (obsidianmd/pele, pinned 1.12.0, MIT, no
dependencies) in-process in Node: no browser, Puppeteer or sidecar (ADR-2154).
`pele-render` is the CLI; `mmdc` stays as a compatibility shim onto it. Mermaid
remains the source syntax (Mermaid 12.1 grammar). Layout and style are Pele's
own, so output differs from GitHub's native Mermaid rendering.

```bash
mmdc -i diagram.mmd -o diagram.svg            # SVG, every Pele CSS variable flattened
mmdc -i diagram.mmd -o diagram.png -t dark    # PNG needs ImageMagick (baked)
pele-render --check diagram.mmd notes.md      # parse only; file:line errors, exit 4
pele-render notes.md -o figs/                 # every ```mermaid block of a .md
```

PDF: render the SVG, then `magick diagram.svg diagram.pdf` (raster-embedded).

---

## Rendering Options

### Flags (`mmdc` shim)

```bash
mmdc -i <input.mmd> -o <output.svg|png>
    -e <format>           # svg | png (inferred from -o extension if omitted)
    -t <theme>            # default | dark
    -w <pixels>           # scale the SVG to this width
    -b <colour>           # background, e.g. transparent
    -q                    # quiet
    --help                # Usage information
```

Refused with exit 1 (no Pele equivalent): `-H`, `-s`, `-c`, `-C`, `-I`, `-p`,
`-f`, themes `forest` and `neutral`, and `-e pdf`. `pele-render` has the same
renderer with `--check`, several inputs and `.md` support.

### Batch rendering

```bash
# Render all .mmd files in a directory
for f in diagrams/*.mmd; do
    mmdc -i "$f" -o "${f%.mmd}.png" -t dark
done
```

### For LaTeX inclusion

```bash
# SVG from Pele, then a PDF (raster-embedded) with ImageMagick
mmdc -i diagram.mmd -o diagram.svg
magick diagram.svg diagram.pdf
```

Then in LaTeX:
```latex
\begin{figure}[htbp]
  \centering
  \includegraphics[width=\textwidth]{diagrams/diagram.pdf}
  \caption{System architecture diagram.}
  \label{fig:system-arch}
\end{figure}
```

---

## Integration with Report Builder

This skill is called by the **report-builder** skill during Phase 4 (VISUALISE):

1. Mermaid `.mmd` files are created during chapter writing
2. Rendered to PNG via `mmdc` with dark or light theme
3. Optionally sent to Nano Banana for infographic upgrade (3 iterations)
4. Best version (original or infographic) selected for inclusion
5. Wired into LaTeX via `\includegraphics`

```bash
# Report builder integration
../../report-builder/scripts/asset_audit.sh  # Verifies all diagrams referenced
```

---

## Troubleshooting

### Rendering returns an error
Errors read `file:line: pele syntax at mermaid line N: ...` with a caret
snippet. A bare `;` in sequence-diagram text is rejected by Pele and by
Mermaid 11 alike: use `#59;` or reword.

### Text truncated in nodes
Wrap long labels in quotes: `A["Long label that needs wrapping"]`

### Special characters break syntax
Escape with quotes: `A["Node with {braces} and [brackets]"]`

### Diagram too complex
Split into subgraphs or multiple diagrams. Keep under 40 nodes per diagram.
