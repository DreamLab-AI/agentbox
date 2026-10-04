---
id: ADR-2071
title: Journal the nightly dream cycle before policing it, and fix the deny-path typo first
date: 2026-09-05
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: ddfb6d05608da573f071029476f8e2ebbee37bf1
verified_paths: [management-api/routes/exec-record.js, tests/integration/exec-record.test.js, services/dream-engine/src/journal.rs, services/dream-engine/src/sweep.rs, services/dream-engine/src/engine.rs, services/dream-engine/src/ledger.rs]
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
ten side effects — SSH clone and remote evaluator runs on the connected node annexe, external
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
  honest per-capability classification of the ten side effects, guards for the connected node
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

## Implementation status (2026-09-30)

Phase 1 landed at `3c5213360`; the decision stays `proposed` until the acceptance
test above passes on a deployed image. The planning cycle of 2026-09-21 made this the
cycle's single focus on 30 September (day-five abort call).

- **Route.** `POST /v1/exec/record` (`management-api/routes/exec-record.js`) appends
  through the same `getActionPlane()` journal singleton as `POST /v1/tasks`, so the
  management API stays the only writer. It accepts `turn.*`, `step.*`,
  `tool.called` and `tool.completed` only; the model-visibility types keep their D2
  semantics internal. A caller key makes a retry idempotent. No live events adapter
  answers 503. Operator-gated like every `/v1` route.
- **Engine.** `src/journal.rs` opens one session per repo cycle
  (`<night_id>-<unix seconds>`) and one for the night-level work, and posts a
  `tool.called` / `tool.completed` pair, linked by `causation`, around every side
  effect: annexe ssh, clone and exec; each LLM call (context, source, verdict,
  fallback, repair); candidate worktree; push and draft PR; branch discard; ledger
  append and commit; RuVector store; inbox writes; forum governance, digest and
  suggestions. Fail-open with a three-strike breaker, so a down API costs seconds;
  per-session counters (`recorded`, `failed`, `skipped`, `unpaired`) land in
  `dream-last-night.json`. The vocabulary is ADR-057's `tool.called`, not the
  `exec.tool.started` this record first named.
- **Two additions from the planning cycle's stopping rule.** The engine commits its
  own ledger row on the default branch (`git commit --only`, local, never pushed,
  skipped on a feature branch), because rows left in the working tree made the
  27 to 30 September nights invisible to git. And a seven-day sweep deletes a
  `dream/*` branch whose PR merged or closed, closes an unreviewed PR older than
  seven days, and deletes a PR-less branch older than seven days, keyed on PR state
  because squash merges never make a dream branch an ancestor.
  `DREAM_JOURNAL=0`, `DREAM_LEDGER_COMMIT=0` and `DREAM_SWEEP=0` opt out.
- **Corrections to the context above.** The `'deny'`/`'denied'` precondition was
  already fixed (`action-plane.js:277-281`). Auth needed no `flake.nix` edit: the
  supervised dream engine already inherits `MANAGEMENT_API_KEY`,
  `MANAGEMENT_API_PORT` and `MANAGEMENT_API_AUTH_MODE=hybrid` from supervisord
  (checked on the live process). The fragility stands: if the mode is unset and the
  mesh auto-elevates to `strict-nip98`, posts fail, the night still runs, and the
  failure count shows it.
- **Known limit.** The journal's per-session sequence lives in the management-api
  process and is not hydrated after a restart, so an API restart in the middle of a
  cycle restarts that session at seq 0. Fresh sessions per attempt keep engine
  restarts clean; an API restart mid-night is visible as a sequence reset.

Tested: `tests/integration/exec-record.test.js` (six cases, including acceptance
clause (a) on a real on-disk events log verified with `audit-chain.verifyFiles`);
`journal.rs` tests (pairing and causation against a stub API, clause (c)'s
fail-open against a closed port, the breaker, a 401); `sweep.rs` and `ledger.rs`
tests against scratch git repos. Clauses (a) to (c) end to end need one
`dream-engine --target <repo>` run on an image built from this commit.

