---
id: ADR-2087
title: Action authority carries a task-property triple, every gate outcome leaves a record, and an outage has a signed continuation path
date: 2026-09-14
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 60f8b8458e9b1f92c14604b9f054d3b5299e32e6
verified_paths: [management-api/lib/task-properties.js, management-api/lib/authority.js, management-api/lib/authority-journal.js, management-api/lib/governance-receipt-publisher.js, management-api/lib/governance-manual-continue.js, management-api/lib/governance-application-receipts.js, management-api/lib/dream-ledger.js, management-api/routes/broker-bridge.js, management-api/routes/llm-marketplace.js, mcp/servers/governance-bridge.js, services/dream-engine/src/ledger.rs, scripts/activation/adr-2087-check.sh]
owner: jjohare
review_trigger: nostr-bbs-core publishing TaskProperties (the schema this stamps against), agentbox authority_class gaining a third class, or the forum receipts endpoint changing shape
repo: agentbox
---

# ADR-2087 — Action authority carries a task-property triple, every gate outcome leaves a record, and an outage has a signed continuation path

## Context

The authority gate (`lib/authority.js`, ADR-037 D2) is cryptographically correct and
semantically thin. Three gaps, all of them named by arXiv 2609.12482's augmentation
conditions as applied in VisionFlow's [ADR-2010](../../../VisionFlow/docs/adr/ADR-2010-augmentation-conditions-are-the-canon-audit-lens.md)
and [ADR-2011](../../../VisionFlow/docs/adr/ADR-2011-task-properties-set-the-boundary-not-agent-self-tiering.md):

1. The only boundary signal on a 31402 is the requesting agent's own `risk_tier`. The
   party with the strongest incentive to under-tier is the only party that tiers.
   `authority_class` is operator-declared and the right shape, but encodes reversibility
   alone.
2. Every deny path returned correctly and fail-closed, and left only a `logger.warn`.
   A denial nobody can enumerate is not an accountability record (condition C3).
3. `ApplicationReceiptStore` knows whether an approved mutation landed; the human who
   approved it had no way to learn (C3), and when the mesh is down that human has no
   sanctioned way to act at all (C2, "can they continue during unavailability?").

## Decision

1. **agentbox derives and stamps the ADR-2011 task-property triple.**
   `lib/task-properties.js` resolves `{verifiability, reversibility, stakes}` for an action
   class: reversibility from `authority_class` (`zero-tolerance` ⇒ `irreversible`,
   `recoverable` ⇒ `compensable`, unclassified ⇒ `irreversible`), the other two axes from
   `[skills.authority.task_properties]` (defaults `partial` / `significant`, overridable per
   action class and in SKILL.md frontmatter). The authority gate and
   `governance_request_action` stamp all three on every 31402 they publish, as the tags
   `tp-verifiability` / `tp-reversibility` / `tp-stakes` **and** inside `fields`. An
   agent-supplied `task_properties` merges on the tightening lattice: it may raise the
   boundary for its own action, never lower it. The schema and `effective_tier()` remain
   owned by `nostr-bbs-core`; agentbox produces, it does not adjudicate.

2. **Every gate denial is journalled.** `lib/authority-journal.js` appends
   `authority.deny {agent_did, stage, reason, action_class, authority_class,
   operation_sha256, task_properties}` through the ADR-005 events adapter (inheriting the
   ADR-039 hash chain) and publishes it to the agent-event surface, so it is readable at
   `/v1/agent-events`. Every deny path routes through one `deny()` helper, so "was this
   denial recorded?" has one answer rather than nine. The journal is **fail-open on the
   record and fail-closed on the action**: a journal failure is logged loudly and never
   converts a deny into an exception.

