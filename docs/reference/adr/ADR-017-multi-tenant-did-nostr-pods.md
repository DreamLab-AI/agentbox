# ADR-017 — Multi-Tenant did:nostr Pods

- **Status:** Proposed
- **Date:** 2026-05-16
- **Deciders:** DreamLab AI core team
- **Related:** [ADR-009](ADR-009-embedded-nostr-relay.md) (embedded Nostr relay),
  [ADR-010](ADR-010-rust-solid-pod-adoption.md) (rust solid-pod adoption),
  [ADR-015](ADR-015-mcp-ruvector-mandate.md) (ruvector MCP mandate),
  [ADR-016](ADR-016-license-consolidation.md) (license consolidation),
  [PRD-004](../prd/PRD-004-external-agent-messaging.md) (external agent messaging),
  [PRD-007](../prd/PRD-007-multi-tenant-federation.md) (multi-tenant federation),
  PRD-010 (mesh federation), ADR-073 (federation peer trust)

## Context

agentbox today is **single-tenant**: one operator pubkey owns one pod at
`pods/<operator-npub>/`. Identity, relay, and pod all reference that single
key. The architecture works for individual operators but does not compose
with two pressures the project now faces:

1. **Teams and homelabs want shared infrastructure.** A single agentbox
   container should host pods for multiple users — keyed by their own
   sovereign `did:nostr` identities — without forcing each user to run
   their own container.
2. **Federation requires per-user routing.** PRD-010 / ADR-073 federation
   peers exchange events that name specific recipients in `p` tags. The
   relay-consumer already routes inbound events to `pods/<recipient>/events/inbox/`
   keyed by the `p`-tag pubkey, but the current pod set only contains the
   operator. Extending the pod set is the missing piece.

solid-pod-rs is already multi-pod-capable; the pod tree at `pods/<npub>/`
is an architectural pattern, not a singleton. NRF's pod-worker is already
multi-user via R2 paths. The work for this ADR is on the agentbox side:
provisioning policy, lifecycle, admin surface, and the trust model for
accepting new user pubkeys.

This ADR is **architectural only**. Provisioning logic is scaffolded
behind `enabled = false`; implementation is queued for follow-on after
solid-pod-rs alpha.12 lands (which adds `--provision-keys` and git
auto-init per pod).

## Decision

### Pod path convention

Pods live at `pods/<did:nostr:pubkey-hex>/` — 64-char lowercase hex, no
bech32 in the path. This matches the existing operator-pubkey path and
keeps the filesystem free of `bech32` decode dependencies during cold-path
operations (boot, dirent traversal).

The DID URI for each pod is `did:nostr:<pubkey-hex>`. WAC documents,
NIP-98 auth records, and LDN inbox payloads all reference that DID.

### Provisioning trigger and policy

A new pod is provisioned on the **first successful NIP-42 AUTH from an
unrecognised pubkey**, GATED by operator policy. Three modes:

| Policy        | Behaviour                                                                                         |
|---------------|----------------------------------------------------------------------------------------------------|
| `closed`      | No automatic provisioning. Operator adds users manually via `/admin/users/provision`. (Default.) |
| `invite-only` | Provisioning requires a valid invite event (NIP-58-style, kind `30910` by default) signed by the operator or an admin. The invite carries the user pubkey and a `valid_until` timestamp. |
| `open`        | Any pubkey that successfully AUTH'd over NIP-42 gets a pod. Homelab / open-signup mode. Raises validator warning `W037`. |

The policy is configured at `[sovereign_mesh.multi_user].provisioning_policy`.

### Pod lifecycle states

```
   ┌──────────┐  NIP-42 AUTH + policy pass    ┌────────┐
   │ Pending  │ ───────────────────────────▶  │ Active │
   └──────────┘                               └───┬────┘
                                                  │ admin: suspend
                                                  ▼
                                            ┌────────────┐
                                            │ Suspended  │
                                            └─────┬──────┘
                                                  │ admin: archive
                                                  ▼
                                            ┌────────────┐
                                            │  Archived  │  (read-only)
                                            └────────────┘
```

- **Pending** — provisioning in flight (pod directory created, keys being
  written, NIP-05 entry pending). Inbound events for this pubkey are
  buffered in `pods/<pubkey>/events/inbox.pending/`.
- **Active** — pod accepts read and write traffic. WAC enforces per-pod
  isolation; cross-pod access requires explicit ACL grant.