## Re-verification — 2026-10-02 (`ddfb6d05608da573f071029476f8e2ebbee37bf1`)

Tripped by two dream-engine commits. `68270e953` (NIP-09 withdrawal of resolved governance cases) adds a `withdrawn` count to the `forum.governance` ingest and publish `tool.completed` payloads in `engine.rs` (four changed lines, no control flow), and `383a471cc` changes one prompt string in `compile.rs` ("(ADR-2024)" → "(agentbox ADR-2024)"). Pairing and causation are unchanged: the payload gains a field, nothing else. `cargo test journal::` 6 passed; full crate 248 passed.

**Activation corrected from `inactive` to `live`.** The image booted on 2026-10-01 was built after `3c5213360`: its management-api is blob-identical to `a25695a36`, which descends from it, and the supervised `dream-engine` binary contains `/v1/exec/record`, `tool.called`, `tool.completed`, `DREAM_JOURNAL`, `DREAM_LEDGER_COMMIT` and `DREAM_SWEEP`. On that image the 2026-10-02 night journalled 62 side effects across four sessions with `failed 0`, `unpaired 0` in `dream-last-night.json`. The decision stays `proposed` and implementation `partial` because the acceptance test is two-thirds met, on real data rather than a stub repo:

- (a) **met**: `GET /v1/system/audit-chain` returns `ok: true` over 9 day files after the night's appends.
- (b) **met**: every `exec.tool.called` in `events/2026-10-02.jsonl` has exactly one `exec.tool.completed` whose `causation` names it, under the same `session_urn`, with no orphans.
- (c) **not run**: it needs a night with management-api stopped, which is the owner's call.

Both (a) and (b) are checks C1 and C2 of `scripts/activation/adr-2087-check.sh` (receipt `.claude/evidence/activation/ADR-2087-activation-20261002T133027Z.md`). The morning after a night with the API stopped, `--api-down-night <date>` evaluates (c).

## Consumer — 2026-10-02: the sidechain demo witness reads Phase-1 pairs

`scripts/activation/sidechain-demo-witness.sh` (ADR-2103, interim receipt amendment
2026-10-02) requires at least one matched `exec.tool.called`/`exec.tool.completed` pair under
the demo's session URN, and no unpaired or orphaned record. It applies the same rule as C2 of
`scripts/activation/adr-2087-check.sh`. When it derives that URN from a Hitch session, it
mints it through `uris.js` exactly as `routes/exec-record.js` does
(`urn:agentbox:meta:session-<harness>-<session>`). The witness depends on this record's
Phase 1 shape (`payload.session_urn`, `event_id`, `causation`) and on nothing in Phase 2.
Clause (c) still stands: a fail-open journal can only show what reached it. The witness
therefore treats a missing pair as a failure, never as "nothing happened".

## Disposition — 2026-10-02

