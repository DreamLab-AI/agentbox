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

## Related specs

- [PRD-001 §Federation modes](../reference/prd/PRD-001-capabilities-and-adapters.md) — the standalone-vs-client distinction.
- [ADR-005 §Off-slot semantics](../reference/adr/ADR-005-pluggable-adapter-architecture.md) — why the `events` adapter alone has no-op `off` instead of throwing.
- [ADR-007 §4a](../reference/adr/ADR-007-runtime-contract-and-container-hardening.md) — hardened baseline under which the bridge runs.
