# Multi-User did:nostr Pods

> **Status:** scaffolded. Defaults OFF. Provisioning logic lands after
> solid-pod-rs alpha.12 ships and the `[sovereign_mesh.git]` wiring is
> in place. This page documents the design surface so operators can
> plan deployment shapes today. See
> [ADR-017](../reference/adr/ADR-017-multi-tenant-did-nostr-pods.md) and
> [PRD-007](../reference/prd/PRD-007-multi-tenant-federation.md).

## When to enable multi-user mode

agentbox is single-tenant by default — one operator owns the only pod at
`pods/<operator-npub>/`. Multi-user mode is the right choice when:

- **Team deployment.** You operate a single container for a development
  team. Each engineer holds their own `did:nostr` key and owns their pod.
- **Community / homelab.** You host a friends-and-family agentbox; users
  show up with their existing Nostr identity.
- **Federation participation.** Your container is one node in a PRD-010
  mesh. Per-user signed events arrive from peers and must route to the
  correct pod, not to the operator's catchall inbox.

Stay single-tenant when:

- You are a solo operator. The legacy single-pod layout is one less
  moving part.
- Your deployment never sees external pubkeys (no NIP-42 AUTH from
  anyone other than the operator).

## Pod path layout

```
pods/
├── 7fa3…<operator-pubkey-hex>/        # operator pod (always present)
│   ├── briefs/
│   ├── memory/
│   ├── events/
│   │   ├── inbox/
│   │   └── outbox/
│   └── .acl/                           # WAC documents
├── 4b21…<user-A-pubkey-hex>/          # provisioned via /admin/users/provision
└── 9e08…<user-B-pubkey-hex>/          # provisioned via invite or open AUTH
```

Pubkeys in the path are 64-char lowercase hex (no bech32). Each pod is
WAC-isolated by solid-pod-rs; cross-pod access requires explicit ACL.

## Provisioning policies

`[sovereign_mesh.multi_user].provisioning_policy` selects how new user
pubkeys are accepted:

### `closed` (default)

No automatic provisioning. The operator manually adds users via
`POST /admin/users/provision`. Use this when you want explicit control
over membership.

### `invite-only`

Provisioning requires a valid invite event (default kind `30910`,
NIP-58-style) signed by an operator or admin pubkey. The invite carries
the user pubkey and a `valid_until` timestamp bounded by
`invite_validity_seconds`. Use this for team or community deployments
where the operator wants a vetted invite flow without manual
provisioning.

### `open`

Any pubkey that completes NIP-42 AUTH gets a pod. **Homelab mode.**
Raises validator warning `W058`. Requires `max_users > 0` (validator
rule `E057`).

> **Security implication.** `open` is unsafe in production. There are no
> per-user resource quotas yet (deferred to PRD-008); a malicious actor
> could AUTH with many pubkeys and fill disk. Stay on `invite-only`
> until PRD-008 ships.

## User lifecycle commands

These endpoints are mounted by management-api when
`[sovereign_mesh.multi_user].enabled = true`. They return `501 Not
Implemented` in the current scaffold release; bodies land in the
implementation pass.

### Provision a user

```bash
curl -X POST https://<agentbox>/admin/users/provision \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "pubkey": "4b21…<64-char-hex>",
    "invite": "<optional signed invite event JSON>"
  }'
```

Creates `pods/<pubkey>/`, writes the default WAC ACL, mints a NIP-05
entry (once Phase 1 lands), and emits a NIP-58 attestation event marking
the pod as `Active`.

### Suspend a user

```bash
curl -X POST https://<agentbox>/admin/users/<pubkey>/suspend \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"reason": "policy violation: spam"}'
```

Writes are rejected with `423 Locked`. Reads continue. The transition is
attestable via a kind `30910` event signed by an admin.

### Archive a user

```bash
curl -X POST https://<agentbox>/admin/users/<pubkey>/archive \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"reason": "user departed team"}'
```

Pod becomes read-only; excluded from federation fanout. Directory
remains on disk for export.

## Federation interaction (PRD-010 mesh)

When `[mesh].mode = "federated"`, the agentbox container is a
**multi-user pod host** in the mesh. From a peer's perspective:

- The relay-level identity is the operator's npub — that is the pubkey
  used to sign NIP-42 AUTH on outbound peer connections.
- Per-user signed events flow through the relay with the correct
  `pubkey` field. `p`-tag routing delivers them to
  `pods/<recipient-pubkey>/events/inbox/`.
- ADR-073 peer trust applies at the relay level, not the pod level.
  Per-pod trust is governed by WAC inside solid-pod-rs.

## Phase 1: git per user (forward reference)

When solid-pod-rs alpha.12 ships and the
[`[sovereign_mesh.git]`](../reference/adr/ADR-010-rust-solid-pod-adoption.md)
wiring lands (queued task: `agentbox-git-wiring`), every provisioned pod
additionally gets:

- A sovereign keypair under `pods/<pubkey>/.identity/`.
- A git-initialised repository at the pod root.
- A NIP-05 entry at `<local-part>@<agentbox-host>` resolving to the
  pubkey.
- A clone URL surfaced by management-api's `git-bridge` route:
  `https://<agentbox-host>/git/<pubkey>/...`

This per-user git surface is the substrate for did:nostr-keyed bead
provenance and forum-side clone flows. It is not part of this scaffold —
it lands with the git-wiring pass.

## Configuration reference

```toml
[sovereign_mesh.multi_user]
enabled                     = false       # opt-in
provisioning_policy         = "closed"    # closed | invite-only | open
invite_kind                 = 30910       # NIP-58 invite event kind
invite_validity_seconds     = 86400       # 24 hours
max_users                   = 100         # safety cap
suspend_inactive_after_days = 90          # admin policy
admin_pubkeys               = []          # operator auto-added at boot
```

Validator rules:

| Rule  | Condition |
|-------|-----------|
| `E055` | `multi_user.enabled = true` requires `sovereign_mesh.solid_pod = true` |
| `E056` | `provisioning_policy = "invite-only"` requires `invite_kind` to be a valid Nostr kind (0..65535); also fires for unrecognised policy values |
| `E057` | `provisioning_policy = "open"` requires `max_users > 0` |
| `W058` | `provisioning_policy = "open"` raises warning — prefer `invite-only` until per-user quotas land (PRD-008) |

## See also

- [ADR-017](../reference/adr/ADR-017-multi-tenant-did-nostr-pods.md) — design rationale
- [PRD-007](../reference/prd/PRD-007-multi-tenant-federation.md) — product requirements
- [docs/user/nostr-relay.md](nostr-relay.md) — pod inbox routing
- [ADR-010](../reference/adr/ADR-010-rust-solid-pod-adoption.md) — solid-pod-rs adoption
- [ADR-016](../reference/adr/ADR-016-license-consolidation.md) — AGPL-3.0-only across the board
