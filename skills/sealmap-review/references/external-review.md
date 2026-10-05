# External review: detail

## Options

| Option | Default | Effect |
|---|---|---|
| `--lens a,b` | `critical,premortem` | lenses to run, in order; each is `assets/lenses/<name>.md` |
| `--count N` | 15 | findings each lens asks for (`{{COUNT}}` in the lens) |
| `--only <substr>` | all | packs only topic paths containing the substring, e.g. `control-plane/` |
| `--register include\|strip` | include | strip removes Tension/Debt/Drift/Open paragraphs and marker lines in diagrams; Invariants stay |
| `--out <dir>` | `.diagram-review/<UTC stamp>/` | output directory |
| `--dry-run` | off | writes the pack and manifest, estimates tokens, sends nothing |

| Variable | Default | Effect |
|---|---|---|
| `GEMINI_API_KEY` (or `GOOGLE_GEMINI_API_KEY`) | none | AI Studio key, read from the environment only. In agentbox it reaches the container from `.env` via `docker-compose.yml`. |
| `DIAGRAM_REVIEW_MODEL` | `gemini-3.8-flash` | model id on `generativelanguage.googleapis.com/v1beta` |
| `DIAGRAM_REVIEW_THINKING` | `high` | `thinkingConfig.thinkingLevel` |
| `DIAGRAM_REVIEW_TIMEOUT_MS` | 600000 | per-call timeout |

Calls that return 429 or 5xx are retried twice, with a back-off. Exit codes:
- 0: success
- 1: failure (API, budget or empty reply)
- 2: usage error

## Token budget and sharding

Gemini 3.8 Flash takes 1,048,576 input tokens and returns at most 65,536. The
script measures the pack with `countTokens` and refuses above 1,000,000. The
refusal lists the corpus's areas, so you can rerun with `--only <area>/`. Each
area review is cheaper and returns findings for that area, so for a large
corpus several area runs often find more than one whole run that has to rank
across everything. One measured reference point: a 45-topic, 2.0 MB corpus
packs to 633k tokens with markers and 549k stripped.

## Pilot measurements (2026-10-05, campaignbuilder corpus, 45 topics)

The pilot ran one review per cell, so the differences are indicative, not
significant. Recall is scored against the 30 Tensions in the corpus's
REGISTER.md, fixed with a hash before any review was read. A Claude scorer
mapped each claim, so the scorer is a different family from the reviewer.

| Prompt | Markers: full / partial Tension recall | Stripped: full / partial | Praise terms |
|---|---|---|---|
| open "give me your opinion" | 5 / 2 | 1 / 6 | 5 and 2 |
| critical lens | 6 / 5 | 4 / 3 | 0 |
| premortem lens | 3 / 1 | 1 / 3 | 0 |

- **With markers, claims are mostly known.** Nearly every specific claim
  matches an existing register item: 13 to 15 per review.
- **Stripped, the critical lens still finds things.** It rediscovered 7 Tensions
  and 10 further register items from the diagrams alone. One of them, the shared
  network bypassing the ingress header strip, was missed by every review that
  had the markers.
- **New claims checked against code.** Of 6 claims absent from the register:
  1 was real and 5 were real but overstated or unverifiable. None was wrong,
  and none was a serious new defect.
- **What overstated claims look like.** They were mostly deliberate decisions
  read as defects. A corpus that records why a decision was taken gets fewer
  of these.
- **The baked-in lenses.** End to end, they returned 33 parsed findings in
  about 3 minutes, and the second lens read 630,753 tokens from cache.

The ceiling on Tension recall is mostly the output budget: 15 findings
against 30 Tensions plus several hundred other register items. Raise `--count`,
or shard by area, when recall matters more than ranking.

## Why the lenses are written this way

- **Change the stakes, not just the tone.** "I am deciding whether to take
  responsibility for running this" drew more specific claims than "be critical".
- **Leave no slot for praise.** A fixed finding shape with no strengths section
  produced zero praise; telling the model to avoid flattery did not.
- **Report when in doubt.** Triage reproduces every finding, so a false alarm
  costs one test and a missed defect costs an incident. The lenses say so.
- **Self-labelled novelty.** "Marked by authors: yes/no" makes the reviewer
  separate rediscovery from new findings, which a scorer otherwise has to do.
- **Pack first, lens last.** Gemini's implicit cache matches a shared prefix,
  so the second and later lenses cost little more than the first.

## Cost

Each lens bills the pack tokens, the thinking tokens (9k to 15k per lens
measured) and the output tokens. Cached prefix tokens are billed at the
cache rate. Check current Gemini pricing before quoting a figure.
