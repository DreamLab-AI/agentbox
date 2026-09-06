---
id: ADR-2017
title: Learning consumers may never be enabled ahead of their producer
date: 2026-08-31
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: cbe7335b9
owner: jjohare
review_trigger: feed_routing is flipped on, or the memory_learning gate set changes
repo: agentbox
domain: LEARNING-memory
lineage: "legacy ADR-036 D6, PRD-020."
---

# ADR-2017 — Learning consumers may never be enabled ahead of their producer

## Context
The effectiveness aggregates that the retrieval and routing consumers read are
produced by the trajectory-recording hook (ADR-2015). Enabling a consumer while
`record_trajectories` is off gives it no corpus: it runs, reads nothing, and
silently returns inert results — a configuration that looks live but is not
(ADR-036 D6). A manifest with all learning gates off must remain byte-identical to
the pre-learning product.

## Decision
`feed_retrieval` and `feed_routing` must not be `true` while `record_trajectories`
is `false`. The config validator raises **W066** on that inversion, naming the
offending consumer(s). Each learning script is additionally self-gating on its own
env flag, so a default-off manifest ships the pre-learning behaviour exactly. The intended ordering is an operator policy today: W066 is advisory and does
not prevent that manifest passing validation (see the dated closeout extension).

## Consequences
- Ordering is diagnosed at config time; enforcement remains a closeout requirement.
- Enabling learning is a deliberate two-step: producer first, then consumers.
- The validator must be kept in sync with the gate names; a renamed gate needs a
  W066 update (review_trigger).
- The intended policy would prohibit preview against a retained corpus with the
  producer off; the current independent gates do not impose that restriction.

## Verification
Historical verification at commit cbe7335b9 asserted complete implementation. It
established the presence of the diagnostic, not a blocking exit. Original evidence:
`scripts/agentbox-config-validate.js:1341-1359` implements W066 — `consumersOn =
ml.feed_retrieval === true || ml.feed_routing === true` and, when
`ml.record_trajectories !== true`, emits code `W066` naming `which`.
`mcp/servers/lib/ruvector-gates.js:37-39` exposes the `recordTrajectories`,
`feedRetrieval`, `feedRouting` self-gates. activation_status = live:
`feed_retrieval` flipped on 2026-08-31; `feed_routing` remains gated pending a
post-flip observation window.

## Closeout extension — 2026-09-04

CP-01/07/08. Owner remains jjohare with learning/runtime maintainers. Five actual-validator fixtures all exit zero: retrieval-only, routing-only and both consumers with recording off emit W066; all-off and producer-on controls do not. The diagnostic does not enforce this ADR's prohibition. Implementation is partial; the accepted ordering policy and historical activation declaration remain, without a fresh deployment certification.

The actual hybrid factory, with injected pool/embedding stubs, applies an effectiveness bonus from an invented existing aggregate while recording is off, with the master learning flag both off and on. This is a helper-boundary result, not proof that every exposed server route admits that configuration. Turning capture off does not imply an empty durable corpus. The recorder itself checks both master and recording flags.

**Acceptance condition:** Decide whether producer-before-consumer means active capture, a valid retained corpus, or both. Enforce the chosen invariant at validation and runtime admission, including environment overrides and already-running processes. Cover master-off/consumer-on, each consumer separately, stopped capture with retained aggregates, missing/stale corpus, restart and rollback. Bind readiness to provenance, freshness and the existing recall/sample requirements; do not infer readiness solely from a producer flag. Reopen on any gate, hook registration, validator or aggregate lifecycle change. See the [review](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/learning-evidence.md#producer-ordering-is-advisory) and [reproducer receipt](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/evidence/learning-order-probe.json). No database or deployed configuration changed.

## Acceptance progress — 2026-09-05

**The invariant is chosen and stated.** Producer-before-consumer means a
**qualified retained corpus**, not merely active capture. Neither obvious reading
survives on its own. "Active capture" is too strong: stopping the recorder does
not erase the aggregates it already produced, and forbidding their reuse would
discard a corpus that is still valid — which is exactly why the old warning's
claim that consumers "have no corpus" was too broad. "Any retained corpus" is too
weak: that is the degenerate state the review found, where a consumer scores
against whatever happens to be in the table with nobody having decided it is fit
to use.

A consumer is admitted iff (1) the master learning gate is on, (2) its own gate
is on, and (3) either the producer is currently capturing, **or** an operator has
named a retained-corpus acceptance receipt *and* that corpus is non-empty,
dateable and fresher than the configured bound. There is no boolean that means
"trust me": an operator must say *which* corpus they accepted, and the runtime
checks it.

**Enforced at both boundaries, from one decision.**
`ruvector-gates.consumerAdmission()` is the single admission decision.

*Runtime.* `applyEffectivenessBonus` no longer checks the bare gate — the exact
defect the review reproduced, where an invented retained aggregate raised 0.5 to
0.58 with recording off and the master flag both off and on. It now pre-flights
the admission and then **re-decides with the corpus it just read**, so freshness
and emptiness are measured rather than assumed. A withheld bonus records
`components.effectiveness_bonus_withheld` with the reason; an applied one records
`effectiveness_admission` and the corpus receipt. `memOrient`'s aggregates bucket
obeys the same decision. Because the check runs per call rather than at boot, an
**environment override on an already-running process** is caught.

*Validation.* W066 was advisory and three consumer-before-producer manifests
exited zero. It is now split: **E066 blocks** a consumer ahead of the producer
with no accepted corpus; **W066 stays advisory** for the legitimate accepted-
corpus case, which must remain visible because nothing is replenishing that
corpus and it ages out; **E067 blocks** a consumer behind an off master gate. The
manifest schema gains `retained_corpus_accepted` and
`retained_corpus_max_age_days`, and the entrypoint projects them into the
`.mcp.json` gate env.

**Tests and results.**
`tests/sovereign/learning-consumer-admission.test.js` — 22 pass, 0 fail, covering
the whole matrix the ADR names: master-off/consumer-on, consumer-gate-off, active
capture, stopped capture with and without acceptance, stale/empty/undateable
corpora each with a distinct reason, the max-age override (it tightens, it cannot
bypass), each consumer decided separately, the bonus arithmetic applying only
when admitted, and the five validator cases including the clean producer-on and
all-off controls.

**Receipts.**
`docs/estate-closeout/2026-09-05/adr-2017-consumer-admission.json`.

**Governed paths changed.** `mcp/servers/lib/ruvector-gates.js`,
`mcp/servers/lib/memory-hybrid.js`, `scripts/agentbox-config-validate.js`,
`schema/agentbox.toml.schema.json`, `config/entrypoint-unified.sh`,
`tests/sovereign/learning-consumer-admission.test.js` (new).

**Remaining.** Readiness is bound to provenance and freshness but **not yet to a
recall receipt**: the acceptance receipt is an operator string, not a link to an
ADR-2018 run, and it is not verified against the corpus it names. Restart and
rollback are covered by the per-call check rather than by an explicit lifecycle.
`implementation_status` stays `partial` until readiness is bound to the recall
and sample requirements together.
