# PaperBanana × Report Builder Integration

PaperBanana complements the report-builder skill pipeline:

1. **Report Builder Phase 3 (Write)** — generates raw TikZ/Mermaid diagrams
2. **PaperBanana** — upgrades key figures to publication-quality using the VLM pipeline
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
