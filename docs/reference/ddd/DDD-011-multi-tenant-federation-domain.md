# DDD-011: Multi-Tenant Federation Domain

**Date**: 2026-05-27
**Status**: Draft
**Bounded Context**: Multi-Tenant Federation
**Cross-references**: PRD-007 (multi-tenant federation), ADR-017 (multi-tenant did:nostr pods), ADR-009 (embedded Nostr relay), ADR-010 (Rust solid-pod adoption), ADR-013 (canonical URI grammar), DDD-003 (sovereign messaging — relay transport), DDD-001 (bootstrap — operator identity materialised at boot)

---

## Domain Purpose

The Multi-Tenant Federation domain governs how a single agentbox container provisions and isolates sovereign pods for multiple `did:nostr` users, routes inbound relay events to per-user inboxes, and presents a coherent operator identity to federation peers. Its job is to enforce the boundary between operator-level mesh trust and per-user pod ownership.

## Bounded Context Definition

**Boundary**: This domain owns pod provisioning policy, pod lifecycle state transitions, per-user WAC isolation enforcement, and federation peer addressing.

**Owns**: Provisioning policy configuration, pod lifecycle state machine, admin role assignments, p-tag-based inbound routing, per-pod WAC document trees.

**Does not own**: Relay transport mechanics (DDD-003), solid-pod-rs WAC enforcement internals, per-user resource quotas (deferred to PRD-008), cross-container user migration.

## Ubiquitous Language

| Term | Definition |
|---|---|
| **Tenant** | A `did:nostr:<pubkey-hex>` identity that has been provisioned a pod within the container. |
| **Operator** | The bootstrap-time pubkey that owns admin authority; implemented as a tenant with admin role. |
| **Provisioning Policy** | The rule set (`closed`, `invite-only`, `open`) that gates automatic pod creation on first NIP-42 AUTH. |
| **Pod Lifecycle State** | One of `Pending`, `Active`, `Suspended`, `Archived` — the authoritative status of a tenant pod. |
| **Invite Event** | A NIP-58-style Nostr event (kind `30910`) signed by an admin pubkey, authorising one pubkey to receive a pod. |
| **WAC Isolation** | Per-pod Web Access Control enforcement delegated to solid-pod-rs; cross-pod access requires explicit ACL grant. |
| **Federation Fanout** | The relay-level delivery of per-user signed events to peers, keyed by `p`-tag pubkey, not relay identity. |

## Aggregates

### FederationPeer (Root Aggregate)

Represents one agentbox container's relationship with the multi-tenant pod set and its presentation to external relay peers.

```
FederationPeer
  +-- operatorDID: did:nostr:<pubkey-hex>
  +-- meshMode: "standalone" | "federated"
  +-- provisioningPolicy: ProvisioningPolicy
  +-- adminPubkeys: string[]            // 64-char hex
  +-- tenants: TenantRecord[]
  |
  +-- ProvisioningPolicy
  |     +-- mode: "closed" | "invite-only" | "open"
  |     +-- maxUsers: number | null
  |     +-- inviteKind: number           // default 30910
  |     +-- inviteValiditySeconds: number
  |
  +-- TenantRecord
        +-- pubkeyHex: string            // 64-char lowercase hex
        +-- did: did:nostr:<pubkeyHex>
        +-- podPath: string              // pods/<pubkeyHex>/
        +-- lifecycleState: PodLifecycleState
        +-- provisionedAt: timestamp | null
        +-- adminRole: boolean
```

### MeshTopology

Tracks the container's position in the federation mesh and the set of trusted relay peers.

```
MeshTopology
  +-- mode: "standalone" | "federated"
  +-- peers: FederationPeerRef[]
  |
  +-- FederationPeerRef
        +-- relayUrl: string
        +-- trustLevel: "peer" | "observer"
        +-- peerPubkeyHex: string | null
```

### TenantIsolation

Enforces the WAC boundary for one tenant pod. Owned by this domain at the policy level; WAC document enforcement is delegated to solid-pod-rs.

