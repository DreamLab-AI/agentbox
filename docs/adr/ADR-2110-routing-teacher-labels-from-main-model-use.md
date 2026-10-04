---
id: ADR-2110
title: Learn skill routing from the skills the main model actually uses, recorded as local embeddings
date: 2026-09-23
decision_status: rejected
implementation_status: partial
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: 275e12356319a9630846656580d497d53de3d38c
verified_paths: [config/hooks/routing-label-recorder.cjs, config/hooks/lib/routing-labels.cjs, tests/config/routing-labels.test.js, scripts/experiments/exp-b8-label-log.cjs, tests/config/exp-b8-label-log.test.js]
owner: jjohare
review_trigger: the EXP-B8 stopping rule firing (510 analysable rows or 2026-10-20) and its verdict PR; the first 30 days of recorded labels; a learned router measured against the frozen corpus; any change to what the label row stores
repo: agentbox
domain: LEARNING-memory
---

# ADR-2110 — Learn skill routing from the skills the main model actually uses

> **Status: ACCEPTED for a bounded experiment, LIVE since 2026-10-02** (owner decision
> 2026-10-02 R5b). `[skills.routing].label_log = true` runs as the pre-registered experiment
> EXP-B8 (`docs/experiments/EXP-B8-label-log.md`), which switches itself off at 510 analysable
> rows or on 2026-10-20 and records keep or withdraw here. Sections marked *open* still need an
> operator decision before the log runs again after that.

## Context

- **The claim under test.** RuVector-style online learning could remove the need for labelled
  training data up front, as long as learning under the harness has a signal to learn from.
  ADR-2095 (addendum, 2026-09-23) measured `@ruvector/typesafe` zero-shot at 62.8% against Jev's
  93.0%. Its own documentation puts parity at ≥4 labelled examples per option, and this estate has
  none.
- **Nothing can be learned today** (measured 2026-09-23):
  - The router log records the pick, but no outcome and no prompt (ADR-2090, by design).
  - `[memory_learning].feed_routing` is off.
  - `sona_learn_enabled` is blocked, because the engine is hardcoded to 256 dimensions and the
    estate's embeddings are 384.
  - SONA's ReasoningBank learns search parameters per query cluster, not class labels.
- **The signal is skewed.** Over 7.3 days: 82 routed turns a day, 80% of them `none`, 16 skill
  picks a day, 39 of 115 skills ever picked, and only 9 picked at least 4 times.
- **Only one teacher is available.** The main model chooses which skill to load. Its choice is
  imperfect, but it is the strongest routing judgement in the estate, it is free, and it is
  already in every transcript.

## Decision (proposed)

1. **Record teacher labels locally**, one row per real user turn, in `routing_labels` in the
   RuVector sidecar:
   - the prompt's bge-small embedding, computed on the LAN;
   - the skills the main model *used* (the Skill tool or a Read of a `SKILL.md`);
   - skills it only *inspected* (shell reads), kept alongside the label but never setting it;
   - the router's own pick for that turn.

   The recorder reads the transcript at `Stop`, as the trajectory recorder does.
2. **Learn in the background, not in the path.** The current judge keeps routing while labels
   accumulate, so users never see a cold-start drop in quality.
3. **Train offline; promote only on measurement.** A linear probe on the stored embeddings goes
   through `system-one-eval` against the frozen 86-case corpus and the ADR-2095 copy ceiling.
   It is adopted only if it clears both, at the same p-value discipline as the cascade.
4. **Never store prompt text.** The row carries the vector and the text's length. The rest of
   the row is fixed by construction:
   - embeddings are refused off-LAN (E077 in the manifest, and the hook itself refuses);
   - email-gateway turns are never embedded (taint fence, as in ADR-2093);
   - the session is stored only as a 12-hex digest.

## Built (gated off)

| Piece | Where |
|---|---|
| Transcript → turns → labels (pure, unit-tested) | `config/hooks/lib/routing-labels.cjs` |
| Stop hook: LAN embed, join router pick, idempotent insert, durable watermark | `config/hooks/routing-label-recorder.cjs` |
| Router log tagged with a hashed session id, only when on | `config/hooks/lib/skill-route.cjs` (`labelLog`) |
| Gate and endpoint | `agentbox.toml` `[skills.routing]` `label_log`, `label_embeddings_url`; schema |
| Validator | **E077**: non-boolean gate, or embeddings URL off the LAN |
| Boot | registers on Stop when on; de-registers when off; round trip verified byte-identical |
| Tests | `tests/config/routing-labels.test.js` (15) and the existing router suite, all green |
| Live self-test | 7 turns from a real session into a throwaway table; 384-d vectors; no prompt words in any row; table dropped |

## Options considered

- **A. Store the prompt text locally** (plain-text rows, LAN only). Rejected for the default:
  it inverts ADR-2090 and turns every routed turn into a stored copy of the conversation. It
  would allow training `@ruvector/typesafe` directly, since its `train` takes text.
