# NIP-98 ingress proxy (`config/nip98-proxy`)

The **sole ingress** to the Agent of Empires (AoE) interaction-plane daemon —
and, since [ADR-045](../../docs/reference/adr/ADR-045-sovereign-ingress-npub-front-door.md),
the **multi-upstream sovereign ingress**: the one identity-gated LAN door
(published `9096:9096` in `docker-compose.yml`) that can also route
prefix-matched paths to additional loopback surfaces (`/mgmt/` →
management-api). Implements PRD-021 WS4 and ADR-043 D4.6.

## What it does

`proxy.mjs` is a dependency-light node HTTP + WebSocket reverse proxy. It sits in
front of `aoe serve` (which runs `--auth token --behind-proxy --host 127.0.0.1
--port 9095`, ADR-042 D3) and does one job: **verify identity, then forward**.
The daemon's `--auth token` means loopback is no longer the boundary (N-05,
revised): the proxy reads the daemon's shared-secret token from its state file
(`~/.config/agent-of-empires/serve.url`, override `AOE_TOKEN_FILE`) and injects it
as `Authorization: Bearer` on every AoE-upstream request. Absent token file
(daemon still starting) ⇒ no header ⇒ daemon 401s (fail closed).

For every HTTP request and every WebSocket upgrade it:

1. Verifies the kind-27235 **NIP-98** `Authorization` header using the *same*
   verification path the management-api runs — `NostrBridge.verifyNip98()`
   (`mcp/servers/nostr-bridge.js`), the static method
   `management-api/middleware/auth.js` delegates to. No second Schnorr
   implementation, no `src/` patch to AoE (ADR-042 N-06).
2. On success, forwards to `AOE_UPSTREAM` (default `http://127.0.0.1:9095`) with:
   - `X-Forwarded-For` — the real client IP appended to any inbound chain;
   - `X-Agentbox-Pubkey` — the **verified** BIP-340 x-only hex pubkey. This is
     the identity AoE session `AGENTBOX_PROFILE` and the scoped memory namespace
     derive from (ADR-043 D4.1 / D4.4). Any inbound `X-Agentbox-Pubkey` claim is
     stripped and never trusted.
   - `X-Agentbox-Auth-Mode` — `nip98` or `break-glass`.
   - The client `Authorization` header is **dropped** before the upstream hop.
3. On failure, rejects with `401` (HTTP) or a `401` handshake then socket close
   (WebSocket). WebSocket upgrades on `/sessions/{id}/live-ws` and
   `/sessions/{id}/acp/ws` are proxied by raw socket piping.

## Sole-ingress invariant (ADR-043 I03 / PRD-021 N-05) — hard

`--behind-proxy` makes AoE trust `X-Forwarded-For`. Therefore:

> **Nothing other than this proxy may reach `:9095`.** The daemon MUST bind
> `127.0.0.1` and this proxy MUST be the only ingress. Any container-local
> process that can open `:9095` directly bypasses identity entirely.

The proxy binds a reachable interface (`0.0.0.0` by default); the upstream binds
loopback. Do not expose `:9095` on any routable interface, and do not add a
second forwarder to it.

## Multi-upstream routing (ADR-045 D1)

An ordered prefix table is consulted **after** identity verification and before
forwarding; no match falls through to `AOE_UPSTREAM` unchanged. Two equivalent
configuration forms:

- `NIP98_PROXY_ROUTES` — JSON, e.g.
  `[{"prefix":"/mgmt/","target":"http://127.0.0.1:9090"}]` (`strip` defaults
  `true`: the prefix is removed before the upstream hop, query preserved).
- `NIP98_PROXY_MGMT_UPSTREAM` — base URL that becomes exactly that `/mgmt/`
  rule. Exists because supervisord's `environment=` syntax cannot safely quote
  JSON; ignored when `NIP98_PROXY_ROUTES` already carries a `/mgmt/` rule.

Every route gets the same treatment: verified pubkey headers injected,
`Authorization` dropped, inbound identity claims stripped. Routed surfaces keep
their own auth — the ingress **adds** identity, it does not replace surface
checks (defence in depth). Malformed route config is fatal at boot (fail
closed). Route additions are ADR-worthy events (ADR-045 review trigger).

## NIP-07 browser sessions (`/nip07/*`)

Browsers cannot attach an `Authorization` header to navigations, so per-request
NIP-98 is impossible for a human at a dashboard. The proxy owns a small
`/nip07/*` surface (never forwarded upstream) that turns one NIP-07 signature
into a bounded session:

1. An unauthenticated **browser** GET (`Accept: text/html`) is 302'd to
   `/nip07/?next=<original path>` instead of the JSON 401 (API clients keep
   the 401 unchanged).
2. `GET /nip07/` serves a self-contained handshake page. Its JS waits for a
   NIP-07 signer (`window.nostr` — podkey or any compliant extension; signers
   inject asynchronously, so it polls briefly), then asks it to sign a
   kind-27235 event for `POST /nip07/session`.
3. `POST /nip07/session` verifies that event through the **same**
   `NostrBridge.verifyNip98` path as every other request. Only auth mode
   `nip98` may mint — an existing cookie cannot self-renew and the break-glass
   bearer cannot launder its sentinel into a pubkey-bound session. On success
   the proxy sets `agentbox_nip07_session`: HttpOnly, SameSite=Lax, `Secure`
   when the request arrived over TLS, `Max-Age` = `NIP98_PROXY_SESSION_TTL`.
