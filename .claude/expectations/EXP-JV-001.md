---
id: EXP-JV-001
parent_spec: user-feedback-2026-09-15 "Jarvis should DM person raising issues to grill on unclear detail before taking action"
linked_adrs: [ADR-2088, ADR-2030]
priority: high
regression_critical: true
evidence_category: executable
status: proposed
authored_by: agent
---

## Expectation: JunkieJarvis DMs the author clarifying questions and refuses to act when a forum item's actionable detail is unclear

When the nightly forum-suggestions tenant ingests a forum post, `assessClarity` (`management-api/lib/junkiejarvis-clarify.js`) returns `clear: false` with a non-empty `missing` drawn from `['repro','target','surface','specificity']` whenever the post lacks reproduction steps *and reads as a defect report*, lacks a named surface, lacks an unambiguous target, or scores below `MIN_SPECIFICITY` (0.45) — deterministically, with no model call, and returning "unclear" rather than throwing on null/undefined/non-string input. An unclear item is NOT triaged and NOT queued as an actionable handoff: `scripts/dream-forum-suggestions.mjs` instead sends the author a NIP-17 DM gift-wrapped by `sendGiftWrappedDm` (the single `nip59.wrapEvent` site, reused by `JunkieJarvisAgent._sendDm`) carrying 1–3 questions in the fixed priority order repro → target → surface → specificity, records the item as `awaiting-clarification` in the tenant state with the question set, the author pubkey and the DM's event id, and writes a matching `awaiting-clarification` row to `docs/dream-cycle/FORUM-SUGGESTIONS.md`. It resumes only when a gift wrap from that same pubkey arrives carrying either an e-tag to the clarification DM or a timestamp at/after it (`matchReplyToPending`, oldest parked item first), whereupon the reply is appended to the original text (`composeForRecheck`) and the identical clarity check re-runs. Exactly one clarification DM is ever sent per item (`shouldSendClarification` is false forever once parked), and 7 days without a reply (`CLARIFY_EXPIRY_MS`) flips the item to `stale`, after which it is neither actioned nor revivable. The whole gate is controlled by `[sovereign_mesh].junkiejarvis_clarify_before_acting` (default true) with `JUNKIEJARVIS_CLARIFY_BEFORE_ACTING` as the runtime override; an unparseable env value falls through to the manifest rather than failing closed.

### In scope
- The deterministic clarity check and its four signals, as pure table-tested functions
- Question generation: 1–3 questions, fixed priority, deduplicated
- The `awaiting-clarification` → `clarified` / `stale` state machine, including the one-DM rate limit and the 7-day expiry
- Reply matching by pubkey + e-tag/timestamp, and the re-check with the reply appended
- The shared NIP-59 gift-wrap send/unwrap helpers, including fail-open on publish failure
- The manifest gate, its default, and the env override

### Out of scope (intentionally)
- The agent's LIVE conversational paths (kind-1059 DMs and kind-42 mentions to `JunkieJarvisAgent`) — those answer freely; interrogating someone mid-conversation would be the wrong behaviour
- The triage brain's action/defer/reject policy once an item IS clear — unchanged by this work
- Any in-thread public notice that an item went `stale` — silence in, silence out (noted as a consequence in ADR-2088, not shipped)
- Cryptographic correctness of NIP-59 sealing itself, which belongs to `nostr-tools`

### Counter-examples (must NOT happen)
- An unclear item reaching `triage()` or producing an `action`/`defer`/`reject` ledger row
- A second clarification DM for an item that was already asked once, including after a vague reply
- A reply from a *different* pubkey resuming a parked item
- A reply older than the clarification DM, with no e-tag reference, resuming a parked item
- A stale (>7 day) item being revived by a late reply, or being actioned anyway
- A vague reply unlocking action without the clarity check passing on the merged text
- A second gift-wrap construction site appearing outside `sendGiftWrappedDm`
- The gate throwing (rather than returning "unclear") on malformed post content, or a DM publish failure crashing the nightly run
- The gate defaulting to OFF when the manifest is absent or unreadable
