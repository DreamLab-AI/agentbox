# LaTeX and Diagram Workflows (browser sidecar)

On-demand cookbook for using the `browsercontainer` sidecar to render diagrams
and spot-check LaTeX/PDF output. Canonical connection details live in the
parent `SKILL.md`.

## Mermaid Rendering Workaround

**`mmdc` 11.14.0 in the Nix store has a broken puppeteer dependency.** Use the
browser sidecar instead to render `.mmd` files:

```python
mmd_content = pathlib.Path("map.mmd").read_text()
html = f"""<!DOCTYPE html>
<html><head>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>mermaid.initialize({{startOnLoad:true,theme:'default'}});</script>
</head><body style="background:white;margin:0;padding:20px">
<div class="mermaid">{mmd_content}</div>
</body></html>"""

html_path = "/tmp/mermaid_render.html"
pathlib.Path(html_path).write_text(html)
```

Then in the browser sidecar:

```javascript
browser_navigate({ url: `file://${html_path}` })
// Wait for Mermaid to render (evaluate or snapshot to verify)
browser_evaluate({ expression: "document.querySelector('.mermaid svg') !== null" })
browser_take_screenshot({ filename: "/tmp/wardley_map.png" })
// For high-DPI: use viewport scaling or take at larger viewport width
```

For 2x resolution, set a wider viewport before screenshotting:

```javascript
browser_evaluate({ expression: "document.body.style.zoom='200%'" })
browser_take_screenshot({ filename: "/tmp/wardley_map_2x.png" })
```

## PDF Preview During LaTeX Builds

Use the sidecar to visually verify LaTeX output during iterative builds:

```javascript
// Open the compiled PDF
browser_navigate({ url: "file:///path/to/book/main.pdf" })

// Screenshot specific pages for spot-checking
browser_take_screenshot({ filename: "/tmp/page_check.png" })

// Use browser_evaluate to jump to a specific page (PDF.js viewer)
browser_evaluate({ expression: "PDFViewerApplication.page = 42" })
browser_take_screenshot({ filename: "/tmp/page_42.png" })
```

This is the correct approach for arXiv/book builds — no local PDF viewer required.
