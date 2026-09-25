---
id: ADR-2087
title: Action authority carries a task-property triple, every gate outcome leaves a record, and an outage has a signed continuation path
date: 2026-09-14
decision_status: accepted
implementation_status: complete
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: 37781368873d809bfbe4aad1d959167575ce152f
verified_paths: [management-api/lib/task-properties.js, management-api/lib/authority.js, management-api/lib/authority-journal.js, management-api/lib/governance-receipt-publisher.js, management-api/lib/governance-manual-continue.js, management-api/lib/governance-application-receipts.js, management-api/lib/dream-ledger.js, management-api/routes/broker-bridge.js, mcp/servers/governance-bridge.js, services/dream-engine/src/ledger.rs]
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
- The forum receipts endpoint does not exist yet on the deployed edge, so receipts queue
  rather than post until it does. That is the intended degraded state, not a failure — the
  journal records every attempt.
- `activation_status: inactive` — the container has not been rebuilt against this change.
  It moves to `staged` on the next image build and `live` once `forum_auth_api` is set and a
  receipt posts.

## Verification

Executed evidence, with commands and raw output, is in
`.claude/evidence/EXP-AC-{003,004,006,007}.evidence.md`. In summary, at `verified_commit`:

- `node_modules/.bin/jest --config management-api/package.json --rootDir .` — 86 suites,
  1399 passed (86 of them new across `tests/sovereign/task-properties.test.js`,
  `authority-augmentation.test.js`, `authority-journal.test.js`,
  `governance-receipt-publisher.test.js`, `tests/integration/dream-ledger-reviewer.test.js`;
  a further 18 added at `verified_commit` closing the EXP-AC-003 auditor
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
- **EXP-AC-003 re-audit (`verified_commit`).** The auditor found that a SKILL.md
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
