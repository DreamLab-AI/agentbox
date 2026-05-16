# PRD-007 — Multi-Tenant Federation

- **Status:** Proposed
- **Date:** 2026-05-16
- **Extends:** [PRD-004](PRD-004-external-agent-messaging.md) (external agent messaging)
- **Composes with:** PRD-010 (mesh federation), [ADR-017](../adr/ADR-017-multi-tenant-did-nostr-pods.md),
  [ADR-073] (federation peer trust)
- **Owner:** agentbox-federation-architect

## Summary

Extend agentbox from single-tenant (one operator pod) to **multi-tenant**:
a single agentbox container hosts a pod for each `did:nostr` user who is
provisioned by operator policy. Federation peers see one Nostr identity at
the relay level; per-user signed events route to the correct pod.

## User stories

- **Operator.** "I run a single agentbox container that hosts pods for my
  team. Users authenticate with their own did:nostr keys; their pods are
  provisioned automatically (invite-only or open) or after my approval
  (closed)."
- **User.** "I join an agentbox by signing a NIP-42 AUTH with my did:nostr
  key. In invite-only mode I include a valid invite event signed by the
  operator. My pod is provisioned in under 2 seconds (P95)."
- **Federated peer.** "I subscribe to events from the agentbox's relay.
  Per-user signed events arrive with the correct `pubkey` field and route
  to my own pod's inbox. The agentbox identity (operator npub) is opaque
  to me at the relay handshake level; user-level addressing is via `p`-tag
  routing."

## Functional requirements

| F#   | Requirement                                                                              |
|------|------------------------------------------------------------------------------------------|
| F1   | Pod path layout is `pods/<pubkey-hex>/`; 64-char lowercase hex; no bech32 in path.       |
| F2   | Provisioning policy is one of `closed` / `invite-only` / `open`, configured in TOML.     |
| F3   | `closed` mode rejects automatic provisioning; admins use `/admin/users/provision`.       |
| F4   | `invite-only` mode validates a NIP-58-style invite event (default kind `30910`) signed by an operator or admin pubkey. Invite has `valid_until` ≤ `invite_validity_seconds`. |
| F5   | `open` mode provisions a pod for any pubkey that completes NIP-42 AUTH (homelab mode).   |
| F6   | Pod lifecycle states: `Pending` → `Active` → `Suspended` → `Archived`. State transitions emit NIP-58 attestation events (kind `30910`) signed by an admin. |
| F7   | Admin endpoints (501 in this PRD; implemented in PRD-007-impl follow-on): `POST /admin/users/provision`, `POST /admin/users/:pubkey/suspend`, `POST /admin/users/:pubkey/archive`. |
| F8   | Relay-consumer routes inbound events with `p`-tag = `<pubkey>` to `pods/<pubkey>/events/inbox/`. Behaviour is unchanged when multi-user is disabled. |
| F9   | WAC isolation: each pod is its own WAC document tree. Cross-pod access requires explicit grant. |
| F10  | Operator role: the operator pubkey is auto-added to `admin_pubkeys` at boot.             |
| F11  | Federation: when `[mesh].mode = "federated"`, the agentbox is a multi-user pod host. Per-user events flow through the relay with the correct `pubkey`. Peer trust applies at relay level. |

## Non-functional requirements

| NFR# | Requirement                                                                              |
|------|------------------------------------------------------------------------------------------|
| NFR1 | Per-user pod provisioning under 2 seconds (P95) when invite/key validation passes.       |
| NFR2 | Pod state-machine transitions are auditable: every transition is signed (NIP-58 kind `30910`) and replayable from the relay event log. |
| NFR3 | At least 10 concurrent users per container without contention. Sized for small-team / homelab scale. |
| NFR4 | Defaults OFF — every existing single-tenant deployment continues working byte-for-byte unchanged when `enabled = false`. |
| NFR5 | Combined-work AGPL §13: management-api MUST surface a Corresponding Source endpoint for the running aggregate (deferred to existing `/v1/meta`). |

## Out of scope (deferred)

- **Per-user resource quotas** (cap on disk usage, event count, rate-limit
  per pubkey). Deferred to PRD-008.
- **Per-user payment routing** (HTTP 402 challenge keyed by pubkey, MRC20
  token flow per user). Deferred to PRD-008 or solid-pod-rs payments
  integration.
- **Cross-container user migration** (export from agentbox A, import to
  agentbox B). Deferred to a follow-on ADR.
- **Per-user key rotation policy**. Deferred to a follow-on ADR.
- **Implementation of provisioning, suspend, archive endpoints.** This
  PRD scaffolds the surfaces; bodies return `501 Not Implemented` until
  the implementation pass after solid-pod-rs alpha.12 lands and the
  `[sovereign_mesh.git]` wiring is in place.

## Acceptance criteria

1. `agentbox-config-validate` emits `E055`, `E056`, `E057`, `W058` for
   the documented invalid configurations.
2. With `[sovereign_mesh.multi_user].enabled = false`, the relay-consumer's
   inbound write path is byte-for-byte identical to the pre-PRD-007 baseline
   (regression test in `tests/config/multi-user-regression.test.js`).
3. With `enabled = true` and `provisioning_policy = "invite-only"`, the
   admin endpoints are mounted and respond `501 Not Implemented` with a
   `link` header pointing to PRD-007.
4. `docs/user/multi-user-pods.md` exists and is cross-linked from
   `docs/user/nostr-relay.md` and `docs/reference/adr/ADR-010-rust-solid-pod-adoption.md`.

## Risks

- **Disk pressure under `open` mode.** Without quotas (deferred), a
  malicious actor could AUTH with thousands of pubkeys. Mitigation:
  `max_users` cap; validator warning `W058` on `open` policy; recommend
  operators stay on `invite-only` until PRD-008 lands.
- **WAC misconfiguration.** A wrong default ACL could leak across pods.
  Mitigation: ADR-017 defines the default ACL explicitly; integration
  test asserts cross-pod read returns 403.
- **Federation address confusion.** Peers expecting one-pubkey-per-relay
  may misroute. Mitigation: PRD-010 NIP-42 peer trust applies at relay
  level; per-user routing uses `p`-tag, not relay identity.
