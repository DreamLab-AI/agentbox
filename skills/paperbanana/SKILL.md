---
name: "PaperBanana"
description: "Generate publication-quality academic diagrams and statistical plots from text descriptions using a multi-agent VLM pipeline with iterative refinement. Supports methodology diagrams, architecture overviews, flow charts, and data visualisations via OpenAI or Google Gemini. Use when creating figures for research papers, technical reports, or academic publications. Integrates with report-builder skill for LaTeX document inclusion."
upstream: "https://github.com/llmsresearch/paperbanana"
version: "0.1.0"
status: active
tags:
  - diagrams
  - academic
  - plots
  - vlm
  - gemini
  - research
depends_on:
  - report-builder
  - latex-documents
---

# PaperBanana — Academic Diagram Generation

Generate publication-quality methodology diagrams, architecture overviews, and statistical plots from text descriptions using a multi-agent VLM pipeline with iterative refinement.

## When to Use

- Creating methodology diagrams for research papers
- Generating architecture overview figures from text descriptions
- Building statistical plots from CSV data for publications
- Producing NeurIPS/ICML-style figures from plain-language descriptions
- Upgrading rough diagrams-as-code into polished academic illustrations
- Batch generating figures for a multi-figure paper or report

## When Not To Use

- For interactive or web-based diagrams — use the mermaid-diagrams skill instead
- For Wardley maps or custom TikZ diagrams — use report-builder or latex-documents
- For photo editing or raster manipulation — use the imagemagick skill
- For simple bar/line charts from data — use Python matplotlib directly
- For 3D visualisations — use the blender skill

## Prerequisites

```bash
# Check installation
paperbanana --help

# If not installed:
pip install "paperbanana[google]"  # For Gemini (free tier)
pip install "paperbanana[openai]"  # For OpenAI
pip install "paperbanana[google,openai]"  # Both
```

**API Keys** (at least one required):
- `GOOGLE_API_KEY` — Gemini (free tier available, recommended for cost)
- `OPENAI_API_KEY` — OpenAI GPT-5.2 + gpt-image-1.5

---

## Quick Start

### Generate a methodology diagram

```bash
# From a text file describing your method
paperbanana generate \
  --input method_description.txt \
  --caption "Overview of the proposed framework" \
  --optimize --auto

# From inline text
echo "Our system uses a hierarchical mesh of specialist agents..." | \
  paperbanana generate --input - --caption "Agent Architecture" --auto
```

### Generate a statistical plot

```bash
paperbanana plot \
  --data results.csv \
  --intent "Bar chart comparing F1 scores across models with error bars"
```

### Interactive setup (first time)

```bash
paperbanana setup  # Guided wizard, works with free Gemini API
```

---

## Pipeline Architecture

PaperBanana uses a two-phase multi-agent pipeline:

### Phase 0: Input Optimisation (optional, `--optimize`)
- **Context Enricher** — structures raw methodology text into clear components
- **Caption Sharpener** — refines visual specifications for the generator

### Phase 1: Linear Planning
- **Retriever** — selects relevant reference examples from 13 curated academic diagrams
- **Planner** — generates a detailed textual description via in-context learning
- **Stylist** — refines for visual aesthetics (NeurIPS/ICML guidelines)

### Phase 2: Iterative Refinement
- **Visualiser** — renders the description into an image
- **Critic** — evaluates faithfulness, readability, conciseness, aesthetics
- Repeats for N iterations or until the critic is satisfied (`--auto`)

---

## CLI Reference

### `paperbanana generate`

Generate a methodology/architecture diagram from text.

```bash
paperbanana generate \
  --input <file.txt|->       # Source text (file or stdin)
  --caption <string>          # Figure caption / communicative intent
  --iterations <N>            # Refinement iterations (default: 3)
  --auto                      # Loop until critic satisfied
  --optimize                  # Pre-process inputs for quality
  --continue                  # Resume a previous run with feedback
  --format <png|jpeg|webp>    # Output format (default: png)
  --vlm-provider <openai|google|openrouter>
  --vlm-model <model-id>
  --image-provider <openai|google>
  --image-model <model-id>
  --verbose                   # Detailed progress
```

### `paperbanana plot`

Generate a statistical plot from data.

```bash
paperbanana plot \
  --data <file.csv>           # Data file
  --intent <string>           # What the plot should show
  --iterations <N>            # Refinement iterations
  --auto                      # Auto-refine
  --format <png|jpeg|webp>
```

### `paperbanana evaluate`

Evaluate a generated diagram against a reference.

```bash
paperbanana evaluate \
  --generated <diagram.png>   # Generated image
  --reference <ref.png>       # Human-drawn reference
  --context <method.txt>      # Source text
  --caption <string>          # Original caption
```

### `paperbanana batch`

