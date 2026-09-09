# Stage 4 — Image Upcycling (depth)

Loaded on demand by the book-publishing skill. Enhances Stage 3 diagram/chart PNGs
before the final build.

## Default path: ImageMagick (no API, no network)

This is the default when no Gemini API key is provisioned. It is deterministic,
offline, and never hallucinates text — always start here if in doubt.

```bash
# Upscale + light sharpen; vector sources (PDF charts) don't need this at all.
convert diagram.png -resize 200% -unsharp 0x1.0 diagram_hires.png
```

Notes:
- For matplotlib output, prefer regenerating the chart as **PDF (vector)** over raster
  upscaling — no resolution ceiling, no sharpening artefacts.
- `-unsharp 0x1.0` is gentler than `-sharpen 0x1.0` and avoids haloing on thin strokes.
- If a diagram only needs to be larger, re-render the source (TikZ/Mermaid) at a higher
  DPI rather than upscaling a bitmap.

## Optional path: Gemini image enhancement (requires API access)

A Gemini image path exists when `GOOGLE_API_KEY` is provisioned — the same key the
`art` skill's nano-banana models consume. This is an **AI** enhancement: it can subtly
alter text labels and data values, so treat its output as a candidate that must be
visually verified against the source before use.

Do not hand-roll the SDK call here. The current model ids (nano-banana-2 /
`gemini-3.1-flash-image-preview`, nano-banana-pro / `gemini-3-pro-image-preview`), the
`generate-image.ts` CLI route, and the raw-SDK fallback all live in one place, already
built for this exact pipeline:
[`art/references/diagram-upcycling.md`](../../art/references/diagram-upcycling.md)
("Integration with LaTeX (book-publishing pipeline)"). Use it so model ids stay current
in one place instead of drifting between skills.

**Guardrails:**
- High output resolution (≥2×) mitigates AI text hallucinations in enhanced images, but does
  not eliminate them — diff every enhanced diagram against its source (browser sidecar
  screenshot compare) before shipping.
- If the key is absent, fall back to the ImageMagick path above; the pipeline must
  still complete offline.

## Related

- `art` skill, specifically [`references/diagram-upcycling.md`](../../art/references/diagram-upcycling.md) — Gemini API image enhancement conventions and current model ids.