3. **Receipts reach the human.** `lib/governance-receipt-publisher.js` mirrors each
   mutation-owner stage — `consumer-received`, then exactly one of `applied` /
   `not-applied` / `applied-manually` — to
   `POST {forum_auth_api}/api/governance/receipts/{response_event_id}/application` under
   NIP-98. Transport failures are journalled as `authority.receipt-post-failed` and queued
   for replay; semantic refusals (409 stage regression, 403 unauthorised) are journalled and
   retired, because a retry cannot change that answer. An `unknown` local outcome publishes
   **nothing**: the ladder has no stage for "we do not know", and fabricating one would be
   the same class of dishonesty as a fabricated rationale.

4. **An outage has a continuation path.** The MCP tool `governance_manual_continue
   {case_id, executed_by, evidence}` records an operator's hand-execution of an
   already-approved action: it binds to the approved operation digest, writes
   `applied-manually`, mints a PROV-O activity whose `prov:wasAssociatedWith` is the human
   `did:nostr`, and posts the receipt (queued if the forum is unreachable). `executed_by`
   must be a human: an agent DID, or this container's own, is refused. The gate's
   `no-decision-surface` deny now returns `{code: "no-decision-surface", hint:
   "governance_manual_continue"}`, so the operator learns the option at the moment of
   denial rather than from documentation.

5. **The dream ledger measures the human.** The row schema gains `Reviewer` and
   `Review-minutes`, populated from the PR merge event (`merged_by`;
   `merged_at − pr_opened_at` in whole minutes) and left EMPTY otherwise. Ten-column
   ledgers remain valid — the parser's compatibility floor is the legacy width.

## Consequences

- Operators must declare verifiability and stakes per action class to get anything better
  than the fail-closed defaults. An undeclared class still publishes all three tags, at the
  tightest reversibility — the cost of forgetting is a tighter boundary, never a looser one.
- A second durable queue exists (`governance-receipt-outbox`). It is deliberately **not** the
  pod outbox: that flusher signs and publishes Nostr events, and an HTTP receipt queued there
  would retry-then-fail silently. The publisher owns its own replay.
- `/v1/agent-events` gains two new event kinds. Consumers that enumerate kinds will see
  `authority.deny` and `authority.receipt-post-failed`; both are additive.
