---
id: ADR-2072
title: Serve the briefing workflow (brief, execute, debrief) from management-api
date: 2026-09-05
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: e070514d808b218574403377fb75e0e1a0a256b3
verified_paths: []
owner: jjohare
review_trigger: a change to VisionClaw's ManagementApiClient brief request/response structs, or a decision to move brief artefacts off the pods adapter slot
repo: agentbox
domain: BASELINE-container
---

# ADR-2072 — Serve the briefing workflow (brief, execute, debrief) from management-api

## Context

VisionClaw's `src/services/briefing_service.rs` orchestrates a brief → execute → debrief cycle
through `ManagementApiClient` (`create_brief`, `execute_brief`, `create_debrief`), which POST to
`/v1/briefs`, `/v1/briefs/:brief_id/execute` and `/v1/briefs/:brief_id/debrief`. None of the three
existed in agentbox: a grep of `management-api/` found no `/v1/briefs` registration anywhere, only a
doc-comment mention at `middleware/linked-data/surfaces/s01-pods.js:10`. Every `BriefingService`
call therefore 404'd at runtime — a live, fully-typed client with no server. VisionClaw ADR-2085
recorded the gap, chose implementation over client removal, and pinned the wire contract verbatim
from the Rust client; this record is the agentbox half.

## Decision

`management-api/routes/briefing.js` serves the three routes, registered in `server.js` alongside the
other adapter-backed surfaces (beads, mandate, approvals), after `app.decorate('adapters', …)`.

- **Contract is derived, not designed.** Request bodies are snake_case as the Rust client literally
  writes them; response envelopes are camelCase (`briefId`, `briefPath`, `beadId`, `roleTasks`,
  `debriefPath`); the `RoleTask` elements nested inside `roleTasks` are snake_case (`task_id`,
  `bead_id`, `response_path`) because `crate::types::user_context::RoleTask` carries no
  `#[serde(rename_all)]` while its enclosing struct does. Status codes are 201 / 202 / 201.
- **Durability rides the adapter slots (ADR-005).** Every document write goes through
  `fastify.adapters.pods`, so the standard observability → privacy-filter → JSON-LD chain wraps it.
  The route holds no in-memory brief state: the brief record is itself a pod resource at a path
  derived from the brief URN, so `execute` and `debrief` recover it by read and a management-api
  restart between the three calls is survivable. The pods slot resolving `off` self-gates 503.
- **Work-ledger linkage is best-effort.** Epic on create, child bead per role, close on debrief, all
  through `fastify.adapters.beads`; the slot being `off` or refusing degrades `beadId`/`bead_id` to
  null and never fails an otherwise-written brief.
- **Identifiers are minted (ADR-013).** The brief URN comes from `lib/uris.js` as
  `kind: 'thing'` with the optional owner scope taken from `user_context.pubkey`; an unusable
  pubkey mints the unscoped form rather than a fabricated scope. Bead ids are minted inside the
  beads adapter. Nothing here formats an identifier by hand.
- **Execute is gated exactly as `POST /v1/tasks` is (ADR-2041).** Each role spawn dispatches through
  `lib/action-plane.js` `dispatchTaskSpawn()` — classify → guard → protected-executor → journal —
  and fails **closed** with 503 when the plane has no live events adapter, 403 when the pipeline
  denies. `middleware/cost-gate.js` is deliberately not attached: its own first guard scopes it to
  URLs starting `/v1/tasks`, so on `/v1/briefs` it would be an inert decoration implying a spend
  check that never runs.

Auth is the existing global bearer/NIP-98 `preValidation` hook; the client's
`Authorization: Bearer <MANAGEMENT_API_KEY>` needs nothing extra.

## Consequences

- The route surface grows by three endpoints and one file; `/v1/briefs` becomes part of the
  management-api contract that VisionClaw depends on, so the response shapes above are now a
  compatibility surface — changing a `RoleTask` field name breaks the Rust client silently, because
  Fastify strips response properties absent from the schema.
- Brief artefacts occupy the pods slot under `/briefs/<date>/<slug>-<digest>/` plus a machine-readable
  record under `/briefs/records/`. No retention policy is defined here; that is follow-on work.
- Role spawns are classified `local` by the action plane's existing task-spawn classifier, so they
  are journalled but require no approval receipt — the same interim rollout choice ADR-2041 made and
  documented for `POST /v1/tasks`, inherited rather than re-decided.
- `activation_status: staged` — the routes exist in the tree and pass their tests, but management-api
  is baked into the image, so they serve traffic only after the next `./agentbox.sh rebuild`.
- Follow-on: no route exists to *read* a brief or list briefs. VisionClaw's client does not need one,
  so none was invented; add it when a consumer asks.

## Verification

Established at `verified_commit` e070514d808b218574403377fb75e0e1a0a256b3 (working-tree base; the
implementation is uncommitted at time of writing, so re-verify at the landing commit).

- `cd management-api && node node_modules/.bin/jest ../tests/sovereign/briefing-route.test.js`
  → 10 passed. Covers the full three-call cycle against pods/beads fakes, the snake_case `RoleTask`
  members, the durable-record survival of an app restart, unscoped URN minting, 404 on unknown brief,
  the action-plane 503 fail-closed and 403 deny paths, the pods `off` self-gate, and beads degradation.
- `cd management-api && node node_modules/.bin/jest` → **80 suites / 1289 passed**, 3 skipped, 34 todo,
  0 failed. Baseline without the new file was 79 suites / 1279 passed, so the 10 added tests are the
  whole delta and nothing regressed. (One earlier run showed
  `tests/contract/federation-kind-parity.contract.spec.js` failing; it is driven by the
  concurrently-authored `management-api/schema/federation-kinds.json` and passes on re-run — a race
  with another in-flight change, not this one.)
- `node --check management-api/routes/briefing.js && node --check management-api/server.js` → clean.
- VisionClaw side, from the VisionClaw repo root: `cargo test --lib briefing` → 4 passed, driving a
  real `ManagementApiClient` against a mock origin that replies with exactly this route's JSON;
  `cargo fmt --all --check` → clean.
- `grep -n "briefing" management-api/server.js` → registration at `server.js:1181`.