- **Suitability:** fits
- **Priority:** P1 — this cycle (Track A item 5; CY-A5; the cycle's single focus per planning cycle §10)
- **Why:** Phase 1 merged (agentbox #8, `69f0c2207`) and is live. The 2026-10-01 image journalled 62 side effects on the night of 2026-10-02 with `failed 0`, `unpaired 0`. Clauses (a) and (b) are met through checks C1 and C2 of `scripts/activation/adr-2087-check.sh`. Clause (c), a night with management-api stopped, has not run.
- **Next:** The owner schedules one night with management-api stopped. The next morning, run `scripts/activation/adr-2087-check.sh --api-down-night <date>`. If clause (c) passes, accept.
- **Arranged — owner decision 2026-10-02, Q9:** the night of Monday 5 Oct, i.e. the 01:00–05:00 UTC window on **Tue 6 Oct**. Mechanism, chosen to survive a container restart with no image rebuild: the marker `~/workspace/.agentbox/adr-2071-api-down-night` (on the workspace volume) holds `2026-10-06`. `scripts/activation/adr-2071-api-down-night.sh` runs every 10 minutes on 5–7 Oct from the crontab that `[program:podcast-cron]` (supercronic) already reads from the checkout. It is a stateless tick that works in UTC: it stops management-api once between 00:30 and 00:59 UTC. It restarts it when `dream-last-night.json` is dated 2026-10-06, at the 07:30 UTC deadline, or when it finds the API running again (a container restart: supervisord autostarts it, recorded as `interrupted`). It then retires the marker. It never stops the API if no tick lands before 01:00 or if dreaming is paused. Tests: `tests/config/adr-2071-api-down-night.test.sh` (26 cases, run under the cron PATH, which has no `sed`/`awk`). Check C3 of `adr-2087-check.sh` now also requires the one-shot's state file to show a clean stop and a restart (`night-record` or `deadline`), so a night of failed posts alone no longer passes. **Tuesday morning:** `scripts/activation/adr-2071-api-down-night.sh --status`, then `scripts/activation/adr-2087-check.sh --api-down-night 2026-10-06`. If C3 passes, accept this record. Afterwards, remove the crontab block.

## Acceptance — 2026-10-04

**Accepted, implementation complete, activation live.** Clause (c) ran on 4 October at the owner's request ("let's manually stop the api and run the dream cycle now please"), in place of the 6 October night arranged under Q9. All three Phase 1 clauses now pass on the live image, on real nights rather than a stub repo. Receipt: `.claude/evidence/activation/ADR-2087-activation-20261004T100615Z.md` (`adr-2087-check.sh --api-down-night 2026-10-04`, C1 to C3 PASS).

- (a) **met** (C2): the audit chain verifies intact across 11 day files after the night's appends.
- (b) **met** (C1): 80 side effects across 5 sessions on 2026-10-04, each a matched `exec.tool.called`/`exec.tool.completed` pair under its `session_urn`. These come from that morning's scheduled night, with the API up.
- (c) **met** (C3): management-api was `STOPPED` from 09:38:39Z to 10:06:04Z. A full `dream-engine --once` ran inside that window and exited 0. It produced 4 repo verdicts while 130 journal posts failed or were skipped. Each session's breaker opened after 3 failures, so the down API cost seconds rather than a timeout per side effect. The engine still committed its own ledger rows locally: factrail `4d3d367` (INCONCLUSIVE), dreamlab-ai-website `688486b` (ACCEPT) and dream-machine `6a3eda7` (ACCEPT). The state file reads `reason=night-record`, `engine_exit=0`.

**How it differs from the arranged run.** A scratchpad wrapper did the stop and restart by hand: it stopped the supervised loop, ran a one-shot with the loop's environment (the `/dream run` recipe) and restarted both programs from an EXIT trap. The cron one-shot was not used, so the state file carries `mode=manual-owner-2026-10-04`. It is otherwise in the format C3 reads. VisionFlow was skipped because its run had already completed that morning (same run id, so no duplicate PR), so 3 of the 4 verdicts were dreamed with the API down. The night digest was skipped after the relay answered HTTP 500. That is the fail-open path working, not a journal fault. Two earlier attempts aborted before any night ran: one was a wrapper argv error, the other the singleton lock refusing a second engine. Their state files are kept as `.state.aborted-0937*`.

**Retired.** The 6 October marker was renamed `*.consumed`, and the crontab block in `skills/podcast-knowledge-ingest/crontab` is removed in this change. `scripts/activation/adr-2071-api-down-night.sh` and its tests stay, for reuse after a future image change. The verified paths are unchanged since `ddfb6d056`.

Phase 2 (policing) stays out of scope, as the Decision says. It needs an approver wired into the action pipeline, which is this record's review trigger.