- **B. Store embeddings only** (this proposal). Keeps the ADR-2090 contract close; the probe
  trains on vectors. The cost: examples cannot be re-embedded with a better model later, so a
  model change resets the label bank.
- **C. Log nothing; synthesise training data.** The LAN Loom writes about 16 paraphrases per
  skill. No retention question at all, but it measures the rubric authors' language, not users'.
  Complementary, not a substitute; see open question 4.
- **D. Online learner in the routing path (SONA / feed_routing).** Deferred: SONA is blocked by
  the dimension mismatch, and a learner in the path pays the cold-start cost in live quality.

## Open questions (operator decisions)

1. **Retention of embeddings.** Prompt embeddings can be partially inverted. Are LAN-local
   bge-small vectors acceptable under ADR-2090's intent? What retention period applies, and who
   may read the table?
2. **Label noise.** The teacher's choices are imperfect in three ways:
   - it sometimes loads a skill to *talk about* it rather than use it (the shell-read rule
     removes the observed case);
   - it follows the router's hint, which feeds back into the labels;
   - it acts on a skill's capability without loading the skill, e.g. calling ruvnet-brain's MCP
     tool directly.

   Should MCP-tool use map to the owning skill as a weaker label?
3. **Mid-turn messages.** Messages queued while the model is working are transcript
   attachments, not turns, and are not labelled today. Should they be?
4. **Tail seeding.** Should Option C seed the ~76 never-picked skills, so that a probe can
   exist for them at all?
5. **Consumer.** A probe in `system-one-eval` (Rust, on the stored vectors), or a text-trained
   typesafe engine? Option A is the prerequisite for the second.

## Measurement plan

