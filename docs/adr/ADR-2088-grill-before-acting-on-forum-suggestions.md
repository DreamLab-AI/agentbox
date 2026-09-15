---
id: ADR-2088
title: JunkieJarvis grills the author before acting on an unclear forum item
date: 2026-09-15
decision_status: proposed
implementation_status: complete
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit:
verified_paths: [management-api/lib/junkiejarvis-clarify.js, management-api/lib/junkiejarvis-agent.js, scripts/dream-forum-suggestions.mjs, tests/sovereign/junkiejarvis-clarify.test.js, tests/sovereign/junkiejarvis-dm-send.test.js]
owner: jjohare
review_trigger: any change to the clarity signals, MIN_SPECIFICITY, the 7-day expiry, or the forum-suggestions ingest path
repo: agentbox
---

# ADR-2088 — JunkieJarvis grills the author before acting on an unclear forum item

## Context

The nightly forum-suggestions tenant (`scripts/dream-forum-suggestions.mjs`) mines the
community feature-suggestions thread, triages each new post with GLM-5.3, queues the
verdict as a dream-cycle handoff and replies in-thread as JunkieJarvis.

Every post got triaged, however thin. "it's broken, please fix" produced a confident
verdict, a ledger row and a public reply — all of it a guess at what the member meant.
The triage brain cannot ask a question; it can only decide. So an under-specified item
either consumed an engineering night on the wrong thing or was rejected for vagueness the
member was never given the chance to fix.

## Decision

**An item whose actionable detail is unclear is never acted on.** Before triage, the
post passes `assessClarity` in `management-api/lib/junkiejarvis-clarify.js`. It fails
when any of four deterministic signals is absent: reproduction steps (required only of
something that reads as a defect report), a named surface or platform, an unambiguous
target, or a composite specificity score at or above `MIN_SPECIFICITY`. No model is
consulted — the gate must give the same verdict for the same text, every night.

**A failing item earns a DM, not a verdict.** JunkieJarvis sends the author 1–3
concrete questions — one per missing signal, in the fixed priority order repro → target →
surface → specificity — as a NIP-17 DM gift-wrapped per NIP-59.

**The item is parked, visibly.** It is recorded as `awaiting-clarification` in the
tenant's state file with the question set, the author's pubkey and the DM's event id, and
a matching row lands in `docs/dream-cycle/FORUM-SUGGESTIONS.md` so a human reading the
ledger sees what was asked and why nothing happened.

**It resumes only on a reply from that pubkey.** An inbound gift wrap is matched to a
parked item by author, plus either an e-tag reference to the clarification DM or a
timestamp after it; the oldest parked item wins when an author has several. The reply is
appended to the original text and **the same clarity check is re-run**. Replying is not a
free pass: a waffly reply leaves the item unclear.

**One DM per item, ever.** An item that has been asked once is never asked again, whatever
its status. A member is grilled, not nagged.

**Seven days of silence expires the item to `stale`.** A stale item is neither acted on
nor re-asked, and a late reply cannot revive it.

**Gift-wrapped DMs are built in exactly one place.** `sendGiftWrappedDm` was lifted out
of `JunkieJarvisAgent._sendDm` (which now delegates to it) and exported, with
`unwrapDmRumor` as its mirror. The tenant reuses both. No cryptography was written here:
`nip59.wrapEvent`/`unwrapEvent` from `nostr-tools` do the sealing, as before.

**Gated by `[sovereign_mesh].junkiejarvis_clarify_before_acting`, default `true`**, with
`JUNKIEJARVIS_CLARIFY_BEFORE_ACTING` as the runtime override per the mesh convention
(ADR-030). It is a flat key inside the existing section, not a `[junkiejarvis]` table:
`agentbox.toml` is read by a line-based parser with no inline tables
(`management-api/adapters/manifest-loader.js`), and a top-level table would repeat the
gate-key misalignment ADR-028 had to correct.

**Scope: the ingest path only.** The agent's live DM and kind-42 mention paths answer
freely, unchanged. Interrogating someone mid-conversation would be the wrong behaviour;
this gate exists because the *nightly* path acts without a human in the loop.

## Consequences

- Throughput drops on purpose. A thread of one-line suggestions now produces DMs and
  parked rows instead of handoffs. That is the point: the ledger stops carrying rows
  nobody can act on.
- The gate is heuristic and will be wrong at the margin. A terse but perfectly clear
  suggestion can draw a question, and a verbose vague one can slip through. The failure
  mode was chosen deliberately: a needless question costs a member ten seconds, a wrong
  action costs an engineering night. The signals are four small named predicates with
  table tests, so tuning is a reviewable edit rather than prompt archaeology.
- The tenant now reads inbound gift wraps addressed to JunkieJarvis on every run. This
  is an authenticated read on the existing bridge with the existing key — no new door —
  but it does mean the nightly job decrypts DMs it did not previously look at. Wraps that
  match no parked item are discarded without inspection beyond the match.
- `MIN_SPECIFICITY = 0.45`, `MAX_QUESTIONS = 3` and the 7-day expiry are numbers, not
  principles. They are named exported constants, asserted directly by tests.
- A member who never replies gets no outcome at all — no reply in-thread, no rejection.
  Silence in, silence out. If that proves unkind in practice, the honest fix is a
  `stale` in-thread notice, which this ADR does not ship.

## Verification

Against the uncommitted working tree, with `jest` from `management-api/`:

- `junkiejarvis-clarify.test.js` — `assessClarity — table`: ten labelled cases covering a
  vague one-liner, a pronoun-only target, repro-without-surface, surface-without-repro, a
  complete bug report, a clear feature suggestion, an over-terse suggestion, empty and
  whitespace-only content, and long rambling with no concrete anchor.
- `is deterministic — same input, same output` and `never throws on malformed input`
  (null, undefined, `{}`, non-string content, a bare string) — the gate is total.
- `MIN_SPECIFICITY is the documented threshold` — the floor asserted on both sides.
- `question order follows the fixed priority repro > target > surface > specificity` and
  `is deduplicated and stable`.
- `rate limit: one clarification DM per item` — a second `openClarification` leaves
  `dmCount` at 1 and the original DM event id in place.
- `expireStale flips to stale exactly after 7 days, not before`, and
  `applyReply on an expired item does not resume it`.
- `matchReplyToPending` — by pubkey, by e-tag from an older clock, rejecting a different
  pubkey, rejecting a pre-DM reply, rejecting clarified/stale items, and
  `picks the OLDEST matching pending item when the author has several`.
- `clarify-before-acting lifecycle` — the whole sequence: unclear → DM → parked → reply →
  clear → actionable; `silence for 7 days ends in stale, never in action`; and
  `a reply that is still vague does not unlock action`.
- `junkiejarvis-dm-send.test.js` — `wraps a kind-14 rumor p-tagged to the recipient and
  publishes it raw` (the wrap is published with a pass-through signer, never re-signed),
  `fails open: a publish error returns null rather than throwing`, and the four refusal
  cases; plus `unwrapDmRumor` returning the rumor and failing open to null.
- `junkiejarvis-agent.test.js` passes unchanged, which is the evidence that lifting
  `_sendDm` into `sendGiftWrappedDm` preserved the agent's DM behaviour.

`activation_status: inactive` — `[sovereign_mesh].junkiejarvis = false` in the running
manifest, so the forum agent and its nightly tenant are not live in this container. The
gate defaults on and will apply the moment the tenant runs.