- **Suspended** — pod rejects writes (HTTP 423 Locked); reads continue.
  Inbound events for this pubkey are silently dropped (or, in invite-only
  mode, returned to sender as a NIP-58 attestation).
- **Archived** — pod is read-only and excluded from federation
  fanout. The directory remains on disk for export.

State transitions are auditable: each transition emits a NIP-58 attestation
event (kind `30910`) signed by the operator or an admin, naming the affected
pubkey and the new state.

### WAC isolation

WAC isolation is delegated to solid-pod-rs. Each pod is its own WAC
document tree. The default ACL grants `read` and `write` on
`pods/<X>/...` to `did:nostr:<X>` and `read` to admin pubkeys.
Cross-pod access requires an explicit WAC ACL grant on the target pod;
agentbox does not provide a cross-pod ambient authority.

### Per-pod features (Phase 1 — post alpha.12)

When solid-pod-rs alpha.12 lands and the `[sovereign_mesh.git]` wiring is
completed (queued task `agentbox-git-wiring`), each provisioned pod
additionally gets:

- A sovereign keypair under `pods/<X>/.identity/` (via solid-pod-rs
  `--provision-keys`).
- A git-initialised repository inside the pod root (via `--git-init`).
- A NIP-05 entry at `<local-part>@<agentbox-host>` resolving to the pubkey.
- A clone URL of the form `https://<agentbox-host>/git/<pubkey>/...`
  surfaced by management-api's `git-bridge` route.

Phase 1 provisioning is **out of scope for this ADR**; the wiring lands
with the git-wiring task.

### Operator vs user pods

The operator pubkey still gets a pod at boot — but it is no longer
architecturally distinct. The operator is a **user with admin role**.
Admin roles are listed in `[sovereign_mesh.multi_user].admin_pubkeys`.
The legacy operator pod path remains valid; existing deployments that
hold the entire pod tree at `pods/<operator-npub>/` continue to work
byte-for-byte unchanged when `enabled = false`.

### Federation interaction

When `[mesh].mode = "federated"`, an agentbox container becomes a
**multi-user pod host** in the mesh. Peers see it as one Nostr identity —
the operator's relay identity, used to sign NIP-42 AUTH on outbound
connections — but per-user signed events flow through the relay with the
correct `pubkey` field, and the relay-bridge routes each event to the
matching `pods/<recipient>/events/inbox/`.

ADR-073 peer trust applies at the relay level (the operator decides which
peer relays to subscribe to). Per-pod trust is governed by WAC inside
solid-pod-rs.

## Consequences

### Positive

- Each user owns a sovereign identity. No central account service. No
  cross-user data leakage at the pod level (WAC enforces it).
- Ecosystem coherence: NRF's pod-worker is already multi-user; agentbox
  matches that model.
- Enables the broader federation vision: a network of multi-user
  agentbox containers connected by NIP-42 peer-trusted relays.

### Negative

- Disk usage scales with users. Quota policy is deferred to a follow-on
  ADR (PRD-008 will cover per-user resource quotas and payment routing).
- Admin surface grows: `/admin/users/provision`, `/admin/users/:pubkey/suspend`,
  `/admin/users/:pubkey/archive`. Documented in PRD-007.
- Per-user key rotation policy is needed and is deferred to a follow-on ADR.

### Neutral

- solid-pod-rs needs no changes. The pod tree convention has always been
  per-pubkey; we are populating it with more pubkeys.
- The validator gains three error rules and one warning (E055, E056, E057, W058).
- Scaffold defaults are off. Existing single-tenant deployments are
  unchanged.

## Out of scope (deferred)

- Per-user resource quotas (disk, event count, rate-limit) — PRD-008.
- Per-user payment routing (HTTP 402, MRC20) — PRD-008 or solid-pod-rs
  payments integration.
- Cross-container user migration (export from agentbox A, import to
  agentbox B) — separate ADR.
- Per-user key rotation policy — separate ADR.

## Verification

- `nix flake check` passes with `enabled = false` (regression-tested via
  `tests/config/multi-user-regression.test.js`).
- `tests/config/semantic-rules.test.js` exercises E055, E056, E057, W058.
- A regression assertion confirms that with `[sovereign_mesh.multi_user].enabled = false`,
  the relay-consumer's inbound write path is byte-for-byte identical to the
  pre-ADR-017 behaviour.
