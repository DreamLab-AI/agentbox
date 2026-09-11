# Hand-up: escalating a red gate to a stronger tier

The production run of an explainer is meant to be done by a local model, in the
background, for hours, at GPU cost only. That model will sometimes be unable to turn a
red gate green, and the wrong responses are the two extremes: retrying the same thing
until the cap, or dragging a cloud model into the whole session. Hand-up is the middle
path. The unit of escalation is a **packet on disk** that a stronger tier can answer
from a cold start, never a shared transcript. `scripts/handup.mjs` writes, lists,
answers and audits packets; this file says when and why.

## Tiers

| Tier | Who | Cost | Does |
|---|---|---|---|
| T0 | the production model (today Qwen through the Loom, OpenCode profile `loom-agent/current`), in a resumable session | GPU time | drafting, checking, retries, specialist orchestration |
| T1 | the controller: a Claude Code session polling the queue (default), or Codex | cloud tokens, one packet at a time | judge, unblock, minimal fix, guidance back to T0 |
| T2 | the user | attention | product-code changes, budget overruns, contract changes |

One controller per run, named in the production record at launch. T0 never calls a
cloud model itself. The controller is a poller (`handup.mjs list --pending`), typically
a Claude Code `/loop` on the production record, so the cloud side costs nothing while
the queue is empty.

## When to hand up

| Trigger | Detected by | T0 does first | Then hand up to |
|---|---|---|---|
| voice-lint hits, build error, range outside its file, dead link | scripts, exit code | retries with a changed prompt, fact sheet or range; cap 3 | T1, `reason=lint-cap` / `build-cap` |
| independent checker returns an issue list | the checker | reviser pass; cap 2 | T1, `checker-cap` |
| anatomy coverage lists an uncovered anchor | script | covers it or lists the omission deliberately | T1 only if the anchor's source cannot be located |
| a fresh reader cannot answer the seven questions (gate B) | cold reader | nothing: this needs judgement | T1, `gate-b`: bar wrong or content wrong |
| a load-bearing claim stays `needs_evidence` | ledger check | one more search of source, tests, design records | T1, `needs-evidence` |
| a specialist is unavailable or its job ends in error | missing receipt, error state | resumes the handle once; never resubmits blindly | T1, `specialist` |
| a prerequisite cannot be satisfied: no data to photograph, no fixture, a service that will not start | twenty minutes on one sub-goal with no artefact to show for it | states what is missing and what it tried | T1, `prerequisite` |
| the same gate stays red with no change between attempts | `handup.mjs attempt` refuses the identical retry | nothing | T1, `stall` |
| a product defect is reproduced | T0, per the hub's stop-before-fixing rule | records diagnosis and proposed correction, marks the chapter blocked, continues independent work | T2, `product-defect`, always |
| a cap on tokens, wall clock or hand-ups per chapter is reached | controller | nothing | T2, `budget` |

The prerequisite row is the one that costs most when it is ignored. A run measured on
2026-09-10 wrote two chapters in forty minutes and then spent two hours trying to seed a
database so that a screenshot would have something to show, and finished with no media at
all. Nothing was failing; each step looked like the next reasonable thing. The rule is
therefore a clock, not a judgement: **twenty minutes on one sub-goal with nothing to show
is a hand-up**, whatever the model believes about the next command. Say what is missing,
what was tried, and what would unblock it, then move to the next chapter.

Three rules make the table work. **An identical retry is not an attempt**: before each
retry T0 records what it changed with `handup.mjs attempt`, and the tool refuses to
count a retry whose chapter hash equals the last one. **Blocked is a valid end state**:
an unattended run may finish with chapters blocked on T2, and that is the correct
outcome, not a failure of the run.

## The packet

`<record>/handup/<id>.json`, written once by T0 and never edited:

```
{
  "id": "delegation-2",
  "tier_requested": "T1",
  "reason": "checker-cap",
  "ask": "judge",
  "question": "Does the ADR's delegation table or the policy module decide the minimum level for schema changes? The two disagree at the cited lines.",
  "gate": { "name": "C.checker", "output": "attempts/delegation/3/checker.md" },
  "artifacts": { "chapter": "chapters/04-delegation.md", "fact_sheet": "facts/delegation.md", "diff_of_attempts": "attempts/delegation/diff.patch" },
  "attempts": [ { "n": 1, "changed": "cited the ADR table", "result": "checker: policy module contradicts" }, … ],
  "resume": { "harness": "opencode", "session": "ses_…", "model": "qwen3.8-27b-heretic-q8_0" },
  "budget_spent": { "tokens": 41200, "wall_seconds": 1910 },
  "blocks": ["chapters/05-recovery.md"]
}
```

`ask` is exactly one of `fix` (make the minimum edit), `decide` (choose between named
options), `unblock` (infrastructure or access), `judge` (is the gate or the content
wrong). Every path is relative to the production record, so the higher tier reads only
what the packet names. A good packet is a few thousand tokens against a session of
hundreds of thousands; that ratio is the point.

## The reply

`<record>/handup/<id>.reply.json`, written by the controller:

| verdict | meaning | T0 then |
|---|---|---|
| `resolved` | T1 made the minimum edit; `files` lists what changed and why | re-runs the gate on the edited chapter |
| `guidance` | `guidance` text T0 must apply on the next attempt | receives it as the next turn of its session (`handup.mjs resume`) |
| `override` | the bar was wrong here; the gate is accepted with `note` as the reason | records the override in the ledger and moves on |
| `blocked` | needs T2; the chapter stays blocked | continues chapters not in `blocks` |

A reply may carry a `lesson`: a candidate change to the skill. It stays in the
production record. Only the skill-improvement loop promotes lessons into the skill, and
only when the lesson changes a future decision. The run never edits the skill.

While a packet is open T0 works on chapters not listed in `blocks`, polls for the reply
between chapters, and after the configured wait marks the chapter blocked and carries
on. T1 fixes the minimum and hands back; a controller that rewrites a chapter wholesale
has taken the run over, which is the token waste the design exists to avoid.

## What the A/B loop reads from this

`handup.mjs stats` reports hand-ups per chapter, the reason mix, the tier mix and tokens
by tier. Across old and candidate versions of the skill at equal gate results, the better
skill is the one that hands up less and later. That is the objective measure of "works
on the local model alone", and it belongs in the benchmark next to the assertion scores.
