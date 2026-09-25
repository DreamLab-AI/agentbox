---
id: ADR-2115
title: Dream-machine decisions surface on the forum governance panel, and the nightly digest reports every outcome
date: 2026-09-25
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 3bb96e5264e8e912b4aebb00de10cb45648e1eb5
verified_paths: [services/dream-engine/src/governance.rs, services/dream-engine/src/digest.rs, services/dream-engine/src/relay.rs, services/dream-engine/src/inbox.rs, services/dream-engine/src/engine.rs, config/hooks/dream-inbox-surface.cjs]
owner: jjohare
review_trigger: JunkieJarvis registered in the relay agent_registry and the first night that publishes cases (activation_status → live), or any change to the forum's 31402/31403 wire format
repo: agentbox
---

# ADR-2115 — Dream-machine decisions surface on the forum governance panel

## Context

The dream engine queues human decisions (report "Human action recommended" items, night-health alerts) in `workspace/.agentbox/dream-inbox.json`. The only route to the operator was `dream-inbox-surface.cjs`, which injected two item bodies into whatever Claude session came next. The operator did not know the queue existed; it reached 59 open items between 7 and 25 September 2026. The forum digest (`scripts/dream-night-digest.mjs`) counted only ACCEPT/REJECT/INCONCLUSIVE ledger rows and never read the inbox. From 14 to 25 September it posted "No dream cycles ran tonight" while repos were failing dispatch, running without a patch, or all parked. The forum already has a decision mechanism, the Agent Control Surface Protocol: panels (31400), requests (31402) and signed admin decisions (31403), with broker-case projection, receipts, risk tiers and ageing. The dream engine never used it.

## Decision

- **The governance panel is where dream decisions are made.** JunkieJarvis publishes one kind-31400 panel with `d = dream-machine`, and one kind-31402 case per open inbox item:
  - `d = dream-<item id>`, `a = 31400:<jarvis>:dream-machine`, `panel = dream-machine`;
  - the ACSP broker tags `priority`, `risk-tier`, `category`, `subject-kind`, `subject-id` and `title`;
  - content is a core `ActionRequest`. Questions are medium tier; alerts are low.
- **Answers are the operator's signed decisions.** At the start of each night the engine ingests the kind-31403 decisions on those cases. It verifies each signature, ignores decisions signed by JunkieJarvis itself, requires the decision to name the currently published request, and takes the newest per case.
  - approve → answered (an alert → acknowledged and dismissed);
  - reject → answered, with the reason;
  - amend → answered, with the operator's text;
  - delegate → stays open.
  - The panel-level `acknowledge-alerts` action dismisses the open alerts published before it was pressed.
- **The inbox JSON is the engine's working copy, not the operator's inbox.** `scripts/dream-inbox.mjs` stays as a local break-glass path.
- **The digest reports every outcome.** It is composed in Rust from the night-health record, which now also lists the nominated, standby and cap-deferred repos. It states ACCEPT, REJECT, INCONCLUSIVE, BLOCKED-ENV, HANDOFF, FAILED and nights where nothing was eligible, and ends with the number of decisions waiting and a link to the panel. It remains visibility, not approval.
- **The session hook is a reminder only**: one line with the count and the panel URL, at most every four hours, and no item bodies.

## Consequences

- The relay admits 31400/31402 only from keys in its `agent_registry`, so JunkieJarvis must be registered there before anything reaches the panel. Until then publishing is rejected, and each item stays unpublished and is retried the next night. That is why activation is `staged`.
- Decisions get what the governance plane already provides: an admin-only signing gate, a receipt trail, supersession, ageing (`max-pending-hours = 168`) and a rationale requirement at higher tiers.
- Only the forum's fixed per-case controls exist (Approve / Reject / Amend / Delegate), so there is no per-case "dismiss". Approving an alert acknowledges it, and Amend carries free text.
- `scripts/dream-night-digest.mjs` and its `DREAM_DIGEST_STYLE=terse` form are deleted. The engine owns digest and governance I/O (`dream-engine digest`, `dream-engine governance publish|ingest`).
- Forum I/O is fail-open (`DREAM_GOVERNANCE=0` opts out). An unreachable relay delays a decision by a night but never taints one.

## Verification

At `verified_commit`, `cargo test` in `services/dream-engine` passes 192 tests, including:
- panel/case round-trips through core `PanelDefinition`/`ActionRequest`/`PanelPolicy`/`TaskProperties`, with tag and content declarations agreeing;
- the decision mapping;
- rejection of self-signed, forged and stale-bound decisions;
- the scope of the panel acknowledgement;
- digest composition for normal, harness-failure, zero-eligible, legacy-record and missing-record nights.

`cargo clippy --all-targets -- -D warnings` is clean.

Licensing: `dream-engine` is `AGPL-3.0-only` (operator decision 2026-09-25, recorded in ADR-2030) and links `nostr-bbs-core` directly. Event types, signing (`sign_event`), strict verification (`verify_event_strict`), key parsing and every governance wire type (`PanelDefinition`, `ActionRequest`, `DecisionOutcome`, `TaskProperties`, `PanelPolicy`, `RiskTier`, `KIND_*`) are the forum's own, so the engine cannot drift from the relay and client parsers; the tests are direct round-trips through those types. (An earlier cut of this change kept the crate permissive by mirroring the wire types over the MIT `nostr` crate; the operator chose linking core instead.)

`dream-engine governance publish --dry-run` against a copy of the live inbox emitted the expected 31400/31402 wire format. `dream-engine digest --dry-run` rendered the 2026-09-25 zero-eligible night.

`node tests/config/dream-inbox-surface.test.mjs` passes 8 checks: pointer only, no item bodies, the inbox is not written, rate-limited, and fail-open.
