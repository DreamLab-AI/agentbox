# Step 1: the outline

One call turns the idea and the experimental log into a single JSON object
that drives every later step. Prompt: [prompt-outline.md](prompt-outline.md)
(verbatim from the paper's Appendix F.1), with the anti-leakage prompt
prepended. Where that prompt mentions `template.tex` and
`conference_guidelines.md`, supply [../assets/arxiv-template.tex](../assets/arxiv-template.tex)
and the "Format" section of [arxiv.md](arxiv.md).

A complete example is [../assets/outline.example.json](../assets/outline.example.json).

## Shape

```json
{
  "plotting_plan": [ FigureSpec ],
  "intro_related_work_plan": {
    "introduction_strategy": { "hook_hypothesis": "", "problem_gap_hypothesis": "", "search_directions": [""] },
    "related_work_strategy": { "overview": "", "subsections": [ RelatedWorkCluster ] }
  },
  "section_plan": [ SectionSpec ]
}
```

**FigureSpec**

| Field | Rule |
|---|---|
| `figure_id` | `^[a-z0-9_]+$`, prefixed `fig_`, meaningful (`fig_main_results`, never `fig_1`), no `figure` after the prefix |
| `title` | short |
| `plot_type` | `plot` (a chart of numbers) or `diagram` (a concept or architecture) |
| `data_source` | `idea.md`, `experimental_log.md` or `both` |
| `objective` | what the figure shows; for a `plot` it must name the chart type ("Bar chart comparing ...") |
| `aspect_ratio` | one of `1:1 1:4 2:3 3:2 3:4 4:1 4:3 4:5 5:4 9:16 16:9 21:9` |

**RelatedWorkCluster**: `subsection_title`, `methodology_cluster`,
`sota_investigation_mission`, `limitation_hypothesis`,
`limitation_search_queries` (array), `bridge_to_our_method`.

**SectionSpec**: `section_title`, `subsections`: each with `subsection_title`,
`content_bullets` (array) and `citation_hints` (array, may be empty).

## Rules the validator enforces

`paper-orchestra validate-outline outline.json` reports each failure with its
JSON path.

1. The three top-level keys are present; an unknown key anywhere is an error.
2. `plotting_plan` and `section_plan` are non-empty.
3. Every FigureSpec has all six fields with allowed values.
4. Related work has two to four clusters.
5. A section with subsections has at least two (one is a warning: fold it
   into its parent).
6. `citation_hints` is always an array.

## Citation hints

Two forms only, because step 3 uses them as search queries:

- author and exact title known: `"Vaswani et al. (Attention Is All You Need)"`
- neither known: `"research paper or technical report introducing 'AdamW optimizer'"`

Never guess an author. A wrong author sends the search to the wrong paper,
and a plausible wrong paper is how a false citation gets in.

## arXiv adjustments

- No page budget. Plan the sections the argument needs, and put proofs,
  full tables and protocol detail in appendices.
- Plan a limitations section and a data and code availability statement.
  The upstream prompt does not ask for either.
- Single-column article layout: prefer `4:3`, `3:2` and `16:9` figures.