4. The cookie is a stateless HMAC token `v1.<pubkey>.<expiry>.<mac>` under a
   per-boot random secret (override with `NIP98_PROXY_SESSION_SECRET` only if
   sessions must survive restarts). Expiry is inside the MAC.
5. Subsequent requests — **including WebSocket upgrades, which carry cookies**
   — authenticate via the session and are stamped with the real verified
   pubkey and `X-Agentbox-Auth-Mode: nip07-session`. The session cookie is
   stripped from the forwarded `Cookie` header on both HTTP and WS paths;
   upstreams never see the token. `GET /nip07/logout` clears it.

`NIP98_PROXY_ALLOWED_PUBKEYS` (comma-separated hex) is the npub gate of
ADR-045 D2: when set, only those identities pass NIP-98 verification or mint
sessions. Unset preserves prior behaviour (any validly-signed pubkey).

**Signer not detected?** NIP-07 extensions inject `window.nostr` into page
JavaScript only — nothing is visible to the server until the page asks for a
signature. If the handshake page reports no signer, check the extension is
enabled for this origin (some signers gate on host/https).

## Break-glass bearer (opt-in only)

With NIP-07 sessions landed, the bearer's original purpose is served by the
handshake above — plan its retirement (ADR-045). A **break-glass** bypass
remains *only* when `NIP98_PROXY_ALLOW_BEARER=<token>` is set:

- A request presenting `Authorization: Bearer <token>` (constant-time compared)
  is accepted and stamped with `X-Agentbox-Pubkey = NIP98_PROXY_BEARER_PUBKEY`
  (default sentinel `break-glass`).
- For WebSocket handshakes (browsers cannot set `Authorization`), the same token
  may be passed as `?access_token=<token>`.

This is a **documented escape hatch, never a default**. Leave
`NIP98_PROXY_ALLOW_BEARER` unset in any identity-bearing deployment; when unset,
only verified NIP-98 (header or NIP-07 session) is accepted. NIP-07 signing has
now landed, so the bearer's remaining use is emergency access when no signer is
available — keep it unset unless that emergency is live.

## Fail-closed

If the Nostr bridge (and its vendored `nostr-tools`) cannot be loaded, Schnorr
signatures cannot be verified, so **all NIP-98 tokens are rejected** — matching
`middleware/auth.js`. Only the break-glass bearer (if configured) can then reach
the upstream. A loud `warn` is logged at startup.

## Environment

| Var | Default | Meaning |
|---|---|---|
| `NIP98_PROXY_PORT` | `9096` | listen port (PRD-021 Appendix B sibling proxy) |
| `NIP98_PROXY_HOST` | `0.0.0.0` | listen bind address |
| `AOE_UPSTREAM` | `http://127.0.0.1:9095` | default upstream: AoE daemon base URL (loopback) |
| `NIP98_PROXY_ROUTES` | *(unset)* | ADR-045 routing table, JSON `[{prefix, target, strip?}]` |
| `NIP98_PROXY_MGMT_UPSTREAM` | *(unset)* | supervisord-friendly `/mgmt/` route target |
| `NOSTR_BRIDGE_PATH` | *(candidates)* | explicit path to `nostr-bridge.js` |
| `NIP98_PROXY_ALLOW_BEARER` | *(unset)* | break-glass shared bearer token |
| `NIP98_PROXY_BEARER_PUBKEY` | `break-glass` | pubkey stamped for break-glass requests |
| `NIP98_PROXY_SESSION_TTL` | `43200` | NIP-07 browser session lifetime, seconds |
| `NIP98_PROXY_SESSION_SECRET` | *(random per boot)* | session-cookie HMAC secret; unset = sessions die with the process |
| `NIP98_PROXY_ALLOWED_PUBKEYS` | *(unset)* | comma-separated hex npub gate for NIP-98 + session minting |
| `MANAGEMENT_API_URL` | *(unset)* | informational; the proxy does not call it |

`nostr-bridge.js` is resolved from `NOSTR_BRIDGE_PATH`, then the source-tree
relative path (`../../mcp/servers/nostr-bridge.js`), then the baked image path
(`/opt/agentbox/mcp/servers/nostr-bridge.js`). **`nostr-tools` must be resolvable
from wherever `nostr-bridge.js` lives** — the same requirement the live
management-api already satisfies.

## Deployment

Builder A bakes `proxy.mjs` to `/opt/agentbox/nip98-proxy/` and writes the
supervisor block that launches it as `user=devuser` with `AOE_UPSTREAM`,
`NIP98_PROXY_PORT`, and `MANAGEMENT_API_URL` set. This directory is the canonical
source.

## Checks

```bash
node --check config/nip98-proxy/proxy.mjs   # syntax
node config/nip98-proxy/selftest.mjs        # end-to-end: 401 / break-glass / NIP-98 / WS
```

The self-test skips the live-signature case only when `nostr-tools` is not
installed at the bridge path (dev checkouts); it is exercised for real in the
baked image where `nostr-tools` resolves.
