# Autoraters: did the paper get better?

The refinement loop's own scores cannot answer this, because the rubric that
scored the draft also steered the revision. The answer comes from a blind
side-by-side comparison by judges that took no part in the loop.

## Side-by-side paper quality

Prompt: [prompt-sxs-paper-quality.md](prompt-sxs-paper-quality.md) (verbatim,
Appendix F.3). The judge receives two papers labelled `paper_1` and `paper_2`
and returns an analysis of each, a justification and a winner: `paper_1`,
`paper_2` or `tie`.

### Protocol

1. **Blind the inputs.** Give the judge two text files with neutral names.
   Nothing in the file names, the prompt or the surrounding message says which
   is the original. Remove build stamps and dates that differ between them.
2. **Both orders.** Run every judge twice, once with the original as
   `paper_1` and once as `paper_2`. Language models favour a position; a
   verdict that flips with the order is a tie.
3. **Fresh judges.** Each run is a new subagent with no access to the loop's
   reviews, worklog or diff.
4. **More than one judge.** Three judges in both orders is six verdicts. When
   the result will be relied on (replacing a public submission), at least one
   judge is a different model family, through the consultant tools. A paper
   that is not yet public is not sent to an outside service without the
   author's agreement.
5. **Replace the frame sentence.** The prompt's opening names conference
   reviewing; add: "These are arXiv preprints with no page limit. Do not
   prefer a paper for being shorter or longer."

### Reading the result

| Outcome over all order-balanced pairs | Conclusion |
|---|---|
| Refined wins a clear majority, no judge prefers the original in both orders | Better |
| Mostly ties, or verdicts flip with order | No detectable difference |
| Any judge prefers the original in both orders | Not better; read that judge's reasons |

Report the raw verdicts, not only the conclusion. Two long papers that differ
in a few paragraphs will usually tie on a whole-paper comparison. In that case
also compare the changed sections alone, with the same protocol, and report
both levels.

## Literature-review quality

Prompt: [prompt-litreview-quality.md](prompt-litreview-quality.md). Scores an
Introduction and Related Work on six axes with hard caps. Use it in Write mode
after step 3, and in Refine mode only when the related-work section was
changed.

## Not included

Upstream's Citation F1 rater and its benchmark-building skill score a
generated paper against the reference list of a known human-written paper.
They measure the method on a benchmark, not a paper being written, so they are
not part of this skill.
