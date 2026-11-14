# Refine mode: improving a paper that already exists

Use this when there is a draft or a submitted paper and the question is
whether it can be made better. Nothing here needs the outline, plotting or
literature steps.

## 0. Ground rules

- The original source tree is read-only. Extract the paper at a named commit
  into a scratch directory (`git archive <commit> <paths> | tar -x`) and work
  there. Record the commit in the report.
- A submitted paper has a fixed text. The output of this mode is a candidate
  and the evidence for or against it. Replacing a submission is the author's
  decision, and on arXiv a replacement is a new public version.
- Decisions the author has already recorded (what was deliberately left out,
  which reviewer requests were declined) are inputs. Search memory for them
  before the first review, and give them to the reviewer as "author decisions,
  do not re-litigate".

## 1. Reproduce the baseline

Build the copy with the paper's **own** build command, not a bare `latexmk`.
A ledger-built paper prints placeholder markers if compiled directly. Confirm:

```bash
pdfinfo original.pdf | grep Pages ; pdfinfo rebuilt.pdf | grep Pages
pdftotext original.pdf a.txt ; pdftotext rebuilt.pdf b.txt ; sha256sum a.txt b.txt
```

Matching text hashes mean every later comparison is against exactly what was
submitted. If they differ, stop and find out why before anything else.

## 2. Gate the baseline

Run against the **built** tree (after substitution), so the gates see what the
reader sees:

```bash
paper-orchestra arxiv-preflight --source build/ --main main.tex --log build/main.log --json gates/preflight.json
paper-orchestra orphan-cites build/ refs.bib
paper-orchestra reverse-outline --paper build/ --out gates/reverse_outline.md --json gates/reverse_outline.json
```

and the evidence gate against the **source** tree, where the macros still are:

```bash
# results ledger (preferred): every \ledger{id} must resolve; typed numbers are findings
paper-orchestra claim-evidence --paper paper/ --ledger facts/ledger.json --macro ledger \
    --out gates/claim_evidence.json --out-md gates/claim_evidence.md
# or a markdown experimental log
paper-orchestra claim-evidence --paper paper/ --log experimental_log.md --out gates/claim_evidence.json
```

Gate findings are facts about the submitted text. Report them even if the
loop below changes nothing.

`needs evidence` does not mean wrong. A constant in a proof, a parameter value
(a 95% interval, a noise rate, a threshold) or a number derived from two
ledger entries is legitimately absent. Read each row; the count that matters
is the rows that are results. On a ledger-built paper that count is usually
zero, and saying so is a finding worth reporting.

## 3. Score the baseline

One reviewer call with [reviewer-rubric.md](reviewer-rubric.md), given the
built text (or the PDF), the reverse outline, the gate findings and the
author-decisions list. One devil's-advocate call
([refinement.md](refinement.md#devils-advocate)). Save `iter0/review.json`,
`iter0/score.json`, `da_concessions.json`. Scores need `overall_score` and
`axis_scores.<axis>.score` for every axis; `score-delta` and `score-trajectory`
refuse a file without them (exit 3). Concession severities are `critical`,
`major` or `minor` in any case, and `round` is an integer.

For a long paper (over about 30 pages) give the reviewer the full text; do not
summarise it first. A reviewer scoring a summary scores the summariser.

## 4. Loop

Follow [refinement.md](refinement.md). For a multi-file paper the revision
edits the section files in the copy, keeps every results macro intact, and
rebuilds with the paper's own build command. A revision that makes the build
fail, an id unresolved or a gate regress is reverted before it is scored.

Expect most of the gain in the first iteration. A mature paper often halts at
iteration one or two with a small delta; that is a result, not a failure.

## 5. Judge blind

[autoraters.md](autoraters.md): original against refined, both orders, judges
that did not take part in the loop. The loop's own score trajectory is not
evidence of improvement on its own, because the same rubric that guided the
revision produced the score.

## 6. Report

- Baseline identity: commit, page count, text hash.
- Gate findings on the baseline, then on the candidate.
- Score trajectory (`paper-orchestra score-trajectory --scores-dir refinement`, reading `iter<N>/score.json`) and each decision.
- Blind verdicts in both orders, and whether they agree.
- A diff of the source, grouped by reviewer weakness addressed.
- What the reviewer asked for that was declined, and why.
- A plain answer: better, not better, or better only in named respects.