- Weekly: label counts per skill, how often `none` occurs, and the router-vs-teacher agreement
  rate (the router's pick against the teacher label, per engine and cascade path).
- Train the probe when at least 20 skills have ≥4 used-labels. Evaluate it on the frozen corpus
  alongside Jev, openjev, BM25 and the cascade, with an exact McNemar test.
- Success criterion (to be agreed): the learned router is not significantly worse than the
  current judge on the frozen corpus **and** it cuts egress or latency.

## Consequences (if accepted)

- The retention contract gains one table of prompt vectors. ADR-2090 needs a cross-reference.
- The claim that RuVector learns over time becomes testable here, with a stopping rule, rather
  than argued.
- Each Stop costs one LAN embedding call per new turn, plus one insert.

## Verification

`npx jest tests/config/routing-labels.test.js tests/config/skill-route.test.js` passes 49/49.
The live self-test used `AGENTBOX_ROUTING_LABELS_TABLE=routing_labels_selftest` on a real
session transcript, and the table was dropped afterwards. The manifest validates with the gate
off.

## Re-verification — 2026-09-26 at 6ea592ee0 (ADR-2111/2116 landing)

**Anchor artefact, no drift.** This record and its three governed paths landed together in `4794ab229`. Its `verified_commit` was set to `de84739ee`, an earlier ancestor at which none of the paths existed yet, so the gate flagged the record's own creation. `git log 4794ab229..HEAD` over the three paths is empty. Around them, `b25903ec8` switched the router hook to the honoured `hookSpecificOutput` shape and to the registered-skill scope (ADR-2091 note of this date). The recorder's join key is unaffected: the hashed `session` tag is still written only with `label_log`, and log lines now also carry `scope`. The entrypoint's Stop registration/de-registration (`_RL_HOOK`, timeout 15 s) is as described. The gate is still `label_log = false`. Tests: `jest tests/config/routing-labels.test.js tests/config/skill-route.test.js` → 57 passed (49 at landing; the router suite grew). Status fields unchanged (proposed / partial / inactive). Claim STILL TRUE.

## Disposition — 2026-10-02

- **Suitability:** fits
- **Priority:** P3 — parked (review trigger: the CY-B8 ADR-2095 measurement against the ADR-2094 façade reports)
- **Why:** The recorder is built, tested (49/49) and gated off (`agentbox.toml:990`, `label_log = false`). Nothing is lost by leaving it switched off. The record continues the typed-decision and routing line (ADR-2091, ADR-2094, ADR-2095) that planning cycle §1 calls "chasing itself". It was filed on 2026-09-23, after the cycle's rule against new records came into force. Track B item 8 is the one run meant to turn that programme into either a closed leaf or a falsified hypothesis. CY-B8 has not started.
- **Next:** Do not enable `label_log` until B8 reports. If B8 falsifies the façade, withdraw this record. If it does not, take open question 1 (embedding retention) to the owner.

## Amendment 2026-10-02 — bounded activation as EXP-B8

**Owner decision 2026-10-02 R5b** overrides the 2 October Disposition's "do not enable until B8
reports": the label log *is* the B8 measurement. "Turn on the log and run it as a bounded test
since we might forget … turn it off once the data is statistically significant."

- **Protocol, pre-registered before any row:** `docs/experiments/EXP-B8-label-log.md`
  (`fa3f3c045`). Judge against the ADR-2095 copy ceiling, both scored against the teacher label;
  one exact McNemar test; MDE 5 points; n = 510 (Connor 1987, ψ = 14/86); stop at n or
  2026-10-20; verdict → keep / withdraw table.
- **Copy-ceiling arm:** with `label_log` on, the router hook scores the same candidate map with
  its own BM25 ranker and logs `bm25_pick`/`bm25_score` beside the judge's pick; the recorder
  joins them into two nullable columns (`config/hooks/lib/skill-route.cjs`, `routing-labels.cjs`,
  `routing-label-recorder.cjs`, `be358df7b`).
- **Live without a rebuild.** The image bakes both the manifest and `/opt/agentbox/config/hooks`,
  so a checkout flip alone does nothing until a rebuild. `scripts/experiments/exp-b8-label-log.cjs`,
  ticked every 30 minutes from `skills/podcast-knowledge-ingest/crontab` (read from the checkout),
  registers the router hook (with `AGENTBOX_SKILL_ROUTE_LABEL_LOG=1`) and the Stop recorder from
  the checkout while the checkout manifest says `true`, and restores the entrypoint's off state
  exactly at the stop. A rebuild with `label_log = true` registers the same hooks from the image;
  the tick replaces them idempotently.
- **Auto-stop:** at the stopping rule the tick records the stop, de-registers both hooks, runs
  the one test, writes the report, opens a pull request that sets `label_log = false` and
  appends the verdict to this record (never merged, never forced), and posts one plain-English
  summary as JunkieJarvis in the dream digest's channel. The post is at-most-once: the attempt
  is saved immediately before the event is sent, so neither a failed send nor a crash can post
  twice; a refusal with nothing sent (no signer, no zone key: never posted in plaintext) is not
  an attempt and is retried. A no-post check (`--check-post`, 2026-10-02) resolved the write plan
  for the digest section as `encrypt` (zone4, key held).
- **Privacy bound.** ADR-2090 licenses egress of the routing prompt to the judge; it says
  nothing about storing it. The storage bound is this record's Decision 4 (no prompt text; the
  row holds the vector and the text's length) and ADR-2091 point 7 (the router log "never holds
  the prompt"). EXP-B8 adds to the log line and the row only a skill name and a BM25 score,
  which reveal no more than the router pick already logged. Enforced by
  `tests/config/routing-labels.test.js` ("the persisted row carries the vector and the length,
  never the text") and `tests/config/skill-route.test.js` ("the shadow is recorded on a failed
  judge call too, and never the prompt").
- **Verification:** `npx jest tests/config/exp-b8-label-log.test.js tests/config/routing-labels.test.js
  tests/config/skill-route.test.js` → 99 passed; `node --test tests/system-one/cascade-parity.test.mjs`
  → 4 passed (the ranker's picks unchanged). Live: a throwaway table received a 384-d row with the
  two new columns and no text (dropped); the checkout hook logged `bm25_pick: diagrams-as-code`
  beside the judge's `diagrams-as-code`.

## Disposition — 2026-10-02 (owner decision R5b)

- **Suitability:** fits
- **Priority:** P1 — running (bounded)
- **Why:** The owner chose to run the measurement rather than park the record. EXP-B8 is the
  CY-B8 run on live traffic, with its sample size and stop fixed before the first row.
- **Next:** The EXP-B8 tick fires the stop by 2026-10-20 at the latest and opens the verdict PR.
  KEEP → take open question 1 (embedding retention) to the owner. WITHDRAW or INCONCLUSIVE →
  this record becomes rejected.

## Re-verification — 2026-10-03 (`275e12356319a9630846656580d497d53de3d38c`)

Tripped by custody X-1 step 1, W2 (`custody/w2-env-scrub`: `0965a9c8c`, `042115499`, `275e12356`; bypass 3, ROLE secrets out of PID 1's environment). `scripts/experiments/exp-b8-label-log.cjs` reads the JunkieJarvis key through the ROLE-secret loader; with the flag off its pre-W2 read (env, then the repo `.env` via `zone-keys.readSetting`) is kept as is. Label recording is untouched (`tests/config/exp-b8-label-log.test.js` 34/34). The decision holds.
Re-verified by `git diff c7b5d5f55..275e12356 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.

## Disposition — 2026-10-04 (EXP-B8 verdict)

- **Verdict:** WITHDRAW. Judge 433/513 (84.4%) against the BM25 copy ceiling 500/513 (97.5%); discordant b = 4, c = 71; exact McNemar p = 6.81e-17.
- **Stop:** the sample of 510 was reached; written by `scripts/experiments/exp-b8-label-log.cjs` under the pre-registered protocol `docs/experiments/EXP-B8-label-log.md` (owner decision 2026-10-02 R5b). Report: `docs/experiments/EXP-B8-report.md`.
- **Action:** `label_log = false`; decision_status `rejected`, activation_status `inactive`. ADR-2110 is withdrawn (rejected): the judge did not beat its copy ceiling on live turns, so the routing premise of the façade programme is falsified at this effect size.
