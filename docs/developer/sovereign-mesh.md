# Sovereign mesh — Nostr client

Agentbox's sovereign mesh feature publishes and receives [Nostr](https://nostr.com/) events
when `[sovereign_mesh].nostr_bridge = true` in `agentbox.toml`.

## Context in one paragraph

The sovereign mesh is the optional inter-agent identity and event layer — "sovereign" because each agentbox container holds its own secp256k1 keypair (the same curve Bitcoin and Nostr use) and signs events under that identity rather than relying on a central broker. It is implemented as a Nostr client (Nostr is a minimal open protocol: signed JSON events, pubkey-addressed, gossipped through relay servers) embedded in-process inside `management-api`. Use cases: publishing agent lifecycle events to a shared relay pool, authenticating inbound HTTP requests via [NIP-98](https://github.com/nostr-protocol/nips/blob/master/98.md) (an HTTP auth scheme that reuses the Nostr signed-event format), and addressing briefs/beads across the wider mesh. This file is implementation reference for contributors touching `mcp/nostr-bridge/`; operators should start at [user/privacy-filter.md](../user/privacy-filter.md) and the manifest reference.

## Why an optional feature?

Sovereign mesh is gated on a manifest flag because many deployments will never federate beyond their container. Running the bridge always-on costs key material to manage and open websocket pools to relays nobody cares about. Manifest-gating keeps the standalone install clean. Gating follows the general rule from [CLAUDE.md](../../CLAUDE.md) "Important rules for changes": optional features gate both the Nix package set and the supervisor/service block.

## Architecture

`nostr-bridge` is a **library module** consumed in-process by `management-api`.
It is not a standalone supervisord service.

Reasons: `verifyNip98` is called synchronously on every authenticated request
(IPC latency would be unacceptable), and the private key is decrypted once at
management-api boot — sharing it with a second process requires an inter-process
secret transport that expands the attack surface.

### Why not: run as a separate supervisord program?

A parallel process is the obvious design — it matches how every other capability is structured in this repo. It was rejected for two reasons, documented implicitly in the key-handling section below: (1) NIP-98 authentication is on the hot path of every Fastify request handler, so IPC hops would add per-request latency; (2) a second process handling the raw private key doubles the surface where key material can leak. The tradeoff is that a bug in `nostr-bridge` can take down `management-api` — mitigated by the exponential-backoff relay policy and by never throwing inside auth-middleware hot paths.

## Configuration

```toml
# agentbox.toml
[sovereign_mesh]
enabled      = true
nostr_bridge = true
```

```sh
# Environment
NOSTR_RELAYS=wss://relay.damus.io,wss://nos.lol   # comma-separated relay URLs
MANAGEMENT_API_KEY=<32-byte-hex>                    # used to decrypt nostr.key.enc
```

## Subscribe kinds

| Constant      | Kind  | NIP        | Purpose                                |
|---------------|-------|------------|----------------------------------------|
| `AUTH`        | 27235 | NIP-98     | HTTP auth events                       |
| `AGENT_STATE` | 30078 | NIP-33/78  | Parameterised replaceable agent state  |
| `BRIEF_REF`   | 30000 | NIP-33     | Addressable brief references           |
| `BEAD_REF`    | 30001 | NIP-33     | Addressable bead/receipt references    |

Override defaults at construction:

```js
const bridge = new NostrBridge({
  relays: ['wss://relay.damus.io'],
  subscribeKinds: [kinds.AGENT_STATE],
});
```

## Key handling

The private key is stored encrypted at `/workspace/profiles/<stack>/nostr.key.enc`
(AES-256-GCM, passphrase = PBKDF2-SHA256 over `MANAGEMENT_API_KEY` + profile salt,
100 000 iterations). The salt lives at `/workspace/profiles/<stack>/nostr.salt`.

`loadSigner(stack)` decrypts the key into memory, derives the passphrase key,
then zeroes the PBKDF2 output before returning. The raw hex private key is held
in a closure; it never appears in logs and is never written to disk.

`signer.sign(event)` passes the key to `nostr-tools/finalizeEvent` as a
`Uint8Array` and zeroes the local copy immediately after signing.

## verifyNip98 contract

```ts
NostrBridge.verifyNip98(
  authHeader: string,   // raw Authorization header
  method: string,       // expected HTTP method
  url: string           // expected URL (full or path suffix)
): { valid: boolean, pubkey: string | null, error: string | null }
```

Checks:
1. Header starts with `Nostr `.
2. Payload is valid base64 JSON.
3. `kind === 27235`.
4. `created_at` within ±60 s of now.
5. `method` tag matches (case-insensitive).
6. `u` tag equals or suffix-matches the request URL.
7. Schnorr signature valid via `nostr-tools/verifyEvent` (constant-time secp256k1).

Used by `management-api/middleware/auth.js` when the `Nostr ` prefix is detected.

## Security notes

- Private key is never logged. Do not add logging around `signer` objects.
- `nostr-tools` uses the `@noble/curves` secp256k1 implementation, which is
  constant-time and audited.
- Relay connections retry with exponential backoff; the bridge never crashes
  management-api when a relay is unreachable.
- CI tests use mocked WebSockets — no live relay I/O.

## Interaction with the `events` adapter

The `events` adapter slot (see [adapters.md](adapters.md)) can be configured to dispatch to a Nostr relay as a parameterised-replaceable kind when `[sovereign_mesh].publish_agent_events = true`. This is the path by which agent lifecycle events leave the container onto the mesh. The adapter contract is satisfied by a thin wrapper over `NostrBridge.publish()`; the slot resolver selects it based on the manifest impl name. Treat this as the canonical example of a feature flag that simultaneously gates a capability (`sovereign_mesh.enabled`), a transport (`nostr_bridge`), and an adapter binding (`events = "external"` pointing at the bridge).

## Pod server (ADR-010)

The `pods` adapter slot now defaults to [`solid-pod-rs`](https://github.com/DreamLab-AI/solid-pod-rs)
— a first-party Rust Solid Protocol 0.11 server. This matters for
`nostr-bridge` because ADR-009's pod-inbox invariants ([DDD-003 I01
signature-before-write, I08 content-addressed by event id](../reference/ddd/DDD-003-sovereign-messaging-domain.md))
depend on atomic-rename filesystem semantics that the previous Python stub
did not provide. `solid-pod-rs`'s `fs-backend` uses `rename(2)` for every
write, so a partial-write crash leaves no half-formed pod entries.

