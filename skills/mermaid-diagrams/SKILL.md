---
name: mermaid-diagrams
description: >
  Diagrams-as-code routing hub. Two engines: (1) diagram-design — editorial-quality
  self-contained HTML/SVG diagrams with 28 visual types, branded design system, semantic
  patterns, draw.io/Mermaid import, dark/light/terminal variants, animation, and
  accessible SVG. Preferred for any diagram that will be presented, published, or shared.
  (2) Mermaid — fast code-first .mmd diagrams rendered to PNG/SVG/PDF via browsercontainer.
  Preferred for version-controlled technical diagrams embedded in docs or reports.
triggers:
  - /diagram
  - /diagrams
  - /mermaid
  - /diagram-design
  - create a diagram
  - draw a diagram
  - architecture diagram
  - flowchart
  - sequence diagram
  - ER diagram
  - data model diagram
  - system diagram
  - process diagram
  - org chart
  - timeline diagram
  - visualise this
  - visualize this
  - make this visual
---

# Diagrams as Code

Two engines for two jobs. **Pick the right one before drawing.**

## Decision: which engine?

| Need | Engine | Why |
|------|--------|-----|
| Presentation, blog, slide, social card, editorial output | **diagram-design** | Branded HTML with editorial typography, semantic patterns, accessible SVG |
| Mermaid/draw.io source to redraw at publication quality | **diagram-design** | Has dedicated import workflows for both formats |
| Quick technical diagram committed alongside code | **Mermaid** | Plain-text `.mmd`, diffable, renders via sidecar |
| Diagram inside a markdown report or LaTeX doc | **Mermaid** | PNG/SVG/PDF export, embeds cleanly |
| Rapid iteration on structure before polish | **Mermaid** | Faster cycle; convert to diagram-design later |

**Default: diagram-design** — unless the user explicitly asks for Mermaid or the output
is a `.mmd` file committed to a repo.

---

## Engine 1: diagram-design (editorial HTML)

**Load**: [`../diagram-design/SKILL.md`](../diagram-design/SKILL.md)

28 visual types: Architecture, IT current-state, Flowchart, Sequence, State machine,
ER/data model, Timeline, Swimlane, Quadrant, Radar/Spider, Loop/Flywheel, Nested,
Tree, Org chart, Layer stack, Venn, Pyramid/Funnel, Treemap, Bar, Line, Gantt,
Scatter, High-level, Process, Medallion, Data flow, DP integration, DP security matrix.

Features:
- Opinionated editorial design system (skinnable brand tokens)
- Semantic patterns (fan-in queue, stage framework, paired policy traces, secure paved road, etc.)
- Light / dark / full-editorial / terminal / sketchy variants
- Optional accessible animation (reveal, step, loop modes)
- draw.io and Mermaid import with fidelity ledger
- Self-contained HTML output (inline CSS/SVG, no external deps except Google Fonts)
- Accessible SVG contract (`role="img"`, `aria-labelledby`, `<title>`/`<desc>`)
- Pre-output taste gate and geometry verification scripts
- PNG/SVG export workflow

**When routed here**, load `../diagram-design/SKILL.md` in full before drawing.
Follow its §0 style-guide gate on first use in a project.

---

## Engine 2: Mermaid (code-first .mmd)

25 diagram types rendered via the **browsercontainer sidecar** (Chromium + puppeteer).

### Quick start

```bash
cat > diagram.mmd << 'EOF'
flowchart TD
    A[User Request] --> B{Auth Check}
    B -->|Authenticated| C[Process Request]
    B -->|Failed| D[Return 401]
    C --> E[Return Response]
EOF

mmdc-sidecar.sh -i diagram.mmd -o diagram.png
mmdc-sidecar.sh -i diagram.mmd -o diagram.svg -t dark
mmdc-sidecar.sh -i diagram.mmd -o diagram.pdf
```

Prerequisite: `browsercontainer` sidecar running.

### Reference (load on demand)

- **[references/diagram-types.md](references/diagram-types.md)** — 25 Mermaid types
- **[references/styling-and-templates.md](references/styling-and-templates.md)** — themes, classDef, templates
- **[references/rendering-and-integration.md](references/rendering-and-integration.md)** — sidecar, HTTP API, batch, LaTeX

### Best practices

- Meaningful IDs; keep diagrams under ~40 nodes — split when larger.
- `TD` for hierarchies, `LR` for processes; label edges.
- `classDef` for semantic colour; one theme per project.
- `.mmd` files are plain text — commit for diff-friendly version control.

---

## Converting between engines

**Mermaid → diagram-design**: Use the import workflow in diagram-design
(`references/import-mermaid.md`). The `mermaid-extract` binary parses the `.mmd`
into a structural digest; diagram-design redraws it editorially.

**diagram-design → Mermaid**: Not directly supported (editorial layout doesn't map
to Mermaid's auto-layout). Extract the node/edge structure manually.
