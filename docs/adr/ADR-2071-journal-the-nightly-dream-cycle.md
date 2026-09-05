---
id: ADR-2071
title: Journal the nightly dream cycle before policing it, and fix the deny-path typo first
date: 2026-09-05
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: e070514d808b218574403377fb75e0e1a0a256b3
verified_paths: []
owner: jjohare
review_trigger: an approver is wired into the action pipeline, a second process gains an events-adapter write path, or the nightly acquires a new external side effect
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: ADR-2041 (wire the execution journal and action pipeline onto POST /v1/tasks), legacy ADR-057 (replayable execution journal), legacy ADR-059 (monotonic action-policy pipeline), ADR-2053 (dream default provider)
---

# ADR-2071 — Journal the nightly dream cycle before policing it, and fix the deny-path typo first

## Context

ADR-2041 wired `ExecutionJournal` + `AgentActionPipeline` onto exactly one route,
`POST /v1/tasks`, via `management-api/lib/action-plane.js`, with the invariant *no
agent-initiated side effect proceeds unjournalled* (503 rather than a silent spawn).
The nightly dream cycle is the largest side-effect path in the box and does not
cross it: `services/dream-engine` is a separate Rust process (~8.5k lines,
`Engine::cycle_repo` ≈830 of them) supervised as `[program:dream-engine]`, and its
ten side effects — SSH clone and remote evaluator runs on the HP annexe, external
LLM calls, git worktree and patch apply, `git push` plus a draft GitHub PR, ledger
append, RuVector write, operator-inbox writes, a public forum post as JunkieJarvis,
`ssh rm -rf` cleanup — reach nothing that a journal sees. It makes no HTTP call to
the management API at all (`reqwest` appears only in `src/llm.rs` and
`src/ruvector.rs`). This is `GOVERNANCE-capabilities` divergences 1 and 6.

## Decision

**Proposed**, not landed. Routing the nightly through the pipeline as it stands
would be dishonest, for a reason worth stating plainly: under ADR-059's taxonomy
the SSH egress, the external LLM call, the `git push` and the public forum post are
`egress`/`mutate`, all in `APPROVAL_REQUIRED`
(`management-api/lib/agent-action-pipeline.js:34`), and `action-plane.js` wires **no
approver**. A faithful routing therefore denies the night on its first action; the
only way to keep it running is to classify the whole cycle `local`, which would
launder the exact gap the journal exists to expose. Wiring an approver is
ADR-scale work in its own right.

The proposal is therefore staged, and **journalling comes before policing**:

- **Precondition (do first, independently).** The pipeline returns
  `decision: 'deny'` (`agent-action-pipeline.js:193-194`) while both consumers test
  for `'denied'` (`action-plane.js:276`, `routes/tasks.js:85`). A denial today falls
  through to the allow branch, `result.output` is `undefined`, and
  `routes/tasks.js:94` throws outside the try/catch — a 500 where a 403 was
  intended. Unreachable while nothing denies; it fires the moment any guard is
  added, i.e. exactly when this work starts. Two characters.
- **Phase 1 — journal-only, over HTTP (~380 lines).** A `POST /v1/exec/record` route
  calling `journal.append()` for a supplied envelope, plus a Rust `src/journal.rs`
  posting one `exec.tool.started` / `exec.tool.completed` per side effect from
  `cycle_repo`. **HTTP is mandatory, not a preference:** the live events adapter
  (`adapters/events/local-jsonl.js`) caches the hash-chain head in process memory
  (`this._chain`, read from disk once) and appends with an unlocked
  `fs.appendFileSync`, so any second writer — Rust-native or a `node` subprocess —
  forks `prev_hash` and makes `GET /v1/system/audit-chain` report tampering. The
  only chain-safe writer is the running management-api process.
- **Phase 1 stays fail-open**, against the ADR-2041 route's fail-closed posture, and
  says so: the dream engine is fail-open at every persistence point by design, and a
  management-api restart must not cancel the night. Phase 1 therefore buys
  **auditability, not enforcement**, and must not be described as closing
  divergence 1.
- **Phase 2 — policing — is out of scope here** and blocked on an approver. It needs
  honest per-capability classification of the ten side effects, guards for the HP
  and GitHub egress, and a decision on whether a night may proceed unapproved.

## Consequences

- Divergence 1 stays open and the diagram note stays `PROPOSED`, not `RESOLVED`.
  That is the honest state: nothing shipped here.
- Phase 1 does not fit the ~300-line budget that would have justified wiring it
  immediately; ~380 lines is the floor with tests, and squeezing under 300 means
  dropping either the tests or nine of the ten journalled side effects.
- Auth is the fragile dependency. Bearer works today only because
  `MANAGEMENT_API_AUTH_MODE=hybrid` is set explicitly; `middleware/auth.js`
  auto-elevates to `strict-nip98` when the sovereign mesh is enabled and no mode is
  set, and the dream engine has no NIP-98 signer to recover with. Phase 1 must
  either give it one or pin the mode, and putting `MANAGEMENT_API_KEY` into the
  supervisor block is a `flake.nix` edit, i.e. rebuild-class.

## Verification

Nothing is implemented; `implementation_status: none` is the claim. The analysis
behind it was established at `e070514d808b218574403377fb75e0e1a0a256b3` by reading
ADR-2041, `management-api/lib/action-plane.js`, `management-api/routes/tasks.js`,
`management-api/lib/agent-action-pipeline.js`,
`management-api/adapters/events/local-jsonl.js` and `services/dream-engine/src/`.
Three load-bearing facts were re-checked directly: `reqwest` appears in the dream
engine only in `src/llm.rs` and `src/ruvector.rs` (no management-API client);
`APPROVAL_REQUIRED = {mutate, egress, secret, spend}` at
`agent-action-pipeline.js:34` with `FAST_PATH = {read, local}` at `:38`; and the
`'deny'`/`'denied'` mismatch across `agent-action-pipeline.js:193-194`,
`action-plane.js:276` and `routes/tasks.js:85`.

**Acceptance test for Phase 1** (the gate this ADR must pass to become `accepted`):
a test drives one `cycle_repo` against a stub repo with the management API live,
then asserts that (a) `GET /v1/system/audit-chain` verifies intact after the run —
the single-writer property — (b) the day's `$WORKSPACE/events/YYYY-MM-DD.jsonl`
contains a matched `exec.tool.started`/`exec.tool.completed` pair per side effect,
each carrying the night's `session_urn`, and (c) with the management API stopped,
the cycle still completes and its ledger row is still written, proving the
documented fail-open posture rather than an accidental one.
