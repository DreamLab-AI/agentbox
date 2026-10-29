# LaTeX and Diagram Workflows (browser sidecar)

On-demand cookbook for using the `browsercontainer` sidecar to inspect diagrams
and spot-check LaTeX/PDF output. Canonical connection details live in the
parent `SKILL.md`.

## Mermaid Rendering

Mermaid is rendered by Pele, not by a browser (ADR-2154): use
`mmdc -i map.mmd -o map.svg` (or `pele-render`). Do not load Mermaid from a CDN
in a page to render diagrams. To inspect a rendered SVG visually, open the file
in the sidecar and screenshot it:

```javascript
navigate_page({ type: "url", url: "file:///path/to/map.svg" })
take_screenshot({ filePath: "/tmp/wardley_map.png" })
```

## PDF Preview During LaTeX Builds

Use the sidecar to visually verify LaTeX output during iterative builds:

```javascript
// Open the compiled PDF
navigate_page({ type: "url", url: "file:///path/to/book/main.pdf" })

// Screenshot specific pages for spot-checking
take_screenshot({ filePath: "/tmp/page_check.png" })

// Use evaluate_script to jump to a specific page (PDF.js viewer)
evaluate_script({ function: "() => PDFViewerApplication.page = 42" })
take_screenshot({ filePath: "/tmp/page_42.png" })
```

This is the correct approach for arXiv/book builds — no local PDF viewer required.
