---
id: ADR-2088
title: JunkieJarvis grills the author before acting on an unclear forum item
date: 2026-09-15
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 66425f9bd07206fe6e8f7215625ece1aa7e31eb8
verified_paths: [management-api/lib/junkiejarvis-clarify.js, management-api/lib/junkiejarvis-agent.js, management-api/server.js, scripts/dream-forum-suggestions.mjs, scripts/run-junkiejarvis.cjs, tests/sovereign/junkiejarvis-clarify.test.js, tests/sovereign/junkiejarvis-dm-send.test.js, tests/sovereign/dream-forum-suggestions-jj-gate.test.js]
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

**Gift-wrapped DMs are built in exactly one place — on this surface.**
`sendGiftWrappedDm` was lifted out of `JunkieJarvisAgent._sendDm` (which now delegates to
it) and exported, with `unwrapDmRumor` as its mirror. The tenant reuses both. No
cryptography was written here: `nip59.wrapEvent`/`unwrapEvent` from `nostr-tools` do the
sealing, as before. This is deliberately a claim about the JunkieJarvis surface only —
`per-user-agent.js`, `nostr-live-mirror.cjs` and the nostr-gateway each still hold their
own `nip59` call site, and consolidating them is work this ADR does not do.

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

`activation_status: staged` (2026-10-02) — the nightly tenant runs and the gate holds every unclear
post, but no author is grilled while `[sovereign_mesh].junkiejarvis = false`: the DM leg waits
for JunkieJarvis to be switched on (owner decision 2026-10-02, Q10; see the Disposition). The
checkout now sets `junkiejarvis = true` (R1); the running box reads the manifest baked into
`/etc/agentbox.toml`, so the DM leg goes live at the next image rebuild.

## Disposition — 2026-10-02

- **Suitability:** fits
- **Priority:** P1 — this cycle (settle the proposed-ADR census, TODO "Proposed decision records")
- **Why:** The gate is in effect even though `activation_status` says otherwise. The dream engine runs `scripts/dream-forum-suggestions.mjs` (`services/dream-engine/src/engine.rs:328`), the clarify gate defaults on (`agentbox.toml:64`), and `docs/dream-cycle/FORUM-SUGGESTIONS.md` carries four `awaiting-clarification` rows (`f818f07ec` 2026-09-25, `12532c7b2` 2026-10-01). `[sovereign_mesh].junkiejarvis = false` (`agentbox.toml:51`) switches off the live agent, not the nightly tenant, so the record's statement that "the forum agent and its nightly tenant are not live" is overtaken.
- **Next:** Ready to accept on those ledger rows. Correct `activation_status` from `inactive` to `live` when it is accepted. **Accepted — owner decision 2026-10-02, Q8**, but `activation_status` is set to `staged`, not `live`: the ledger rows above were the Q10 bug, and once it was fixed no author is grilled while `junkiejarvis = false` (the hold leg runs nightly; the DM leg waits for JunkieJarvis).
- **Bug fixed — owner decision 2026-10-02, Q10:** the four DMs above were not intended. They were sent because the container env carries `JUNKIEJARVIS_ENABLED=true`, and the tenant honoured only the clarify gate, never the JunkieJarvis gate. The live agent's start rule (`management-api/server.js:1399-1405`) is "env beats manifest", so it started too ("junkiejarvis: started", 2026-10-02 14:57Z). The tenant now asks `junkiejarvisEnabled()` (`management-api/lib/junkiejarvis-clarify.js`) before any clarifying DM. That reads ADR-030 D2's "requires both" as: an explicit `junkiejarvis = false` wins over the env, `true` can be vetoed by `JUNKIEJARVIS_ENABLED=false`, and with the key absent the env decides. With the gate off, an unclear post is **held**: no DM, no ledger row, not parked, not marked replied, so it is asked once JunkieJarvis is on. Test first: `tests/sovereign/dream-forum-suggestions-jj-gate.test.js` runs the real script against stub relay and signer modules; it was red (DM sent with `junkiejarvis = false`) before the fix. The engine runs the script from the checkout (`services/dream-engine/src/engine.rs:326-328`), so the fix needs no rebuild. Still open: the tenant's public in-thread replies and the live agent itself still follow the env, and changing them is a separate decision.
- **Manifest is the only switch — owner decision 2026-10-02, R1:** `junkiejarvis = false` was wrong; `agentbox.toml` now sets `junkiejarvis = true`, and the `JUNKIEJARVIS_ENABLED` override is gone. `junkiejarvisEnabled(manifest)` (`management-api/lib/junkiejarvis-clarify.js`) is `[sovereign_mesh].junkiejarvis === true` and reads no env; `management-api/server.js` uses it for the live agent, `startJunkieJarvis({ manifest })` (`management-api/lib/junkiejarvis-agent.js`) checks it instead of the env, `scripts/run-junkiejarvis.cjs` loads the manifest rather than forcing the env on, and `.env.example` no longer lists the variable. This closes half of the "still open" item above: the live agent and the tenant's clarifying DMs both follow the manifest. The tenant's public in-thread replies were never gated by JunkieJarvis at all (they read neither the env nor the manifest; `scripts/dream-forum-suggestions.mjs` checks `jjOn` only before a DM); gating them is still a separate decision. It replaces archived ADR-030 D2's "env var is the runtime override" for JunkieJarvis (the archive is frozen, so the record is amended here). Tests first: the manifest-decides, env-ignored cases in `tests/sovereign/junkiejarvis-clarify.test.js`, `tests/sovereign/junkiejarvis-agent.test.js` and `tests/sovereign/dream-forum-suggestions-jj-gate.test.js` were red before the change. Effect needs an image rebuild: `/etc/agentbox.toml` and management-api are baked into the Nix store; until then the running agent still starts from the host `.env`'s `JUNKIEJARVIS_ENABLED=true` and the tenant still holds DMs on the baked `false`.

## Re-verification — 2026-10-02 (`66425f9bd07206fe6e8f7215625ece1aa7e31eb8`)

Tripped by `management-api/server.js`, whose change is one added mount block for
`routes/chain.js` (`/v1/chain/info`, ADR-2098 amendment) after the URI resolver. No line of the
JunkieJarvis start path changed; it moved down by thirteen lines (`junkiejarvisEnabled(manifest)`
is now at `management-api/server.js:1410-1411`). `tests/sovereign/` under jest (56 suites, 854
passed, 3 skipped), including the three JunkieJarvis suites this record governs, pass at this
commit. Decision and status unchanged.
