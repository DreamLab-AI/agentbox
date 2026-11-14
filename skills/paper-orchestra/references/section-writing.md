# Step 4: section writing

One call writes every section that step 3 did not: the abstract, method,
experiments, results, discussion, limitations, availability and conclusion.
The paper is explicit that this is a single call, not one per section, so the
sections agree with each other. Prompt:
[prompt-section-writing.md](prompt-section-writing.md), with the anti-leakage
prompt prepended.

## Inputs to the call

- `outline.json` (reconciled)
- `inputs/idea.md`, `inputs/experimental_log.md`
- `drafts/intro_relwork.tex`, kept verbatim
- `refs.bib` and the pool abstracts
- the figure files themselves and `figures/captions.json`
- the `latex-documents` template `templates/arxiv/arxiv-preprint.tex`

Output: `drafts/paper.tex`, a complete document that compiles.

## Tables

- `booktabs` rules only: `\toprule`, `\midrule`, `\bottomrule`. No vertical
  rules.
- Every cell value is in the experimental log or the ledger.
- Numbers aligned on the decimal point; the same precision down a column.
- Best value in bold only when the difference is supported by the reported
  uncertainty, and the caption says what bold means.
- A wide table uses `tabularx` or is restructured so it fits the text width.
  An overfull table is a defect: `arxiv-preflight` reports any box more than
  5 pt too wide.
- The caption goes above a table and below a figure.

## Figures

- Each figure appears after its first reference, near it.
- Every figure and table is referenced in the text at least once and
  discussed, not merely pointed at. An unreferenced figure caps the reviewer's
  evidence score.
- `\includegraphics[width=\linewidth]{figures/<figure_id>}` with a relative
  path and no extension.

## Results ledger

When results live in a ledger (a JSON file of entries with an `id`, a `value`
and a display `text`), the paper never contains a typed result. It contains
`\ledger{id}` or `\ledger[fmt]{id}`, and the build substitutes the value and
fails on an unknown or superseded id. This is stronger than checking prose
against a log afterwards, and it is the estate's practice for its own papers.

- Write results as macros from the first draft.
- `paper-orchestra claim-evidence --paper <dir> --ledger ledger.json --macro ledger`
  then reports the two things the build cannot: a result typed by hand, and a
  macro whose id is unknown.
- A number derived from two entries (a difference, a ratio) becomes its own
  ledger entry rather than arithmetic in the prose.

## arXiv adjustments to the upstream prompt

- "The tone of a top-tier ML conference paper" becomes: precise, plain,
  UK English, written for a reader who will check the claims.
- A limitations section is required, not "nice to have".
- Add a data and code availability statement naming the commit or release
  the results were generated from.
- No page limit: do not compress an argument to save space, and do not pad.

## After the call

```bash
paper-orchestra orphan-cites workspace/drafts/paper.tex workspace/refs.bib
paper-orchestra anti-leakage workspace/drafts/paper.tex
paper-orchestra claim-evidence --paper workspace/drafts/paper.tex \
    --log workspace/inputs/experimental_log.md --out workspace/claim_evidence.json
```

`orphan-cites` and `anti-leakage` block: fix and re-run. `claim-evidence`
warns: its `needs evidence` rows go to the first refinement iteration.
Compile with `latex-documents`.
