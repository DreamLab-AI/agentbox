# Rendering, LaTeX & Integration

## Rendering Architecture

Mermaid rendering routes through the **browsercontainer sidecar**, which has
Chromium + puppeteer. The agentbox image carries `mmdc` in the Nix store but
cannot render locally (no browser). Use the sidecar wrapper or the HTTP API.

### Preferred: sidecar wrapper (drop-in mmdc replacement)

```bash
# Same interface as mmdc — delegates to browsercontainer over HTTP
mmdc-sidecar.sh -i diagram.mmd -o diagram.png
mmdc-sidecar.sh -i diagram.mmd -o diagram.svg -t dark
mmdc-sidecar.sh -i diagram.mmd -o diagram.pdf
```

The wrapper POSTs to `http://browsercontainer:8931/render-mermaid`, which
renders via the sidecar's Chromium. Output files pass through the shared
`gui-tools-exchange` volume (agentbox: `/home/devuser/gui-tools`,
browsercontainer: `/home/devuser/exchange`).

### Alternative: direct HTTP API

```bash
curl -s -X POST http://browsercontainer:8931/render-mermaid \
  -H 'Content-Type: application/json' \
  -d '{"definition":"flowchart LR; A-->B-->C","format":"svg","theme":"default"}' \
| jq -r '.filename'
# Output file appears at /home/devuser/gui-tools/<filename>
```

### Prerequisites

- `browsercontainer` sidecar running (`agentbox.sh browsercontainer up`)
- Shared `gui-tools-exchange` volume mounted in both containers

---

## Rendering Options

### Sidecar wrapper flags

```bash
mmdc-sidecar.sh -i <input.mmd> -o <output.png|svg|pdf>
    -e <format>           # svg | png | pdf (inferred from -o extension if omitted)
    -t <theme>            # dark | default | forest | neutral
    --help                # Usage information
```

### Batch rendering

```bash
# Render all .mmd files in a directory
for f in diagrams/*.mmd; do
    mmdc-sidecar.sh -i "$f" -o "${f%.mmd}.png" -t dark
done
```

### For LaTeX inclusion

```bash
# Render as PDF for vector quality in LaTeX
mmdc-sidecar.sh -i diagram.mmd -o diagram.pdf

# Or render as SVG and convert
mmdc-sidecar.sh -i diagram.mmd -o diagram.svg
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
~/.claude/skills/report-builder/scripts/asset_audit.sh  # Verifies all diagrams referenced
```

---

## Troubleshooting

### Sidecar not reachable
```bash
# Ensure browsercontainer is running
agentbox.sh browsercontainer up
# Check health
curl -s http://browsercontainer:8931/health | jq .
```

### Rendering returns an error
The sidecar logs show mmdc stderr. Check with:
```bash
agentbox.sh browsercontainer logs | tail -20
```

### Text truncated in nodes
Wrap long labels in quotes: `A["Long label that needs wrapping"]`

### Special characters break syntax
Escape with quotes: `A["Node with {braces} and [brackets]"]`

### Diagram too complex
Split into subgraphs or multiple diagrams. Keep under 40 nodes per diagram.
</content>
