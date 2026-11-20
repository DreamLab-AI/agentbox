---
id: ADR-2211
title: Events journal appends run under a cross-process lock
date: 2026-11-20
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: ba1265164ea309bd5443cfa37b3e4e8ede2ae9ab
verified_paths: [management-api/lib/journal-lock.js, management-api/adapters/events/local-jsonl.js, management-api/lib/journal-append.js, management-api/routes/exec-record.js, tests/contract/events-journal-lock.test.js]
owner: jjohare
review_trigger: Node gains a maintained flock binding in the dependency set, or a second implementation language writes the events journal
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: ADR-039 (hash-chained events log), ADR-2071 (journal the nightly dream cycle), ADR-2087 amendment (journal boundaries)
evidence_class: source+test+deployment+runtime
acceptance_boundary: Updated management API image is deployed. Seven journal/events/adapter suites pass with 121 tests and one existing todo; an isolated actual-image fixture verifies a linear 120-record chain from six concurrent processes. The ownership check is baked in the live API. No production journal repair, full-history certification or elimination of the documented takeover/check-write races is claimed.
---

# ADR-2211 — Events journal appends run under a cross-process lock

## Host activation witness — 2026-11-20 evening

Source `ba1265164ea309bd5443cfa37b3e4e8ede2ae9ab` was activated at
22:01:48 UTC. Seven related Jest suites passed (121 tests, one existing todo),
including the five lock tests and displaced-holder assertion. Six independent
writers using the actual candidate adapter produced 120 records with one
verified hash chain, inside an isolated tmpfs with no production volumes.
The deployed adapter contains `lock.assertHeld()` and the management API is
healthy. No production log was rewritten. The residual race windows and
non-persistence-on-timeout semantics in this record remain unchanged. Earlier
source-only/unbuilt paragraphs are historical; governed paths are now armed.

## Context
- `LocalJsonlEventsAdapter` is the only appender of the hash-chained events journal (`$WORKSPACE/events/*.jsonl`). It cached the chain head per instance and took no lock.
- Two writers (two processes, or two adapter instances) both extended the same head and forked `prev_hash` and `seq`. Reproduced with six concurrent processes (`tests/contract/events-journal-lock.test.js`).
- ADR-2071 avoided this by making HTTP to the management API mandatory; that was a convention, not an enforcement.
- Node has no `flock(2)` binding without a native dependency, which is not allowed.

## Decision
- Read-tail, hash and append run inside `lib/journal-lock.js`: an `O_EXCL` lockfile `<eventsDir>/.journal.lock` holding `{pid, token, ts}`.
- A waiter takes over a lock whose pid is dead, whose file stayed unreadable for 2 s, or that is older than 30 s, by atomic `rename`; a displaced live lock is put back.
- The tail is re-read from disk whenever the journal file's inode or size differs from what this instance last wrote, so another writer's records are always chained onto.
- A lock failure behaves like a failed append: nothing persisted, chain not advanced, event still delivered in-process.
- Any new appender MUST go through the adapter (or this lock). A Rust or shell writer would need the same lockfile protocol.

## Consequences
- The management API is no longer the only chain-safe writer; ADR-2071's HTTP route stays as design, not as a safety requirement.
- Crash safety is by stale takeover, not by the kernel. Residual window: two simultaneous takeovers of one dead lock plus a third creator inside microseconds can overlap once; the verifier would still report it.
- Waiting is synchronous (`Atomics.wait`), so a hung live holder stalls the waiting process for up to 15 s before the append fails.

## Verification — 2026-11-20 at `f6a87328266381a2f2f1bf6ddf7050ebd72eda49`

Stamped so the record passes the ledger lint, which exempts only `proposed` and `rejected` records from an empty `verified_commit`. The ratchet's evidence gate (`scripts/adr-ratchet.sh`) also rejected `implementation_status: complete` without `evidence_class` and `acceptance_boundary`, so both were added to the front matter (`source+test`; source and the jest suite only, nothing deployed). The body above this section was not changed. Each Decision bullet was read against the code at this commit. The lockfile `<eventsDir>/.journal.lock` (`management-api/lib/journal-lock.js:39`) holds `{pid, token, ts}` and is created with `O_EXCL` (`wx`, `:100`); the thresholds are 2 s torn, 30 s maximum hold and 15 s default wait (`:40-42`); takeover is by `rename` (`:80`); the pause is `Atomics.wait` (`:46`); the export is `withLock` (`:147`, `:158`). In `management-api/adapters/events/local-jsonl.js`, read-tail, hash and append run inside `withLock` (`:139-149`); the tail is re-read when the file's inode or size differs from what this instance last wrote (`:141-143`, signature at `:175-179`); a lock failure is caught, nothing is persisted, the chain is not advanced and the event is still returned for in-process subscribers (`:150-154`). Run: `jest --testPathPatterns events-journal-lock --rootDir .. --roots '<rootDir>/tests/contract'` from `management-api/` → 4 passed (the file is a jest suite and fails under `node --test`, which has no `beforeEach`). Not checked: the stale-takeover timings and the residual takeover window in Consequences, beyond what that suite exercises. `verified_paths` is left empty as the author wrote it, so the staleness gate does not watch this record; listing `management-api/lib/journal-lock.js`, `management-api/adapters/events/local-jsonl.js` and `tests/contract/events-journal-lock.test.js` would arm it. Activation remains `inactive`: no image carries this code yet. The effect on ADR-2071 is recorded in that record's own 2026-11-20 note.

## Amendment — 2026-11-20 (review)

A review found a second way for two holders to overlap, beyond the takeover race above: a live holder stalled for longer than `MAX_HOLD_MS` (30 s) is taken over, then resumes and appends from an old head. From dd78dba42 `withLock` passes the holder `assertHeld()` and the adapter calls it immediately before the append (`management-api/adapters/events/local-jsonl.js`), so a holder that lost the lock persists nothing. This narrows the window and does not close it: a stall between the check and the write still overlaps, and the verifier still reports it. Unchanged and accepted: a waiter that times out after 15 s delivers its event to subscribers without persisting it, the wait blocks the event loop, and each append by alternating writers re-reads the day's file under the lock.
