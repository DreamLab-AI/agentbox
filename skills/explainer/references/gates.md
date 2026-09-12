# The five gates

Adapted from Repo-Explainer's gates A–E. The headline score is the **lowest** gate; the
bundle is not linked from the docs index until every gate the delivery contract requires is
green. Which gates those are comes from the contract, not from this table's defaults: a
contract that names videos makes D required, and a docs bundle with no knowledge base makes
A inapplicable. Decide the required set when the contract is accepted, write it down, and do
not renegotiate it when a gate turns red.

| Gate | What it checks | Bar | How |
|---|---|---|---|
| **A — Knowledge base** | each question in `kb/questions/{tuned,heldout}.jsonl` answered from the `<repo>-kb` namespace via `memory_search`; retrieval scores on `wantPaths` (0.6 top-1 + 0.4 any-top-k), correctness on `mustContain` coverage minus `forbidden` penalty; per-question = 100·(0.4·M1 + 0.6·M2) | every stage ≥ 95, overall ≥ 98, both sets | `kb/grade.mjs` |
| **B — Comprehension** | a fresh agent (no access to the authoring session) role-plays one audience on the rendered output and must: say what it is; name three concrete uses; recite the first concrete step; confirm each hard concept has a visual | yes on all four, all audiences | manual; record in `gates/ledgers/audit-<audience>.md` |
| **C — Consistency** | every ledger line resolves to a `file:line` that still says it; built / blocked / deferred matches the README status; links resolve; no invented route, flag, status or command | pass / fail | `scripts/check-ledger.sh`, `scripts/check-links.sh`, then a reader — for the microsite, mechanised by `scripts/voice-lint.sh`, the target build, an independent link-range check and `scripts/anatomy-coverage.mjs` (see below) |
| **D — Media** | audio / video teaches a true beginner, and every clip answers the chapter it sits in | required when the accepted delivery contract names media, out of scope when it does not | scene-by-scene review, plus `evals/grade-run.mjs` for imported media |
| **E — Visuals** | each hard concept has an accurate diagram that renders where the reader reads (GitHub mermaid and the page) | pass / fail | reader |

## Ledger format

One file per document in `gates/ledgers/`, header stating the date and commit, then

```
| # | Claim | Evidence |
| 1 | <the claim as the document states it> | `path:line[-line]` |
```

Add a "Gaps the draft exposed" section when a ledger contradicts another document or
the README: those lines are debug items, hand them to whatever audit is running.

## The fail-below-bar loop

Diagnose each failing question or check into one bucket, apply the smallest fix, re-run:

- **R-fail** (wrong passages retrieved): chunking or a missing primer passage — no rewrite of the document.
- **C-fail** (right passage, fact missing): an ingestion gap — widen the include rule, re-ingest that tree.
- **O-fail** (orientation/synthesis gap): a thin section — edit that section of the document.

Cap at five iterations; if still red, the bar is wrong or the product is undocumented in
that area, and either is a finding worth writing down.

In an unattended production run the caps are per gate and lower: three attempts for a
lint, build, range or link failure, two for an independent checker's issue list, and none
for a cold-reader failure or a reproduced product defect. Record each attempt with
`scripts/handup.mjs attempt`, which refuses a retry that changed nothing; at the cap, or
on a refusal, write a packet (`scripts/handup.mjs write`) and move to work the packet
does not block. `references/handup.md` has the triggers and the reply verdicts.

## What the steps cost, and how to budget them

A budget exists to stop a step digging, not to stop it working. Set too tight it does the
opposite: it ends honest work at the moment of finishing and leaves a hand-up packet saying
nothing more useful than "time ran out". A seven-chapter pack measured on 12 September, on a
local model, cost this:

| Step | Measured | Note |
|---|---|---|
| Orientation | 20 min, 61 tool calls | one for the whole pack, before any chapter |
| One chapter | 8 to 32 min, median 17 | the spread is the subject, not the model |
| Reading surface | over 40 | hit its ceiling |
| Diagrams, all chapters | over 60 | hit its ceiling |
| Captures | over 45 | hit its ceiling |
| Narration, all chapters | over 45 | hit its ceiling |
| Gates, all chapters | over 45, 107 tool calls | hit its ceiling |

The shape is plain. A step that writes one chapter has a bounded job and finishes. A step
that touches every chapter costs roughly in proportion to how many there are, and a flat
budget that suited two chapters starves seven. Verifying the pack turned out to be the
single most expensive step in it, which is worth knowing before promising a delivery date.

So budget per chapter, not per step: give a whole-pack step something like twenty minutes
plus a quarter of an hour per chapter, and a single-chapter step three quarters of an hour.
Round up. The cost of a generous budget is that a genuinely stuck step takes longer to
declare itself; the cost of a tight one is that you cannot tell the stuck steps from the
finishing ones, and every packet says the same thing.

## The microsite gate, mechanised (2026-09-09)

A microsite chapter ships only when all four hold; the first, second and fourth are scripts,
the third is an agent with the brief and the chapter and nothing else:

1. `scripts/voice-lint.sh [--allow <product vocabulary>] chapters/*.md` prints `hits=0` for
   every chapter (self-reference, evidence vocabulary, fix history, hedges, trust adjectives,
   media, slop). The allow file lists the engagement's own product phrases so a system that
   really has an audit hash chain can say so; phrases, never bare words.
2. The target's build passes: every `src:path#Lx-Ly` path exists, every range is inside its
   file, every chapter link is in the chapter map.
3. An independent checker opened every linked range and confirmed it supports its sentence,
   grepped every named identifier, and found the "must cover" list addressed.
4. `scripts/anatomy-coverage.mjs --repo R --chapters DIR --dirs … --routes … --compose …
   --records …` reports no uncovered anchor, or the omissions are listed deliberately.

These sit inside gate C for the microsite; B (a cold reader can answer the seven questions)
and E (diagrams) are judged as before. `references/microsite/reader-voice.md` explains why
the lint exists and what it caught.