The bridge continues to write directly to `/var/lib/solid/pods/<npub>/events/{inbox,outbox}/`
on the same host volume that `solid-pod-rs` serves from. Bypassing the
HTTP layer is intentional — it keeps the hot path fast and lets the bridge
use `rename(2)` for I01 / I08 atomicity. `solid-pod-rs` picks up the
resulting files on subsequent reads via its filesystem backend. When
`integrations.solid_pod_rs.notifications != "off"`, the bridge additionally
emits a Solid Notifications 0.2 event for external subscribers.

The legacy Python stub `scripts/solid-pod-server.py` and its `local-jss`
adapter label were removed 2026-04-25. `solid-pod-rs` is the only
first-party pod implementation. Old manifests carrying `pods = "local-jss"`
fail schema validation with E016.

### `did:nostr` — the identity loop (Sprint 6 absorption)

Since the Sprint 6 upstream absorption (see ADR-010 upstream-absorption
log), the pod resolves `did:nostr:<npub>` to a Tier 1 + Tier 3 DID
document whose `verificationMethod` is the same secp256k1 pubkey the
relay accepts under NIP-42. The `alsoKnownAs` field cross-references the
npub's pod profile URI, giving the bridge a single resolvable identity
surface across every stack layer.

Practical consequence for the bridge: WAC policies written by
`sovereign-bootstrap.py` can now reference `did:nostr:<npub>` directly
instead of the hex pubkey. When the bridge persists a verified inbound
event, the WAC check inside `solid-pod-rs` resolves the agent DID to the
same key the relay's NIP-42 AUTH accepted — no out-of-band identity
correlation required.

