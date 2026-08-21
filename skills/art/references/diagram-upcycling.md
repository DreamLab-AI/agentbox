# Diagram Upcycling for Publication Quality

Depth relocated from SKILL.md. Workflow for enhancing rendered diagrams (TikZ, Mermaid,
matplotlib) to publication quality.

**Prefer routing through the skill's own tool** — it already knows the current model ids,
`$ART_SKILL` resolution, and API keys. Drop to the raw SDK only when you need inline
image-in / image-out editing that the CLI does not expose.

---

## Step 1 — Render source diagram to base PNG

```bash
# TikZ standalone → PNG
pdflatex -interaction=nonstopmode diagram.tex
convert -density 300 diagram.pdf -quality 95 diagram_base.png

# Mermaid via browsercontainer sidecar
mmdc-sidecar.sh -i diagram.mmd -o diagram_base.png

# matplotlib
plt.savefig("chart_base.png", dpi=150, bbox_inches="tight")
```

---

## Step 2 — Upcycle the base PNG

### Preferred: route through generate-image.ts

Uses the same nano-banana models the rest of the skill uses (`nano-banana-pro` =
`gemini-3-pro-image-preview`), so model ids stay in one place.

```bash
ART_SKILL="${ART_SKILL:-$( [ -d /opt/agentbox/skills/art ] && echo /opt/agentbox/skills/art || echo ~/.claude/skills/art )}"

bun run "$ART_SKILL/tools/generate-image.ts" \
  --model nano-banana-pro \
  --reference-image diagram_base.png \
  --prompt "Enhance this diagram for professional publication. Preserve all text labels, data values, and structural relationships exactly. Improve visual clarity, contrast, line weight, and professional appearance. Output at minimum 2x the input resolution." \
  --size 2K \
  --output diagram_enhanced.png
```

### Alternative: raw Gemini SDK

Current SDK is `google-genai` (the legacy `google.generativeai` package and
`gemini-2.0-flash-exp` are retired). Use a current Gemini 3.x image model, matching the ids
the skill uses — `gemini-3-pro-image-preview` (Nano Banana Pro) or
`gemini-3.1-flash-image-preview` (Nano Banana 2).

```python
import os, pathlib
from google import genai
from google.genai import types

client = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])

img = types.Part.from_bytes(
    data=pathlib.Path("diagram_base.png").read_bytes(),
    mime_type="image/png",
)

response = client.models.generate_content(
    model="gemini-3-pro-image-preview",
    contents=[
        img,
        "Enhance this diagram for professional publication. "
        "Preserve all text labels, data values, and structural relationships exactly. "
        "Improve visual clarity, contrast, line weight, and professional appearance. "
        "Output at minimum 2x the input resolution.",
    ],
)

for part in response.candidates[0].content.parts:
    if part.inline_data is not None:
        pathlib.Path("diagram_enhanced.png").write_bytes(part.inline_data.data)
```

**API key:** `GOOGLE_API_KEY` environment variable (in `~/.claude/.env`).

---

## Step 3 — Fallback (no API / batch processing)

```bash
# ImageMagick sharpen + upscale
convert diagram_base.png -resize 200% -sharpen 0x1.0 diagram_hires.png

# Higher quality upscale with unsharp mask
convert diagram_base.png \
  -resize 200% \
  -unsharp 0x0.75+0.75+0.008 \
  -quality 95 \
  diagram_hires.png
```

---

## Resolution and Text Hallucination Note

**Use ≥2x output resolution.** AI image models hallucinate text at low resolution — labels
become garbled. At 2x or higher, text-preservation accuracy is significantly better. Always
verify labels in the enhanced output match the original before including in publication.

---

## Integration with LaTeX (book-publishing pipeline)

```latex
% In document, after upcycling
\begin{figure}[htbp]
  \centering
  \includegraphics[width=\textwidth]{figures/diagram_enhanced.png}
  \caption{Caption here.}
  \label{fig:diagram}
\end{figure}
```
