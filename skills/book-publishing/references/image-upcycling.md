# Stage 4 — Image Upcycling (depth)

Loaded on demand by the book-publishing skill. Enhances Stage 3 diagram/chart PNGs
before the final build.

## Default path: ImageMagick (no API, no network)

The container ships ImageMagick 7 and **no configured Gemini CLI/API path**, so this is
the default. It is deterministic, offline, and never hallucinates text — always start here.

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

Only usable if a Google Gemini API key is provisioned (`GOOGLE_API_KEY` /
`GEMINI_API_KEY`) and the `google-genai` package is installed
(`uv pip install google-genai`). This is an **AI** enhancement: it can subtly alter text
labels and data values, so treat its output as a candidate that must be visually verified
against the source before use.

Uses the current unified `google-genai` client (`from google import genai`) — **not** the
deprecated `google.generativeai` SDK — and a current image-capable model
(`gemini-2.5-flash-image`; check the model list for the latest id).

```python
import os
from google import genai
from google.genai import types

client = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])

with open("diagram.png", "rb") as f:
    img_bytes = f.read()

response = client.models.generate_content(
    model="gemini-2.5-flash-image",  # current image model; verify with client.models.list()
    contents=[
        types.Part.from_bytes(data=img_bytes, mime_type="image/png"),
        (
            "Enhance this diagram for professional publication. "
            "Preserve all text labels, data values, and structural relationships exactly. "
            "Improve visual clarity, contrast, and professional appearance. "
            "Output at 2x the input resolution minimum."
        ),
    ],
)

# Image parts come back as inline_data; write the first image part out.
for part in response.candidates[0].content.parts:
    if getattr(part, "inline_data", None) and part.inline_data.data:
        with open("diagram_enhanced.png", "wb") as out:
            out.write(part.inline_data.data)
        break
```

**Guardrails:**
- High output resolution (≥2×) mitigates AI text hallucinations in enhanced images, but does
  not eliminate them — diff every enhanced diagram against its source (browser sidecar
  screenshot compare) before shipping.
- If the key or package is absent, fall back to the ImageMagick path above; the pipeline must
  still complete offline.

## Related

- `art` skill — Gemini API image enhancement conventions.
