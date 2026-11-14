# Content refinement: the loop and its halt rules

Step 5 of the method (arXiv:2604.05018, section 4 and Appendix F.1). The paper
attributes its largest single quality gain to this step. The loop is
deliberately conservative: it stops at the first sign that it is making the
paper worse.

## The loop

```
iter0 = the current draft, built, gated and scored
for N in 1..3:
    review   = reviewer(draft, reverse outline, gate findings, critique memory)
    da       = devil's advocate(draft, review)
    draft'   = revise(draft, review)            # prompt-refinement.md
    build draft' ; rerun the blocking gates ; a failure reverts before scoring
    score'   = reviewer scores draft'
    decision = score-delta(prev, score') then concession-guard
    worklog  append
    ACCEPT -> draft = draft' ; continue      REVERT or HALT -> stop
final = the accepted iteration with the highest overall score
```

Each iteration lives in `refinement/iter<N>/` with its source, PDF,
`review.json` and `score.json`. Use git or a plain copy for the snapshot.

## Decision rules

`paper-orchestra score-delta --prev iter<N-1>/score.json --curr iter<N>/score.json`
applies them and prints the decision; obey its exit code.

| Condition | Decision | Exit | Loop |
|---|---|---|---|
| overall rises | `ACCEPT_IMPROVED` | 0 | continue |
| overall ties, sum of axis deltas is zero or more | `ACCEPT_TIED_NON_NEGATIVE` | 0 | continue |
| overall falls | `REVERT_OVERALL_DECREASED` | 1 | roll back, halt |
| overall ties, sum of axis deltas negative | `REVERT_TIED_NEGATIVE_SUBAXIS` | 2 | roll back, halt |
| accepted, and three accepted iterations in a row each gained under 1.0 | `HALT_PLATEAU` | 4 | keep, halt |
| accepted, and overall is 80 or more | `HALT_TARGET_MET` | 5 | keep, halt |

The loop also halts when the cap of three iterations is reached, or when the
reviewer lists no weaknesses.

Decision bands (`paper-orchestra decision-band <score>`): 80 and above Accept,
65 to 79 Minor Revision, 50 to 64 Major Revision, below 50 Reject. The band is
computed from the number; a reviewer's free-text decision never overrides it.

## Devil's advocate

One reviewer is the devil's advocate. It does not look for polish. It attacks
the core claims, in this order: causal claims resting on correlation; a claimed
component with no ablation; baselines given less compute or tuning; broad
claims from narrow experiments; novelty already present in a cited work.

Each attack is a finding with a severity. A `CRITICAL` finding blocks an
accept regardless of the scores. A finding is closed only by a concession, and
a concession is valid only when the rebuttal scores 4 or 5 out of 5 (it answers
the attack with evidence that is in the paper). The advocate may concede at
most once in any two consecutive rounds.

Those rules are easy for a model to relax quietly, so they are enforced
outside it. Record findings and concessions in `refinement/da_concessions.json`
and run `paper-orchestra concession-guard` each iteration. Exit 1 means a
critical finding still stands: turn the accept into a revert and make the next
revision address that finding. Exit 2 means a concession was rejected with no
critical outstanding: the advocate restates the attack; no revert.

## Critique memory

From iteration two, run `paper-orchestra critique-memory` before the reviewer
call. It derives two lists from the worklog and the last review: `focus_on`
(flagged before, still unresolved) and `do_not_reflag` (already addressed).
Put both in the reviewer prompt verbatim. Without them the reviewer rediscovers
fixed issues and the loop spends its budget going round in circles.

## Safe-revision rules

The revision prompt is [prompt-refinement.md](prompt-refinement.md). Four rules
are enforced around it.

1. **No new experiments.** A reviewer question that needs a result not in the
   log or ledger is recorded in the worklog as declined. Rerun `claim-evidence`
   on every revised draft: a new `needs evidence` row that is a result is a
   fabrication until shown otherwise, and reverts the iteration.
2. **Limitations stay.** The upstream prompt says "never explicitly state a
   limitation". That rule exists because a benchmark agent learned to list
   missing baselines as limitations to raise an automated score. On a real
   preprint it would delete the limitations section, which is the opposite of
   what this estate's papers do. The rule here is its honest form: do not
   remove or weaken an existing limitation, and do not add one that the
   evidence does not show merely because the reviewer would like to see it. A
   limitation may be added when the reviewer has found a real one; say so in
   the worklog. When calling the revision prompt, replace that one sentence
   with this rule.
3. **Closed bibliography.** Run `orphan-cites` on every revised draft. A new
   key is allowed only after `web-researcher` `verify_citation` has confirmed
   the reference and it has been added to the `.bib`.
4. **Author decisions hold.** A point the author has already decided against
   is on the `do_not_reflag` list from the start.

## Pre-loop gates, once

- **Evidence**: `claim-evidence`. Pass the `needs evidence` rows to the first
  revision with the instruction to restate from the evidence, attribute, or
  remove; never to blur the sentence until the number is unfalsifiable.
- **Structure**: `reverse-outline`. A paragraph with no topic sentence, two
  messages or a citation dump is a reorder, merge, split or cut instruction.
  Sentence polish cannot fix an ordering problem.
- **Prose**: run `prose-sanitiser` on the draft and add its findings to the
  first revision agenda. This replaces upstream's writing-quality and
  AI-failure-mode checklists.

## Promoting the result

The accepted iteration with the highest overall score is final. After a
revert, that is the iteration before the reverted one. Print the trajectory
with `paper-orchestra score-trajectory` and put it in the report, for example
`64.5 -> 67.3 (accept) -> 67.3 (accept tied) -> 66.0 (revert, halt)`.
