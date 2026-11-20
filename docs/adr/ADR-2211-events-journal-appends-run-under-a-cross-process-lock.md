---
id: ADR-2211
title: Events journal appends run under a cross-process lock
date: 2026-11-20
decision_status: accepted
implementation_status: complete
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit:
verified_paths: []
owner: jjohare
review_trigger: Node gains a maintained flock binding in the dependency set, or a second implementation language writes the events journal
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: ADR-039 (hash-chained events log), ADR-2071 (journal the nightly dream cycle), ADR-2087 amendment (journal boundaries)
---

# ADR-2211 — Events journal appends run under a cross-process lock

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