- Receipts queue until the forum receipts endpoint answers. It is deployed on the edge as of
  2026-10-02 (website 8ab4ab4 pins forum kit 341c5d2; the receipts and application routes
  answered a signed probe in forum ADR-2011's M4 run) and `forum_auth_api` points at it
  (60b60b48d), so the queue drains once a real governance response exists. Until then the
  journal records every attempt.
- `activation_status: staged` (2026-10-02, rebuilt image; see "Staged on the rebuilt image"). Before that it was `inactive`: the image booted 2026-10-01 (management-api
  byte-identical to `a25695a36`) does carry this change, but four wiring defects kept it inert
  there; they are fixed at `b18a52f03` and need an image rebuild (see "Activation finding").
  It moves to `staged` when `scripts/activation/adr-2087-check.sh` exits 2 on the rebuilt
  image, and to `live` when it exits 0: `forum_auth_api` set and a receipt posted.

## Verification

Executed evidence, with commands and raw output, is in
`.claude/evidence/EXP-AC-{003,004,006,007}.evidence.md`. In summary, at the original verification
(`37a1a1988`; `verified_commit` has since moved, see the dated sections below):

- `node_modules/.bin/jest --config management-api/package.json --rootDir .` — 86 suites,
  1399 passed (86 of them new across `tests/sovereign/task-properties.test.js`,
  `authority-augmentation.test.js`, `authority-journal.test.js`,
  `governance-receipt-publisher.test.js`, `tests/integration/dream-ledger-reviewer.test.js`;
  a further 18 added at `37a1a1988` closing the EXP-AC-003 auditor
  counter-example — see below).
- `node --test management-api/tests/{broker-bridge,broker-bridge-receipts,governance-application-receipts,governance-manual-continue}.test.js` — 35 passed.
- `node --test mcp/servers/__tests__/governance-bridge.test.mjs` — 10 passed, including the
  ADR-2011 invariant read against the **real** `agentbox.toml`: `ontology_axiom_load`
  (zero-tolerance) publishes `tp-reversibility=irreversible`.
- `cd services/dream-engine && cargo test --offline` — 166 passed.
- `npm run test:node` (adapter contract suite) — 56 passed.
- `node scripts/agentbox-config-validate.js` — the new manifest keys validate; the four
  pre-existing E016 errors (`/skills/colloquy`, `/dream_machine/loom_url`, two
  `preserve_host`) are unchanged from `main`.
- **EXP-AC-003 re-audit (`37a1a1988`).** The auditor found that a SKILL.md
  frontmatter `authority_class` won outright over the operator's
  `[skills.authority.classes]` entry, so `recoverable` on a zero-tolerance action turned the
  ADR-2011 reversibility seed from `irreversible` into `compensable`. The two surfaces now
  resolve on a tightening lattice in `lib/authority.js` `classifyAction`, a SKILL.md
  `task_properties` block goes through `merge` rather than `applyOperatorOverride` in
  `lib/task-properties.js` `derive`, and a refused loosening is logged and journalled.
  Exactly one surface may loosen anything, and it is `agentbox.toml`. +18 cases, three of
  them read against the real manifest; `.claude/evidence/EXP-AC-003.evidence.md`
  §"Iteration after audit" carries the commands and raw output.
- `deepsec-gate.sh --diff main` — exit 0, PASS, 9 findings (7 MEDIUM, 2 HIGH_BUG), none at
  or above HIGH and **none in the changed files**; receipt
  `.deepsec-gate/reports/20260914T151712Z/receipt.json`. Recorded honestly: the gate's
  Agent-SDK investigation stage errored on all 3 batches (`Not logged in`), so the
  LLM-investigated half of the gate did not run and this receipt evidences the static stage
  only.

## Re-verification — 2026-09-21 (`b680a7aeef604276af73e00e1eb5156f379530ae`)

The staleness checker could not use this record at all: `verified_commit` was the abbreviated `37a1a1988`. Expanded to the full 40-char SHA `37a1a1988f047056bf871079097f0922ab164435` (`git rev-parse 37a1a1988^{commit}`; subject: "fix(authority): frontmatter may only tighten the operator's authority class"). **No re-verification was performed and none was needed:** with the full SHA the gate can now run, and `git diff --name-only 37a1a1988..HEAD -- <all ten verified_paths>` is **empty** — not one governed file has moved since the original verification, so the original anchor stands unamended. This is a mechanical repair of the field, not a new verification claim.

## Re-verification — 2026-09-25 (`5a7226b797c5949771e8b8ddcd69cfddd3c7f533`)

Tripped by one line in `services/dream-engine/src/ledger.rs`: an `#[allow(clippy::too_many_arguments)]` on `LedgerRow::unreviewed` so the crate passes `cargo clippy --all-targets -- -D warnings` on the current toolchain (ADR-2115 change). No behaviour moved: `git diff de84739ee..5a7226b79 -- services/dream-engine/src/ledger.rs` is that single added line; `cargo test ledger::` passes 10 at `5a7226b79`, and the reviewer/review-minutes columns and `review_from_merge` are unchanged. The other nine governed paths have no diff. Still true.

## Activation finding — 2026-10-02 (`ddfb6d05608da573f071029476f8e2ebbee37bf1`)

The record said `inactive` because the container had not been rebuilt. That was no longer the reason: the image booted on 2026-10-01 carries every file this record governs (its management-api is blob-identical to `a25695a36`). It was inert in that image because of four wiring defects that the unit suites could not see, each now pinned by a test that reproduces the production condition:

1. **The governance-bridge MCP server never started.** `mcp/mcp.json` launches `/opt/agentbox/mcp/servers/governance-bridge.js`; `mcp/servers` is a symlink into `/nix/store`, Node hands an ES module its real path, and the `path.resolve()` entrypoint guard added in `bc4a9b259` compared the two and found them unequal. The process exited 0 without connecting, so `governance_manual_continue` (and the other four governance tools) were absent. Observed on the running image: an `initialize` on stdio gets no reply and the process exits 0. Fixed by comparing real paths; `mcp/servers/__tests__/governance-bridge.test.mjs` now launches the server through a symlinked directory.
2. **broker-bridge used an unjournalled fallback gate.** It read `fastify.authorityGate`, `authorityDenyJournal` and the receipt publisher at registration. `server.js` registers it at module top level and Fastify loads it at the first awaited `register` inside `start()`, before the boot block decorates them (reproduced on Fastify 5.12.5). Its denials and receipt-post failures were therefore never journalled. It now resolves them per request.
3. **Nothing replayed the receipt outbox.** `flush()` and `start()` had no production caller. `server.js` now boots one publisher over the deny journal (`bootReceiptPublisher`: a boot flush, then one a minute, never overlapping), and broker-bridge shares it. With no `forum_auth_api` the replay spends no retry budget, so receipts wait for the endpoint rather than being parked `failed` before it exists.
4. **`/v1/llm/revoke` denials were unrecorded and unhinted.** That route's gate had no journal, and both it and broker-bridge dropped the gate's `{code, hint}` from their 403. Both now carry it, and the revoke deny goes through the boot journal.

A delivered receipt now logs `governance.receipt-posted` at info. The forum's receipt read is admin-NIP-98 only, so that line is the local proof the `live` bar needs.

Tests at `b18a52f03`: jest 90 suites, 1496 passed; `node --test` broker-bridge, broker-bridge-receipts, governance-application-receipts and governance-manual-continue 37 passed; governance-bridge 11 passed. `scripts/activation/adr-2087-check.sh` is the post-rebuild check. Run against the un-rebuilt image it exits 1 (receipt `.claude/evidence/activation/ADR-2087-activation-20261002T133027Z.md`): A2/A3 blob mismatch, A4 no NIP-09 strings in the dream-engine, B1 no replay boot line, B3 403 without `{code, hint}`, B4 nothing journalled, B6 MCP server silent. Status stays `inactive` until the rebuilt image passes it.

## Staged on the rebuilt image — 2026-10-02

The owner rebuilt agentbox on 2026-10-02 (management-api started 14:57:17). `scripts/activation/adr-2087-check.sh` exits 2, STAGED (receipt `.claude/evidence/activation/ADR-2087-activation-20261002T145933Z.md`): the running management-api, governance-bridge and dream-engine equal `b18a52f03` for every governed file; receipt replay is armed with `forum_auth_api` configured (`60b60b48d`); a live zero-tolerance revoke is denied 403 with `{code: no-decision-surface, hint: governance_manual_continue}`, journalled in the hash chain and served at `/v1/agent-events`; the audit chain verifies (232 records); the baked governance-bridge answers on stdio and refuses an unapproved case. B7 did not run: no receipt has posted yet (posted 0, queued 0). It moves to `live` when the check exits 0, which needs the first real governance response after the rebuild.


## Re-verification — 2026-10-02 (`60f8b8458e9b1f92c14604b9f054d3b5299e32e6`)

Tripped by `scripts/activation/adr-2087-check.sh`, changed only in check C3 (ADR-2071 clause (c)) and its header (`usage` now prints the whole header). C3 now also requires the state file of the new one-shot `scripts/activation/adr-2071-api-down-night.sh` (owner decision 2026-10-02, Q9) to show a clean stop before the window and a restart after it. Before this change, a night of failed journal posts passed C3 whatever the reason the posts failed. Checks A and B, which are this record's evidence, are untouched, and so are its decision and status axes. Exercised against a scratch workspace with `--no-live-probe`: a clean state passes C3, and an `interrupted` or absent state fails it.
