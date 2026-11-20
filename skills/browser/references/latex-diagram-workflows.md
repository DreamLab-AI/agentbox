# LaTeX and Diagram Workflows (browser sidecar)

On-demand cookbook for using the `browsercontainer` sidecar to inspect diagrams
and spot-check LaTeX/PDF output. Canonical connection details live in the
parent `SKILL.md`.

Every snippet below uses `pageId`, the actual ID of the intended review tab
returned by `new_page` or `list_pages` (connector 1.13 requires explicit IDs).

## Mermaid Rendering

Mermaid is rendered by Pele, not by a browser (ADR-2154): use
`mmdc -i map.mmd -o map.svg` (or `pele-render`). Do not load Mermaid from a CDN
in a page to render diagrams. To inspect a rendered SVG visually, open the file
in the sidecar and screenshot it. `file:` URLs and `filePath` resolve in the
sidecar; use `/home/devuser/exchange`, the same path in Agentbox (ADR-2207):

```javascript
navigate_page({ pageId, type: "url", url: "file:///home/devuser/exchange/map.svg" })
take_screenshot({ pageId, filePath: "/home/devuser/exchange/mcp/wardley_map.png" })
```

## PDF Preview During LaTeX Builds

Use the sidecar to visually verify LaTeX output during iterative builds:

```javascript
// Open the compiled PDF
navigate_page({ pageId, type: "url", url: "file:///home/devuser/exchange/book/main.pdf" })

// Screenshot specific pages for spot-checking
take_screenshot({ pageId, filePath: "/home/devuser/exchange/mcp/page_check.png" })

// Chrome's built-in PDF viewer is not PDF.js; use a PDF page URL fragment.
navigate_page({ pageId, type: "url", url: "file:///home/devuser/exchange/book/main.pdf#page=42" })
take_screenshot({ pageId, filePath: "/home/devuser/exchange/mcp/page_42.png" })
```

This is the correct approach for arXiv/book builds — no local PDF viewer required.

## PDF visual comparison (replaces local diff-pdf)

The Agentbox image does not ship `diff-pdf`: its wxWidgets dependency brought in
WebKitGTK solely for a local GUI. Use `browser-gpu` for visual PDF review instead.
This is a visual-review workflow, not a drop-in replacement for `diff-pdf`'s
machine-readable equality exit status.

Paths in `file:` URLs resolve inside **browsercontainer**, not Agentbox. The
shared `gui-tools-exchange` volume is `/home/devuser/exchange` in both (Agentbox
also keeps it at `$HOME/gui-tools`). Copy only the requested review artifacts
there; do not publish private PDFs on a host-facing HTTP server.

For reliable page-by-page screenshots without PDF viewer chrome, rasterise the
same selected page of both PDFs with the retained Poppler tools:

```sh
review_dir="$(mktemp -d /home/devuser/exchange/pdf-review.XXXXXX)"
pdftoppm -f 1 -l 1 -r 120 -png -singlefile before.pdf "$review_dir/before"
pdftoppm -f 1 -l 1 -r 120 -png -singlefile after.pdf "$review_dir/after"
printf 'Browser review directory: file://%s/\n' "$review_dir"
```

Open `before.png` and `after.png` from that directory in separate browser-gpu
pages, capture screenshots and compare layout, missing content and typography.
Repeat for other selected pages; use `pdfinfo` to check page-count changes.
For a numeric pixel comparison, the optional ImageMagick toolchain can compare
the **rasterised PNGs**, but visual inspection alone is not proof of equality.
