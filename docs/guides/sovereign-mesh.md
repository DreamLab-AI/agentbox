# Sovereign mesh — Nostr client

Agentbox's sovereign mesh feature publishes and receives [Nostr](https://nostr.com/) events
when `[sovereign_mesh].nostr_bridge = true` in `agentbox.toml`.

## Architecture

`nostr-bridge` is a **library module** consumed in-process by `management-api`.
It is not a standalone supervisord service.

Reasons: `verifyNip98` is called synchronously on every authenticated request
(IPC latency would be unacceptable), and the private key is decrypted once at
management-api boot — sharing it with a second process requires an inter-process
secret transport that expands the attack surface.

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