### Rate limiting and quota coherence

Sprint 7 adds a pod-side sliding-window rate limiter and Sprint 8 adds
per-pod storage quotas via `.quota.json` sidecar files. Both complement
the relay's `messages_per_sec` ceiling and `retention_days` cleanup — a
misbehaving external agent cannot bypass the relay ceiling by hitting
the pod HTTP surface directly. The bridge inherits both limits
automatically; no code changes required beyond enabling the features in
`[integrations.solid_pod_rs]` (both default on).

## Embedded relay (ADR-009)

When `[sovereign_mesh.relay].enabled = true` the bridge is joined by an
embedded Nostr relay (`nostr-rs-relay` by default) running as its own
supervisord program. The relay's SQLite database at
`/var/lib/nostr-relay/nostr.db` holds every accepted event; the bridge
subscribes to it over loopback WebSocket and persists verified inbound
events to `pods/<npub>/events/inbox/<id>.json`. Outbound events written
by internal agents to `pods/<npub>/events/outbox/` are signed and
published through the bridge to both the embedded relay and, when
`external_fanout` is not `off`, the `NOSTR_RELAYS` list.

The bridge module for this is new (`mcp/nostr-bridge/relay-consumer.js`).
Its contract:

```js
// Called on every inbound event id matching p-tag=local npub
async onInbound(event) {
  // 1. Schnorr verify (nostr-tools verifyEvent)
  // 2. Policy check — kind in allowed_kinds? pubkey allowed?
  // 3. Atomic write pods/<npub>/events/inbox/<id>.json (temp + rename)
  // 4. Emit span agentbox.relay.event.persist
  // 5. Dispatch through the events adapter slot for downstream handlers
}

// Called by the outbox flusher on a file appearing in outbox/
async onOutboxPending(pendingFile) {
  const unsignedEvent = readJson(pendingFile);
  const signed = await signer.sign(unsignedEvent);
  await publishToRelays(signed);
  await renamePendingToFinal(pendingFile, signed.id);
  // idempotent on restart — duplicate ids are rejected by the relay
}
```

See [DDD-003](../reference/ddd/DDD-003-sovereign-messaging-domain.md) for
the aggregate model and every invariant (I01-I12) that
`tests/contract/relay.contract.spec.js` asserts.

### Why not run the relay in management-api's process?

Same process, same key material — superficially attractive. Rejected
because the relay is a third-party Rust binary with its own release
cadence, its own OTEL integration story, and its own SQLite locking
semantics. A separate supervisor program isolates crashes and makes
retention sweeps safe to run under process-level isolation. The bridge
module stays in-process for the same hot-path reason that applied to
NIP-98 verification.

## Related specs

- [PRD-001 §Federation modes](../reference/prd/PRD-001-capabilities-and-adapters.md) — the standalone-vs-client distinction.
- [PRD-004 — External agent messaging](../reference/prd/PRD-004-external-agent-messaging.md) — the relay surface.
- [ADR-005 §Off-slot semantics](../reference/adr/ADR-005-pluggable-adapter-architecture.md) — why the `events` adapter alone has no-op `off` instead of throwing.
- [ADR-007 §4a](../reference/adr/ADR-007-runtime-contract-and-container-hardening.md) — hardened baseline under which the bridge runs.
- [ADR-009 — Embedded Nostr relay and pod-inbox bridge](../reference/adr/ADR-009-embedded-nostr-relay.md) — the decision and contract for the relay.
- [ADR-010 — solid-pod-rs as first-class pod server](../reference/adr/ADR-010-rust-solid-pod-adoption.md) — the decision to adopt the Rust pod.
- [DDD-003 — Sovereign messaging domain](../reference/ddd/DDD-003-sovereign-messaging-domain.md) — aggregate model and invariants; I01 / I08 now hold for real.
- [licensing.md](licensing.md) — AGPL aggregation analysis for shipping `solid-pod-rs` inside an MPL-2.0 image.
