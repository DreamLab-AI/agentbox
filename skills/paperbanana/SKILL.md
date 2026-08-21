---
name: "PaperBanana"
description: "Generate publication-quality academic diagrams and statistical plots from text via a multi-agent VLM pipeline with iterative refinement (OpenAI or Google Gemini / nano-banana-2). Use when creating methodology diagrams, architecture overviews, flow charts, NeurIPS/ICML-style figures, or data plots for research papers and technical reports, or upgrading rough diagrams-as-code into polished illustrations; integrates with the report-builder skill for LaTeX inclusion. NOT for interactive/web diagrams (use mermaid-diagrams), TikZ/Wardley maps (use report-builder/latex-documents), photo/raster editing (use imagemagick), simple charts from data (use matplotlib), or 3D (use blender)."
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
- `OPENAI_API_KEY` — OpenAI gpt-image-1

Default image model is nano-banana-2 (`gemini-3.1-flash-image-preview`); nano-banana-pro
(`gemini-3-pro-image-preview`) for maximum quality. See `references/providers-and-config.md`.

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

## References

Deep content lives in `references/` — load on demand:

- **`references/cli-reference.md`** — full flags for `generate`, `plot`, `evaluate`, `batch`, and the batch manifest YAML format.
- **`references/pipeline-architecture.md`** — the two-phase multi-agent pipeline (optimise → plan → refine) and the critic's four evaluation dimensions.
- **`references/providers-and-config.md`** — provider/model table (nano-banana-2 / Gemini 3.x era), env vars, and `.env` setup.
- **`references/python-and-mcp.md`** — Python API usage and the MCP server integration (tools, settings block).
- **`references/integration.md`** — how PaperBanana slots into the report-builder pipeline for LaTeX figures.
- **`references/troubleshooting.md`** — API-key, quality, rate-limit, and description-mismatch fixes.
