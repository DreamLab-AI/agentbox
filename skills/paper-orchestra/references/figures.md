# Step 2: figures

Execute `outline.plotting_plan`: one figure per entry, plus a caption each.
This step owns the plan and the checks. The drawing is done with tools the
estate already has.

## Who draws what

| `plot_type` | Tool |
|---|---|
| `plot` | matplotlib in the baked Python, one script per figure, saved beside the output as `figures/<figure_id>.py`. Vector PDF output. |
| `diagram` | `diagram-design` for a publication figure, or `mermaid-diagrams` for a flow that should stay as source. TikZ in the paper is fine for a simple schematic. |

Upstream's PaperBanana renderer and its graphviz helper are not used here.

## Rules for a plot

- **Every plotted value comes from `experimental_log.md` or the ledger.** The
  script reads the numbers from a data block copied from the log, with the log
  line cited in a comment. No value is typed from memory, smoothed or
  extrapolated.
- One message per figure. If the objective needs "and", it is two figures.
- Size from the aspect ratio at a 6.5 inch text width (single column):
  `figsize=(6.5, 6.5 * h / w)`. Fonts 8 to 10 pt at final size, so the text
  matches the body.
- Uncertainty is shown whenever the log has it (interval, standard deviation,
  range), and the caption says which.
- Colour is not the only encoding: vary marker or line style as well. Use a
  colour-blind-safe palette.
- Axis labels carry units. No chart title inside the figure; the caption is
  the title.
- Save PDF for charts. PNG only for raster content, at 300 dpi or more.

## Captions

`figures/captions.json`: `{ "<figure_id>": "<caption>" }`. A caption states
what is plotted, the conditions (n, dataset, seeds), what the error bars are,
and the one thing the reader should see. It does not claim a result the figure
does not show.

## Check each figure by looking at it

Render and view every figure (the Read tool shows PDFs and PNGs). Check: no
overlapping labels, no clipped text, legend not covering data, readable at the
size it will print. Redraw rather than describe a defect in the caption.

Optionally, a second model critiques each figure against its objective and the
script is revised, at most three rounds. Stop as soon as a round finds nothing
actionable.

## Existing figures

Anything in `inputs/figures/` matching a planned `figure_id` is used as is and
only captioned. Unused figure files are removed before packaging: arXiv asks
for no extraneous files, and `arxiv-preflight` lists them.