```
TenantIsolation
  +-- tenantDID: did:nostr:<pubkey-hex>
  +-- podPath: string                   // pods/<pubkeyHex>/
  +-- defaultACL: WACPolicy
  +-- adminReadGrant: boolean           // admin pubkeys get read on all pods
  +-- crossPodGrants: CrossPodGrant[]
  |
  +-- WACPolicy
  |     +-- owner: did:nostr string
  |     +-- readAgents: string[]
  |     +-- writeAgents: string[]
  |
  +-- CrossPodGrant
        +-- granteeDID: string
        +-- targetPath: string
        +-- mode: "read" | "write"
```

## Invariants

1. **Pod path is hex-only.** Every tenant pod path is `pods/<64-char-lowercase-hex>/`. No bech32 encoding appears in filesystem paths. This is unconditional regardless of provisioning mode.

2. **Provisioning policy gates pod creation.** A pod MUST NOT be created for an unrecognised pubkey unless the active `ProvisioningPolicy.mode` permits it: `closed` requires admin action; `invite-only` requires a valid signed invite event with a non-expired `valid_until`; `open` accepts any successful NIP-42 AUTH. Violating this invariant is a security boundary failure.

3. **Lifecycle transitions are auditable.** Every pod state transition (`Pending→Active`, `Active→Suspended`, `Suspended→Archived`) MUST emit a NIP-58 attestation event (kind `30910`) signed by an admin pubkey naming the affected tenant. No transition occurs without an attestation.

4. **WAC isolation is default-deny cross-pod.** A tenant pod's default ACL grants `read+write` only to `did:nostr:<ownPubkey>` and `read` to admin pubkeys. No ambient cross-pod authority exists; access to another tenant's pod requires an explicit `CrossPodGrant` recorded in `TenantIsolation`.

5. **Disabled mode is byte-identical to single-tenant.** When `[sovereign_mesh.multi_user].enabled = false`, the relay-consumer's inbound write path MUST be byte-for-byte identical to the pre-ADR-017 baseline. No multi-tenant code paths execute.

6. **Federation fanout uses p-tag routing, not relay identity.** When `meshMode = "federated"`, per-user events delivered to peers carry the correct tenant `pubkey` field and are routed by peers using `p`-tag, not the operator relay identity. The operator's relay identity is used only for NIP-42 peer authentication at the transport level.

## Domain Events

| Event | Trigger | Payload |
|---|---|---|
| `PodProvisioningRequested` | NIP-42 AUTH from unrecognised pubkey + policy passes | `{ pubkeyHex, policyMode, timestamp }` |
| `PodActivated` | Provisioning completes; pod is ready | `{ pubkeyHex, podPath, timestamp }` |
| `PodSuspended` | Admin suspends a tenant pod | `{ pubkeyHex, adminPubkey, timestamp }` |
| `PodArchived` | Admin archives a suspended pod | `{ pubkeyHex, adminPubkey, timestamp }` |
| `InviteValidated` | Valid invite event accepted for invite-only provisioning | `{ inviteeHex, inviterHex, timestamp }` |
| `CrossPodGrantIssued` | Explicit WAC grant added between two tenant pods | `{ granteeDID, targetPath, mode }` |

## Integration Points

| Consuming Domain | Interface | Direction | Notes |
|---|---|---|---|
| Sovereign Messaging (DDD-003) | Relay NIP-42 AUTH events | Inbound → Federation | First signal for unrecognised pubkey; triggers provisioning policy check |
| Immutable Bootstrap (DDD-001) | Operator pubkey + admin list | Bootstrap → Federation | Seeds the `FederationPeer.operatorDID` and `adminPubkeys` at boot |
| solid-pod-rs | WAC document tree creation | Federation → Pod Store | Creates `pods/<hex>/` with default ACL on `PodActivated` |
| Linked-Data Interchange (DDD-004) | Attestation events (NIP-58) | Federation → Relay | State-transition attestations are signed Nostr events emitted to the embedded relay |
