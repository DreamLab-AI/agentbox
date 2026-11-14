---
name: paper-orchestra
description: "Writes an arXiv research paper from an idea and experimental results, or improves an existing paper draft by simulated peer review, with claim-evidence, citation and arXiv preflight gates. Use when turning results into a preprint, when asked to review, refine, strengthen or sanity-check a paper before or after submission, or to compare two drafts side by side. Not for fixing a LaTeX compile or Beamer (latex-documents), a researched white paper (report-builder) or a book manuscript (book-publishing)."
license: MIT
compatibility: "Claude Code and Codex. Steps 2 and 3 and the blind judges run as parallel subagents under Claude Code; a Codex session runs them one after another in the same session. Needs the paper-orchestra binary (skill-tools) and TeX Live, both baked."
metadata:
  upstream: "https://github.com/Ar9av/PaperOrchestra"
  upstream_commit: "6a319132932ee031e2d759b0f7f5075cf77bd1cf"
  method: "Song et al., PaperOrchestra, arXiv:2604.05018"
related_skills:
  - latex-documents
  - web-researcher
  - deep-research
  - prose-sanitiser
  - diagram-design
  - mermaid-diagrams
  - book-publishing
  - report-builder
---

# Paper Orchestra

The PaperOrchestra method (Song et al., arXiv:2604.05018) as one estate skill,
tuned for the only target this estate publishes papers to: arXiv. It adds what
the existing paper skills do not have (a structured outline, evidence-grounded
writing, a reviewer loop with deterministic halt rules, blind side-by-side
judging and an arXiv preflight) and hands everything else to the skill that
already owns it.

## Two entry points

| You have | Mode | Start at |
|---|---|---|
| An idea and results, no paper yet | **Write** | [references/pipeline.md](references/pipeline.md) |
| A draft or a submitted paper | **Refine** | [references/existing-paper.md](references/existing-paper.md) |

Refine is the common case here. It never needs the outline, plotting or
literature steps, and it works on a multi-file paper in place (a copy of it).

## What this skill owns, and what it delegates

| Concern | Owner |
|---|---|
| Outline schema, section plan, citation plan | this skill ([references/outline.md](references/outline.md)) |
| Numbers match the evidence (experimental log or results ledger) | this skill (`paper-orchestra claim-evidence`) |
| Citation rules: title match above 70, cutoff date, coverage, no orphans | this skill ([references/literature-review.md](references/literature-review.md)) |
| Reviewer loop, halt rules, devil's advocate, critique memory | this skill ([references/refinement.md](references/refinement.md)) |
| Blind side-by-side comparison of two drafts | this skill ([references/autoraters.md](references/autoraters.md)) |
| arXiv source and metadata checks | this skill ([references/arxiv.md](references/arxiv.md)) |
| Compiling, packages, compile errors, Beamer | `latex-documents` |
| Finding papers and checking that a citation exists | `web-researcher` (`academic_search`, `verify_citation`, `audit_bibliography`); `deep-research` for a wide survey |
| Conceptual diagrams | `diagram-design`, `mermaid-diagrams` |
| AI writing tells, UK English, hidden characters | `prose-sanitiser` |
| A book or memoir-class manuscript | `book-publishing` |
| A researched white paper or policy brief | `report-builder` |

Do not reimplement a delegated concern inside a paper run. Load the owning
skill and follow it.

## The helper binary

`paper-orchestra` is on PATH (built from `services/skill-tools`). Every gate
below is one of its subcommands; `paper-orchestra <subcommand> --help` prints
the arguments. `--paper` accepts a single `.tex` file or a directory and follows
`\input` and `\include`.

| Subcommand | Gate | Blocks? |
|---|---|---|
| `init`, `validate-inputs`, `consistency` | workspace and input checks (Write mode) | `validate-inputs` blocks |
| `validate-outline` | outline JSON against the typed schema | blocks |
| `anti-leakage` | author names, emails and affiliations leaked from training data | blocks |
| `claim-evidence` | every number is in the log or ledger, or is cited | warns |
| `orphan-cites` | every `\cite` key exists in the `.bib` | blocks |
| `citation-coverage` | 90% of the verified pool is cited (Write mode) | warns after three tries |
| `verify-refs` | claimed title against found title, and the cutoff date | blocks per reference |
| `reverse-outline` | one line per paragraph, for the Logical Flow axis | advisory |
| `score-delta`, `decision-band`, `score-trajectory` | accept, revert or halt an iteration | decides |
| `concession-guard` | a standing critical finding overrides an accept | decides |
| `worklog`, `critique-memory` | append-only history and what the reviewer must not re-flag | bookkeeping |
| `arxiv-preflight` | source tree, bibliography, figures, abstract length, build log | blocks on errors |

