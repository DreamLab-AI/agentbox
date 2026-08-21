---
name: fossflow
description: >
  Generate isometric network-topology, infrastructure, and architecture diagrams
  as FossFLOW JSON (compact LLM-optimised format or full verbose SVG/JSON with
  zones and labels). Trigger on "isometric diagram", "network topology diagram",
  "FossFLOW", "infrastructure map", "architecture visualisation", or converting a
  network/cloud (AWS/Azure/GCP/Kubernetes) layout into an importable diagram.
  NOT for flowcharts, sequence, or other Mermaid-supported diagrams (use
  mermaid-diagrams), academic publication figures (use paperbanana), or general
  architecture prose docs (use report-builder).
---

# FossFLOW Diagram Generator

Generate isometric network and architecture diagrams for FossFLOW visualisation.
Two input formats: **compact** (token-efficient, for LLM generation) and
**verbose** (full features — zones, styled connectors, labels).

## When Not To Use

- Standard flowcharts, sequence diagrams, or Mermaid-supported types → mermaid-diagrams skill
- Academic publication figures → paperbanana skill
- General architecture documentation → report-builder skill

## Workflow

1. Pick a format — compact for quick LLM-generated topologies, verbose when you need
   zones, coloured/labelled connectors, or text boxes. Full specs, keys, connector
   properties, positioning grid, and the colour palette: **[references/formats.md](references/formats.md)**.
2. Choose icons (1,062 available: ISOFLOW basics + `aws-`/`azure-`/`gcp-`/`k8s-` prefixed
   catalogues) and the purpose→icon quick map: **[references/icons.md](references/icons.md)**.
3. Adapt a worked example — compact network, AWS serverless, verbose zoned data centre:
   **[references/examples.md](references/examples.md)**. Starter templates live in
   `resources/templates/` (`three-tier.json`, `microservices.json`).
4. Validate against the format checklist, run/import in FossFLOW, and troubleshoot:
   **[references/validation.md](references/validation.md)**.

## Scripts

- `scripts/generate-diagram.js` — build/emit a diagram (compact or verbose) programmatically.
- `scripts/validate-diagram.js` — validate a diagram file against the format rules.
- `scripts/screenshot-verify.sh` / `scripts/playwright-verify.js` — render and visually verify a diagram.

## Reference index

| Need | File |
|------|------|
| Format specs, keys, connector props, positioning, colours | [references/formats.md](references/formats.md) |
| Full 1,062-icon catalogue + purpose→icon map | [references/icons.md](references/icons.md) |
| Worked examples (compact & verbose) | [references/examples.md](references/examples.md) |
| Validation checklist, running FossFLOW, troubleshooting | [references/validation.md](references/validation.md) |
