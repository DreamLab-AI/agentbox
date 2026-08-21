# PaperBanana Pipeline Architecture

PaperBanana uses a two-phase multi-agent pipeline.

## Phase 0: Input Optimisation (optional, `--optimize`)
- **Context Enricher** — structures raw methodology text into clear components
- **Caption Sharpener** — refines visual specifications for the generator

## Phase 1: Linear Planning
- **Retriever** — selects relevant reference examples from 13 curated academic diagrams
- **Planner** — generates a detailed textual description via in-context learning
- **Stylist** — refines for visual aesthetics (NeurIPS/ICML guidelines)

## Phase 2: Iterative Refinement
- **Visualiser** — renders the description into an image
- **Critic** — evaluates faithfulness, readability, conciseness, aesthetics
- Repeats for N iterations or until the critic is satisfied (`--auto`)

## Evaluation Dimensions

PaperBanana's built-in critic evaluates on four dimensions:

| Dimension | Weight | Description |
|-----------|--------|-------------|
| **Faithfulness** | Primary | Does the diagram accurately represent the source text? |
| **Readability** | Primary | Is the diagram clear and easy to understand? |
| **Conciseness** | Secondary | Is the diagram free of unnecessary elements? |
| **Aesthetics** | Secondary | Does it follow academic publication conventions? |