A gate's verdict outranks the model's own impression of the draft. If a gate
and a reviewer disagree, the gate wins and the disagreement is reported.

## Refine mode in brief

Full procedure: [references/existing-paper.md](references/existing-paper.md).

1. **Copy, never edit in place.** Work on a copy of the paper's source at a
   named commit. A submitted paper is evidence; the original tree is read-only.
2. **Reproduce the baseline.** Build the copy with the paper's own build
   command and confirm the page count and text match the original.
3. **Run the gates on the baseline**: `arxiv-preflight`, `orphan-cites`,
   `claim-evidence`, `reverse-outline`. These findings are facts and are
   reported whether or not any rewriting follows.
4. **Score the baseline** with the reviewer rubric
   ([references/reviewer-rubric.md](references/reviewer-rubric.md)): one
   reviewer plus one devil's advocate.
5. **Loop** at most three times: revise against the review, rebuild, rescore,
   then `score-delta` and `concession-guard` decide accept, revert or halt.
6. **Judge blind.** Compare original and refined with the side-by-side prompt,
   both orders, with judges that did not write the revision.
7. **Report** the gate findings, the score trajectory, the blind verdict and a
   diff. The author decides whether to replace the submission.

## Write mode in brief

Full procedure: [references/pipeline.md](references/pipeline.md).

```
inputs: idea.md + experimental_log.md (+ figures/)
Step 1  outline            -> outline.json            validate-outline
Step 2  figures       \    -> figures/ + captions     (parallel with 3)
Step 3  literature    /    -> refs.bib + intro, related work
                                                      verify-refs, citation-coverage
Step 4  section writing    -> paper.tex               orphan-cites, claim-evidence,
                                                      anti-leakage
Step 5  refinement         -> the Refine loop above
Step 6  arXiv              -> arxiv-preflight, then package
```

The template and the formatting rules are fixed: [assets/arxiv-template.tex](assets/arxiv-template.tex)
and [references/arxiv.md](references/arxiv.md). There is no conference
template, page limit or anonymisation to configure.

## Rules that hold in both modes

- **Numbers are never typed.** A result in the prose comes from the
  experimental log or, better, a results ledger substituted at build time. A
  reviewer's request for an experiment that was not run is declined in the
  worklog, not answered with an invented number.
- **Limitations stay.** Never delete or soften a stated limitation to raise a
  score, and never add one that the evidence does not show. This reverses the
  upstream rule; the reason is in [references/refinement.md](references/refinement.md).
- **Citations are closed-world.** Only keys in the verified bibliography may be
  cited. A new reference is verified with `web-researcher` first.
- **Prepend the anti-leakage prompt** ([references/prompt-anti-leakage.md](references/prompt-anti-leakage.md))
  to every call that writes paper content.
- **The same model must not write and judge.** The final blind comparison uses
  judges that did not see the revision being made, and a different model family
  when the result will be relied on.
- **UK English**, checked with `prose-sanitiser` before the final build.

## Depth on demand

- [references/existing-paper.md](references/existing-paper.md) - Refine mode step by step, including ledger-built papers.
- [references/pipeline.md](references/pipeline.md) - Write mode: workspace layout, the six steps, parallelism.
- [references/outline.md](references/outline.md) - outline schema, allowed values, validation rules.
- [references/figures.md](references/figures.md) - plotting plan, chart conventions, captions.
- [references/literature-review.md](references/literature-review.md) - discovery with `web-researcher`, the verification rules.
- [references/section-writing.md](references/section-writing.md) - the single writing call, tables, figure placement.
- [references/refinement.md](references/refinement.md) - the loop, halt rules, devil's advocate, safe-revision rules.
- [references/reviewer-rubric.md](references/reviewer-rubric.md) - the arXiv-tuned reviewer prompt and score schema.
- [references/autoraters.md](references/autoraters.md) - blind side-by-side protocol and literature-review quality rater.
- [references/arxiv.md](references/arxiv.md) - arXiv's current rules, the preflight, metadata and packaging.
- [references/upstream.md](references/upstream.md) - what was kept, changed and dropped from upstream, and why.
- Verbatim prompts from the paper's Appendix F: [outline](references/prompt-outline.md), [literature review](references/prompt-literature-review.md), [section writing](references/prompt-section-writing.md), [refinement](references/prompt-refinement.md), [side-by-side quality](references/prompt-sxs-paper-quality.md), [literature-review quality](references/prompt-litreview-quality.md).