Generate multiple figures from a manifest file.

```bash
paperbanana batch --manifest figures.yaml --optimize
```

Manifest format (YAML):
```yaml
items:
  - input: sections/method.txt
    caption: "Overview of encoder-decoder architecture"
    id: fig1
  - input: sections/training.txt
    caption: "Training pipeline with data augmentation"
    id: fig2
  - data: results/accuracy.csv
    intent: "Accuracy comparison bar chart"
    id: fig3
```

---

## Supported Providers

| Component | Provider | Model | Notes |
|-----------|----------|-------|-------|
| VLM | Google Gemini | gemini-2.0-flash | Free tier available |
| Image Gen | Google Gemini | gemini-3-pro-image-preview | Free tier available |
| VLM | OpenAI | gpt-5.2 | Best quality |
| Image Gen | OpenAI | gpt-image-1.5 | Best quality |
| VLM/Image | OpenRouter | Various | Flexible routing |

---

## Python API

```python
import asyncio
from paperbanana import PaperBananaPipeline, GenerationInput, DiagramType
from paperbanana.core.config import Settings

settings = Settings(vlm_provider="google", vlm_model="gemini-2.0-flash")
pipeline = PaperBananaPipeline(settings=settings)

result = asyncio.run(pipeline.generate(
    GenerationInput(
        source_context="Our framework uses a hierarchical mesh of agents...",
        communicative_intent="Architecture overview of the multi-agent system",
        diagram_type=DiagramType.METHODOLOGY,
    ),
    iterations=3,
    auto_refine=True,
    optimize_input=True,
))

# result.final_image is the generated image path
# result.evaluation contains critic scores
```

---

## MCP Server Integration

Add to Claude Code settings for IDE integration:

```json
{
  "mcpServers": {
    "paperbanana": {
      "command": "uvx",
      "args": ["--from", "paperbanana[mcp]", "paperbanana-mcp"],
      "env": {
        "GOOGLE_API_KEY": "your-gemini-key"
      }
    }
  }
}
```

**MCP Tools exposed:**
- `generate_diagram` — generate a methodology/architecture diagram
- `generate_plot` — generate a statistical plot from data
- `evaluate_diagram` — evaluate generated vs reference diagram

---

## Integration with Report Builder

PaperBanana complements the report-builder skill pipeline:

1. **Report Builder Phase 3 (Write)** — generates raw TikZ/Mermaid diagrams
2. **PaperBanana** — upgrades key figures to publication-quality using VLM pipeline
3. **Report Builder Phase 4 (Visualise)** — includes PaperBanana outputs alongside Nano Banana infographics

```bash
# Generate a figure for the report
paperbanana generate \
  --input report/chapters/ch2_methodology.txt \
  --caption "Five converging crises in the UK water sector" \
  --optimize --auto \
  --format png

# Include in LaTeX
# \includegraphics[width=\textwidth]{figures/methodology_diagram.png}
```

---

## Evaluation Dimensions

PaperBanana's built-in critic evaluates on four dimensions:

| Dimension | Weight | Description |
|-----------|--------|-------------|
| **Faithfulness** | Primary | Does the diagram accurately represent the source text? |
| **Readability** | Primary | Is the diagram clear and easy to understand? |
| **Conciseness** | Secondary | Is the diagram free of unnecessary elements? |
| **Aesthetics** | Secondary | Does it follow academic publication conventions? |

---

## Configuration

### Environment variables

```bash
# Provider selection
PAPERBANANA_VLM_PROVIDER=google        # or openai, openrouter
PAPERBANANA_IMAGE_PROVIDER=google      # or openai
PAPERBANANA_VLM_MODEL=gemini-2.0-flash
PAPERBANANA_IMAGE_MODEL=gemini-3-pro-image-preview

# API keys
GOOGLE_API_KEY=your-gemini-key
OPENAI_API_KEY=your-openai-key

# Defaults
PAPERBANANA_DEFAULT_ITERATIONS=3
PAPERBANANA_DEFAULT_FORMAT=png
```

### `.env` file

```bash
# Place in project root or home directory
echo 'GOOGLE_API_KEY=your-key' >> .env
```

---

## Troubleshooting

### "No API key found"
```bash
paperbanana setup  # Interactive wizard
# Or set directly:
export GOOGLE_API_KEY=your-key
```

### Poor quality output
- Add `--optimize` to pre-process inputs
- Use `--auto` for iterative refinement until critic satisfied
- Increase `--iterations` (default 3, try 5-7)
- Provide more detailed source text

### Rate limiting
- Gemini free tier: limited requests/minute
- Add delays between batch items
- Consider OpenAI for high-volume generation

### Image not matching description
- Use `--continue` to resume with feedback
- The critic evaluation shows which dimensions scored low
- Refine the caption to be more specific about visual layout
