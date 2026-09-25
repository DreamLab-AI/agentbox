---
id: ADR-2110
title: Learn skill routing from the skills the main model actually uses, recorded as local embeddings
date: 2026-09-23
decision_status: proposed
implementation_status: partial
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: de84739eea73bdbeffa595f57c1a5d71fd77f630
verified_paths: [config/hooks/routing-label-recorder.cjs, config/hooks/lib/routing-labels.cjs, tests/config/routing-labels.test.js]
owner: jjohare
review_trigger: acceptance or rejection of this proposal; the first 30 days of recorded labels; a learned router measured against the frozen corpus; any change to what the label row stores
repo: agentbox
domain: LEARNING-memory
---

# ADR-2110 — Learn skill routing from the skills the main model actually uses (PROPOSAL)

> **Status: PROPOSED — an outline for review.** The recorder described in the Decision is
> built and tested, but it is gated off (`[skills.routing].label_log = false`), and it stays
> off until this record is accepted. Sections marked *open* need an operator decision.

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
