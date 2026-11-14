# Write mode: from idea and results to an arXiv paper

The six steps of the method. Steps 2 and 3 are independent and run in
parallel; everything else is sequential because each step reads the last
step's output.

## Inputs

```bash
paper-orchestra init --out workspace/
# put the inputs in workspace/inputs/, then:
paper-orchestra validate-inputs --workspace workspace/
paper-orchestra consistency --idea workspace/inputs/idea.md --log workspace/inputs/experimental_log.md
```

| File | Required | Content |
|---|---|---|
| `inputs/idea.md` | yes | The idea: problem, method, what is claimed. Sparse (a page) or dense (with equations and design detail). |
| `inputs/experimental_log.md` | yes | Set-up, every raw number, qualitative observations. This is the only source of results. |
| `inputs/figures/` | no | Figures that already exist. Anything missing is generated in step 2. |

There is no template or guidelines input. The template is
the `latex-documents` template `templates/arxiv/arxiv-preprint.tex` and the rules are
[arxiv.md](arxiv.md).

`validate-inputs` blocks on a missing file or an idea or log too thin to
write from. `consistency` only warns (a method named in the idea that never
appears in the log, for example); show the warnings and continue.

If the results live in a ledger rather than a log, keep the ledger as the
source and write the paper with result macros from the start. See
[section-writing.md](section-writing.md#results-ledger).

If the inputs do not exist yet but the work does (in session history, memory
or a repository), write `idea.md` and `experimental_log.md` from those sources
first, quoting each number with the file and line it came from, and have the
author confirm them. A number with no source is left out of the log.

## Workspace

```
workspace/
  inputs/                 idea.md, experimental_log.md, figures/
  outline.json            step 1
  figures/                step 2: <figure_id>.pdf|png, captions.json
  citation_pool.json      step 3: verified references with abstracts
  refs.bib                step 3
  drafts/intro_relwork.tex   step 3
  drafts/paper.tex        step 4
  refinement/             step 5: iter0..iterN, worklog.json, da_concessions.json
  final/                  accepted source, PDF, arXiv package
```

## Steps

**1. Outline** (one call). [outline.md](outline.md). Output `outline.json`;
`paper-orchestra validate-outline workspace/outline.json` must pass before
anything else runs, because every later step reads this file.

**2. Figures** and **3. Literature review**, in parallel. Spawn two
subagents, one per step, each given only its part of the outline
(`plotting_plan`, `intro_related_work_plan`) and the inputs. A host without
parallel subagents runs step 3 first (it is the slower one).
[figures.md](figures.md), [literature-review.md](literature-review.md).

**3.5 Reconcile the outline.** The literature found is rarely the literature
planned. Before writing, revise `related_work_strategy` and the
`citation_hints` in `section_plan` so they name papers that are in
`citation_pool.json`, drop clusters with no verified papers, and re-run
`validate-outline`. Keep the original as `outline.planned.json`; show the
author what changed. Skip this if the pool is empty.

**4. Section writing** (one call for the whole body).
[section-writing.md](section-writing.md). Then the gates:

```bash
paper-orchestra orphan-cites workspace/drafts/paper.tex workspace/refs.bib
paper-orchestra anti-leakage workspace/drafts/paper.tex
paper-orchestra claim-evidence --paper workspace/drafts/paper.tex \
    --log workspace/inputs/experimental_log.md --out workspace/claim_evidence.json
```

Compile with `latex-documents` (`latexmk -pdf`). A compile error is fixed
there, not by rewriting prose.

**5. Refinement.** [refinement.md](refinement.md). Up to three iterations.

**6. arXiv.** [arxiv.md](arxiv.md): `arxiv-preflight`, `prose-sanitiser`,
package, then the author submits.

## Budget

About 60 to 70 model calls for a full run in the source paper's measurements:
one for the outline, 20 to 30 each for figures and literature, one for section
writing, five to seven for refinement. Refine mode alone is the last line.

## Report

Path to the PDF and the package, sections written, references verified and
cited, the refinement trajectory, every gate that failed along the way and how
it was resolved, and every reviewer request that was declined.
