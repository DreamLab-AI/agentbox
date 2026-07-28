# Report Builder — Prerequisites, Configuration & Reference

Companion to `SKILL.md` and `pipeline.md`. Holds the full prerequisite matrix,
configuration options, integration map, troubleshooting, and asset catalog.

---

## Prerequisites Check

The skill auto-detects and reports on available tools. Run the preflight check:

```bash
# The skill runs this automatically — or invoke manually:
python3 ~/.claude/skills/report-builder/scripts/preflight.py
```

### Required
- `pdflatex` / `xelatex` / `lualatex` (TeX Live)
- `biber` (BibLaTeX backend)
- `makeglossaries`, `makeindex`
- Python 3.10+ with `matplotlib`, `pandas`, `numpy`, `seaborn`
- `PyMuPDF` (fitz) for PDF verification

### Optional (Enhanced Features)
- **Gemini API key** (`GOOGLE_GEMINI_API_KEY`) — enables Nano Banana infographic generation
- **Perplexity API key** (`PERPLEXITY_API_KEY`) — enables real-time web research
- **Mermaid CLI** (`mmdc`) — enables Mermaid diagram rendering
- **Multi-user LLMs** (gemini-user, openai-user, deepseek-user) — enables cross-LLM review
- **Claude Flow MCP** — enables swarm coordination, memory, hooks
- **UI/UX Pro Max skill** — enables professional design system guidance

### API Keys (check with preflight)
| Key | Purpose | Required? |
|-----|---------|-----------|
| `GOOGLE_GEMINI_API_KEY` | Nano Banana image gen (needs billing) | Optional |
| `PERPLEXITY_API_KEY` | Real-time web research | Optional |
| `OPENAI_API_KEY` | Cross-LLM review | Optional |
| `DEEPSEEK_API_KEY` | DeepSeek reasoner review | Optional |

---

## Configuration

### Report Style Options

```yaml
# report-config.yaml (optional — sensible defaults used if absent)
title: "Report Title"
subtitle: "Subtitle"
date: "March 2026"
document_class: book        # book | report
paper: a4paper
font_size: 11pt
colour_scheme: professional # professional | academic | government | corporate
bibliography_style: authoryear-comp
include_wardley: true
include_infographics: true
include_index: true
include_glossary: true
max_research_agents: 8
nano_banana_iterations: 3
review_agents: 4
```

### Colour Schemes

| Scheme | Primary | Accent | Background | Use Case |
|--------|---------|--------|------------|----------|
| `professional` | Navy #0B2545 | Cyan #00D4FF | White | Government, consultancy |
| `academic` | Dark blue #1B4F72 | Green #1E8449 | White | Research papers |
| `government` | Black #1C1C1C | Red #C0392B | White | Policy documents |
| `corporate` | Blue #2471A3 | Gold #F39C12 | White | Business reports |

---

## Integration with Other Skills

This skill composes with:

| Skill | Integration |
|-------|------------|
| `latex-documents` | LaTeX compilation, bibliography management |
| `perplexity-research` | Real-time web research with citations |
| `ui-ux-pro-max` | Professional design guidance for infographics and layout |
| `build-with-quality` | Quality gates, TDD for Python scripts |
| `sparc-methodology` | SPARC phases for structured development |
| `swarm-orchestration` | Hierarchical mesh swarm coordination |
| `hooks-automation` | Pre/post task hooks for quality checks |
| `memory` | Persistent cross-session learning |

---

## Troubleshooting

### LaTeX won't compile
```bash
# Check for errors
grep "^!" main.log | head -10
# Common: missing package → install with pacman/tlmgr
# Common: undefined glossary entry → add \newacronym in main.tex
# Common: broken \includegraphics → run asset audit
```

### Nano Banana returns 403/quota error
- Requires a **billing-enabled** Google AI Studio account
- Free tier has zero quota for image generation models
- Fallback: use clean TikZ/Mermaid originals (still professional quality)

### Biber can't find citations
```bash
# Check .bcf file includes all bib resources
grep "datasource" main.bcf
# Ensure \addbibresource{} for each .bib file in main.tex
```

### Python figures fail to generate
```bash
# Use venv with clean PYTHONPATH
PYTHONPATH="" /opt/venv/bin/python3 scripts/generate_figures.py
```

---

## Example Output

The skill was developed and validated by producing a **129-page report** on the UK water sector:
- 11 main chapters + 8 appendix chapters
- 22 figures (17 Python charts + 5 Nano Banana infographics)
- 170+ bibliography entries
- 35+ data tables
- 3 Wardley maps, causal loop diagram, system architecture diagrams
- Full index, glossary, list of figures/tables
- 4 review iterations with data corrections

See `/home/devuser/workspace/waterworks/report/` for the complete example.

---

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `scripts/preflight.py` | Check all prerequisites and API keys |
| `scripts/generate_figures.py` | Template for Python chart generation |
| `scripts/nano_banana_pipeline.py` | TikZ/Mermaid → infographic pipeline |
| `scripts/compile_report.sh` | Full LaTeX build pipeline with verification |
| `scripts/asset_audit.sh` | Check all figures referenced and present |
| `scripts/init_report.py` | Initialize new report from template |

## Resources

- `resources/templates/main_template.tex` — LaTeX master template
- `resources/templates/chapter_template.tex` — Chapter template
- `resources/templates/colour_schemes.yaml` — Colour palette definitions

## Advanced Topics

Advanced usage (`docs/ADVANCED.md` when present):
- Custom Wardley map macros
- Multi-report series management
- Automated periodic report generation
- Integration with GitHub Actions for CI/CD compilation
