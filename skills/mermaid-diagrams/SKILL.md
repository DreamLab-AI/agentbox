---
name: mermaid-diagrams
description: "Create, render, and export diagrams as code with Mermaid — flowcharts, sequence, class, ER, state, Gantt, C4, architecture, mindmap, and Wardley maps — to PNG/SVG/PDF. Use when turning text into a version-controlled system architecture diagram, process flow, data model, sequence diagram, project timeline, or strategy map."
---

# Mermaid Diagrams — Professional Diagrams as Code

Create, render, and export production-quality diagrams from text using the Mermaid
diagramming language. 25 diagram types, dark/light themes, custom styling, and
PNG/SVG/PDF export via the browsercontainer sidecar.

## When to Use

- System architecture / infrastructure diagrams
- Sequence diagrams for API interactions
- Entity-relationship models for databases
- Flowcharts for business processes or decision trees
- Gantt project timelines and roadmaps
- User journeys, state machines, class diagrams, mindmaps
- Wardley strategy maps (see also the `wardley-maps` skill)
- Any visual diagram that should be version-controlled as code

## When Not To Use

- Publication-quality mathematical figures — use TikZ/PGFPlots directly
- Interactive or animated diagrams — Mermaid produces static output only
- Photo editing or raster manipulation — use the `imagemagick` skill
- 3D scene visualisation — use the `blender` skill

## Quick Start

Rendering routes through the **browsercontainer sidecar** (Chromium + puppeteer);
`mmdc` cannot render locally. Use the `mmdc-sidecar.sh` drop-in wrapper.

```bash
# Author a diagram
cat > diagram.mmd << 'EOF'
flowchart TD
    A[User Request] --> B{Auth Check}
    B -->|Authenticated| C[Process Request]
    B -->|Failed| D[Return 401]
    C --> E[Return Response]
EOF

# Render (format inferred from output extension)
mmdc-sidecar.sh -i diagram.mmd -o diagram.png            # raster
mmdc-sidecar.sh -i diagram.mmd -o diagram.svg -t dark    # scalable, dark theme
mmdc-sidecar.sh -i diagram.mmd -o diagram.pdf            # for LaTeX inclusion
```

Prerequisite: `browsercontainer` sidecar running (`agentbox.sh browsercontainer up`)
with the shared `gui-tools-exchange` volume mounted. Health check:
`curl -s http://browsercontainer:8931/health | jq .`

## Reference (load on demand)

- **[references/diagram-types.md](references/diagram-types.md)** — the 25 diagram
  types, their keywords, best-fit use, and a Wardley map example.
- **[references/styling-and-templates.md](references/styling-and-templates.md)** —
  dark/light theme configs, per-node `classDef` styling, copy-paste templates
  (architecture, sequence, ER, Gantt, mindmap, C4), and best practices.
- **[references/rendering-and-integration.md](references/rendering-and-integration.md)** —
  sidecar architecture, HTTP API, wrapper flags, batch rendering, LaTeX inclusion,
  report-builder integration, and troubleshooting.

Bundled assets: `scripts/render.sh`, `resources/templates/{theme-dark,theme-light,puppeteer}.json`.

## Best Practices (short)

- Meaningful IDs (`userAuth`, not `A`); keep diagrams under ~40 nodes — split when larger.
- `TD` for hierarchies, `LR` for processes; label edges to show relationships.
- Use `classDef` for semantic colour (red=error, green=success); keep one theme per project.
- `.mmd` files are plain text — commit them for diff-friendly version control.
</content>
