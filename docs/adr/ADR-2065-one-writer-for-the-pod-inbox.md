---
id: ADR-2065
title: One writer for the pod inbox — the Rust pod bridge, not the JS relay consumer
date: 2026-09-05
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: e070514d808b218574403377fb75e0e1a0a256b3
verified_paths: []
owner: jjohare
review_trigger: implementing ACSP governance, agent-intent, payment or external-fanout handling in services/nostr-pod-bridge, changing `[sovereign_mesh.relay].implementation` or `.pod_bridge`, or adding a second process that writes under pods/<npub>/events/
repo: agentbox
domain: INGRESS-identity
lineage: ADR-009 (relay-consumer bridge), ADR-2012 (relay admission vs inbox authorisation), ADR-037 D2 (governance decision waiter), ADR-039 (apply classes), PRD-010 F16/F19, PRD-014 Seam B3
---

# ADR-2065 — One writer for the pod inbox — the Rust pod bridge, not the JS relay consumer

## Context

Two processes wrote `pods/<npub>/events/inbox/<id>.json` in the running image,
both confirmed live: the Rust `nostr-pod-bridge` daemon (supervised as
`[program:nostr-relay]`, log `pod-ingress consumer started`) and the JS
`RelayConsumer` started in-process by management-api (log `RelayConsumer
started — pod-bridge active`).

The overlap is total, not limited to gift wraps. Rust `process_event`
(`services/nostr-pod-bridge/src/lib.rs`) applies a pubkey allowlist and an
addressed-to check but **no kind filter**: `effective_message` passes non-1059
kinds straight through, so every admitted, addressed event is written to
`inbox_path(..., &ev.id)` — the same outer event id, and therefore the same
filename, the JS consumer uses.

The duplication was actively harmful. The JS consumer deduplicated by testing
whether the inbox file already existed; the daemon shares the relay's broadcast
channel in-process and normally wins that race, so its write was read as a
duplicate and the JS consumer returned **before** dispatching the surfaces only
it implements — ACSP governance (31400-31405, including the ADR-037 D2
`governanceDecisionSink` that releases an authority gate awaiting a signed
31403), agent-intent (38000+), and payments (38200/38201).

Deleting the JS consumer outright was rejected: none of those surfaces, nor the
outbox publisher and external fanout, exist in the Rust crate, and
`tests/contract/governance-flow.spec.js` and
`tests/config/multi-user-regression.test.js` both import the module.

## Decision

Exactly one process writes the pod inbox, and it is the Rust
`nostr-pod-bridge` daemon whenever that daemon is running.

- `RelayConsumer` takes `writeInbox` (default **true**). False hands
  `pods/<npub>/events/inbox/` to the daemon; the consumer then owns only what
  the Rust crate does not implement: ACSP governance, agent-intent, payments,
  the events-adapter dispatch, the outbox publisher and external fanout.
- In delegated mode dedup is in-process (a seen-event-id set), never by probing
  a file another process owns. This is what stops the daemon's write from
  suppressing governance, intent and payment dispatch.
- Ownership is stated, not guessed. `flake.nix` projects
  `AGENTBOX_POD_INBOX_WRITER` from `podBridgeEnabled` — the **same** expression
  that gates the daemon's supervisor block — so the env var reports whether the
  daemon is actually running. Until a rebuild carries it, `server.js` reproduces
  that expression from env the image already exports (`AGENTBOX_RELAY_IMPL`
  local ∧ `AGENTBOX_RELAY_POD_BRIDGE`), so the two paths encode one expression
  and cannot disagree.
- The default remains "this consumer writes the inbox", because when the relay
  slot is not served locally (`implementation = "external"`, or `pod_bridge`
  off) the daemon does not run and the JS consumer is the only writer. An
  unconditional removal would have silently dropped ingress in that
  configuration.
- `[sovereign_mesh.relay].pod_bridge` keeps its meaning: the first-party pod
  bridge is active. This ADR does not change that key or the daemon's own gate,
  environment or behaviour.

## Consequences

- The pod inbox has a single writer with an enforced publisher allowlist, and
  the governance/intent/payment dispatch stops being silently suppressed by a
  race — a live correctness fix, not just deduplication.
- The JS consumer is narrowed, not deleted. It remains the only implementation
  of four surfaces; retiring it requires implementing those in the Rust crate
  first (the `review_trigger` above).
- Verified divergence, recorded rather than fixed here: the JS consumer's
  `AGENTBOX_RELAY_ALLOWED_PUBKEYS` is never set by `flake.nix`, and its
  `allowlist` policy treats an empty set as allow-all
  (`this._allowedPubkeys.size === 0 || …`). Its configured `ingress_policy` is
  therefore inert; it inherits whatever the relay admits. The relay-boundary
  gate (ADR-2012) currently makes this non-exploitable, but it is a
  defence-in-depth gap.
- Apply class: **rebuild** for the projected env var (ADR-039); the fallback
  makes the consolidation effective on the next management-api restart.
  `activation_status: staged` until that restart.

## Verification

Verified on the uncommitted working tree above
`e070514d808b218574403377fb75e0e1a0a256b3` (`git rev-parse HEAD`); the changes
described here were not committed at verification time, so `verified_paths` is
empty.

- Both writers confirmed live: `supervisorctl status` (`nostr-relay` pid 388,
  `management-api` pid 385); `/var/log/nostr-relay.log` → `pod-ingress consumer
  started`; `/var/log/management-api.log` → `RelayConsumer started — pod-bridge
  active`.
- Kind-agnostic overlap confirmed by reading `authorize`, `effective_message`
  and `process_event` in `services/nostr-pod-bridge/src/lib.rs`: no kind filter
  on the inbox write, keyed on the outer `ev.id`.
- `node --test tests/contract/governance-flow.spec.js` → 24 tests, 24 pass,
  0 fail. Four new `[ADR-2065] delegated inbox mode` cases assert that in
  delegated mode the consumer writes no inbox file, still routes governance
  events, is **not** suppressed by an inbox file the daemon already wrote, and
  still dedups a genuinely repeated event. The pre-existing legacy-mode
  assertions (including "writes inbound event to inbox as LDN-formatted
  payload") continue to pass unchanged.
- `cd management-api && ./node_modules/.bin/jest` → 80 suites, 1289 passed,
  0 failed.
- `node --check` clean on `management-api/server.js`,
  `mcp/nostr-bridge/relay-consumer.js`, `management-api/adapters/index.js`.
- The daemon's supervisor block in `flake.nix` is untouched and still carries
  `AGENTBOX_RELAY_BIND`, `AGENTBOX_POD_ROOT`, `AGENTBOX_ADMIN_PUBKEY` and
  `AGENTBOX_ALLOWED_PUBKEYS`. `nix` is not installed in this container, so the
  edit was reviewed by reading scope rather than evaluated; `podBridgeEnabled`
  is defined in the same `let` as `relayImpl`, which the same env list already
  interpolates.
