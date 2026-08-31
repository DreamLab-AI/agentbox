---
title: Agentbox Ingress & Identity
doc_id: AB-INGRESS
version: 0.1.1
status: draft-for-ratification
verified_commit: 73540faa0
date: 2026-08-31
changelog:
  - "0.1.1 (2026-08-31): correct AoE auth state — live command is `aoe serve --auth token` (flake.nix:1977), token auth has landed not staged; fix door-inventory row, sole-ingress cite, and the two now-stale divergences."
sources:
  - config/nip98-proxy/proxy.mjs
  - config/nip98-proxy/README.md
  - config/nostr-gateway/gateway.cjs
  - management-api/lib/agent-identity.js
  - management-api/server.js
  - agentbox.toml
  - flake.nix
  - voice/README.md
  - docker-compose.voice.yml
  - scripts/ci/check-ports-loopback.sh
  - docs/reference/adr/ADR-053-hex-canonical-pod-naming.md
  - docs/reference/adr/ADR-040-learning-consumers-model-lifecycle-and-legacy-mining.md
---

# Agentbox Ingress & Identity

## Purpose

Names every way an actor reaches the agentbox interaction/management planes and the
identity each door binds. Ground truth is the running code; legacy ADRs are cited as
evidence, not authority.

## Current State

### Door inventory (what is actually published)

Only two ports leave the container on a routable interface. Everything else binds
loopback and is reachable only through one of them or an SSH tunnel
(`scripts/ci/check-ports-loopback.sh` enforces `127.0.0.1:` on every compose publish,
with a single hard-coded exception for `9096:9096`).

| Door | Bind | Identity gate | Backing service |
|---|---|---|---|
| `:9096` nip98-proxy | `0.0.0.0` (LAN) | NIP-98 / NIP-07 session / break-glass bearer | AoE `:9095`, `/mgmt/` → mgmt-api `:9090` |
| `:8444` voice cockpit | `0.0.0.0` (LAN) | Caddy origin, forwards `Authorization` to tab0-bridge / mgmt-api | AoE, `/approvals/*`, `/mgmt/*`, `/lo/*`, `/docs/*` |
| `:9090` management-api | `127.0.0.1` | NIP-98 bearer on identity surfaces (RbacGate-adjacent) | reached via `:9096/mgmt/` or `:8444/mgmt/` |
| `:9095` AoE `aoe serve` | `127.0.0.1` | daemon bearer token (`--auth token --behind-proxy`) + sole-ingress invariant | the interaction plane itself |
| `:7777` embedded relay | loopback unless `[sovereign_mesh.relay].expose` | pubkey allowlist | nostr-rs-relay |

### `:9096` nip98-proxy — the sole legitimate ingress to AoE

`config/nip98-proxy/proxy.mjs` is the trust boundary in front of `aoe serve`
(`flake.nix:1977`: `aoe serve --auth token --behind-proxy --allowed-host 127.0.0.1
--host 127.0.0.1 --port 9095`). AoE trusts `X-Forwarded-For` because it runs
`--behind-proxy`, so the sole-ingress invariant remains load-bearing for *identity*:
anything that opens `:9095` directly bypasses NIP-98 pubkey verification. Since N-05,
`--auth token` adds defence-in-depth beneath it — every `:9095` request must also carry
the daemon's bearer token, minted at launch into `~/.config/agent-of-empires/serve.url`
(not env-settable), so a co-resident process that never reads that file cannot drive
sessions even on a loopback-reachable port (`flake.nix:1963-1975`, `proxy.mjs:18-21`).

Auth precedence in `verifyIdentity` (`proxy.mjs:410-450`):

1. **Break-glass bearer** — only if `NIP98_PROXY_ALLOW_BEARER` is set; constant-time
   compared (`proxy.mjs:414`); stamps `mode: break-glass`, pubkey
   `NIP98_PROXY_BEARER_PUBKEY` (default `"break-glass"`).
2. **NIP-98** (`Authorization: Nostr <base64(kind-27235)>`) verified through the SAME
   `NostrBridge.verifyNip98` path management-api uses (`proxy.mjs:419-436`,
   `mcp/servers/nostr-bridge.js`). Verified BIP-340 x-only pubkey → `X-Agentbox-Pubkey`.
3. **NIP-07 browser session** — HttpOnly HMAC cookie `agentbox_nip07_session`, minted
   at `POST /nip07/session` after a signed kind-27235 handshake, stateless token
   `v1.<pubkey>.<expiry>.<mac>` (`proxy.mjs:335-352`). Cookie is stripped before
   forwarding; upstreams never see it (`proxy.mjs:680-686`).

On failure: HTML GETs are 302'd to `/nip07/`; API clients get JSON 401
(`proxy.mjs:650-670`). If `NostrBridge` cannot load, the proxy fails **closed** — every
NIP-98 token is rejected, only break-glass (if configured) survives (`proxy.mjs:308-314`).

Upstream header hygiene: inbound `X-Agentbox-Pubkey` is always dropped and re-injected
from the verified identity (`proxy.mjs:681`, `proxy.mjs:796`) — a client cannot forge
the pubkey. `Authorization` is hop-by-hop and never forwarded, EXCEPT the ADR-069
credential-exchange path: a route may declare `bearer_env`, and the proxy injects that
upstream token **only when `auth.mode !== 'nip98'`** (`proxy.mjs:800`) — a genuine
signed NIP-98 header passes through so governance upstreams re-verify the operator
signature themselves.

**AoE token auth — landed (N-05).** `:9095` runs `--auth token` (`flake.nix:1977`):
the daemon mints a bearer token at launch into `~/.config/agent-of-empires/serve.url`
and every request must carry it as `Authorization: Bearer`. Loopback is no longer the
boundary. The two direct consumers read the token from that state file and inject it —
`config/nostr-gateway/gateway.cjs:108-124` (`aoeToken()` reads `serve.url`; its own
comment notes a co-resident process without the token file "can no longer drive the
daemon") and `scripts/aoe-seed-sessions.mjs`. The nip98-proxy stays the only *identity*
ingress (NIP-98 → pubkey); the token is defence-in-depth beneath it. Note: a stale
comment at `flake.nix:2244` still reads "(aoe serve, --auth none)" — that lags the live
supervisor command and should be corrected; it is not the running config.

### `:9096` multi-upstream routing (legacy ADR-045)

The proxy is also the sovereign front door for other surfaces. `NIP98_PROXY_ROUTES`
(JSON) and the boot-projected config file
(`/home/devuser/workspace/.agentbox/nip98-proxy-config.json`, from
`agentbox.toml [interaction_plane.proxy]`) add ordered prefix rules ahead of the
default AoE upstream (`proxy.mjs:212-250`). Identity verification is route-independent:
every request is authenticated before any route is consulted, and the same identity
headers are injected whichever upstream wins. The canonical extra route is
`/mgmt/` → management-api `:9090`. Malformed route/allowlist config is **fatal at boot**
(fail-closed, `proxy.mjs:207-209`, `proxy.mjs:226-231`).

**npub gate** (`NIP98_PROXY_ALLOWED_PUBKEYS`, config-file `allowedPubkeys`, unioned):
when non-empty, only listed 64-hex pubkeys pass NIP-98 verification or may mint a
browser session (`proxy.mjs:113-125`, `pubkeyAllowed`). Unset = any validly-signed
pubkey. The break-glass bearer is orthogonal — its own sentinel, not gated by the
allowlist.

### `:8444` voice cockpit

`docker-compose.voice.yml:40` publishes `0.0.0.0:8444`. A Caddy origin
(`voice/README.md:13-22, 94-106`) fronts one credential over one origin, forwarding
`Authorization` to tab0-bridge and to management-api `:9090` for `/approvals/*`,
`/mgmt/*`, `/lo/*`, `/docs/*`, `/aoe/*`. This is a **second LAN door** — see divergences.

### Identity: hex-canonical pubkey, DID, Multikey

Every durable identity is a BIP-340 x-only 32-byte pubkey, lowercase 64-hex, as the
single storage and URL identity (legacy ADR-053; `pods/<hex>/`, WAC agent URIs, NIP-98
`did:nostr:<hex>`). npub/bech32 is a display/symlink form only.

`management-api/lib/agent-identity.js` mints or loads a per-agent identity:

- Private-key precedence: `AGENTBOX_AGENT_PRIVKEY_HEX` env → persisted profile key file
  (0600) → freshly generated (`loadOrMint`, `agent-identity.js:107-160`).
- **DID**: `did:nostr:<64-hex>` (`agent-identity.js:150`) — the canonical identity.
- **Multikey**: `publicKeyMultibase = "fe70102" + xOnlyHex` (`MULTIKEY_PREFIX`,
  `agent-identity.js:45,50-51`) — `f`(base16-lower) ‖ `e701`(varint multicodec) ‖ `02`
  compressed-point tag, offered alongside the DID (legacy ADR-033 D3′).
- Private key never leaves the function; only DID / x-only pubkey / Multikey are emitted
  (`agent-identity.js:18`).

### Session identity binding

The nip98-proxy stamps the verified pubkey as `X-Agentbox-Pubkey` +
`X-Agentbox-Auth-Mode`. AoE derives the session `AGENTBOX_PROFILE` and the scoped memory
namespace from that identity at session-create (legacy ADR-043 D4.1/D4.4). Each seeded
session binds a `did:nostr` + URN + beads epic + scoped namespace
(`scripts/aoe-seed-sessions.mjs`).

### Sovereign mesh relay posture

`[sovereign_mesh.relay]` (`agentbox.toml:131-181`): nostr-rs-relay on loopback `:7777`,
allowlist ingress with **no fallback and no auto-add** — empty allowlist drops every
inbound event. `allowed_pubkeys` (`agentbox.toml:144-153`) is baked at nix build
(`relayAllowedPubkeysCsv`), so changes need an image rebuild. Current entries: operator
(jjohare), visionclaw-server governance publisher, two forum admins (beema, RedDread),
junkiejarvis bridge agent, operator mobile (Amethyst/Amber). `agent_event_auth = "nip98"`
(`agentbox.toml:172`) — hardened by default; `POST /v1/agent-events/emit` requires a
kind-27235 header and stamps `source_urn` from the verified pubkey.

## Known divergences & open items

- **"One front door" is two LAN doors.** Legacy ADR-045 frames `:9096` as the single
  identity-gated sovereign ingress, and `flake.nix:3148` publishes only `:9096` from the
  main compose — but `docker-compose.voice.yml:40` independently publishes `:8444` on
  `0.0.0.0`. Two doors exist across two compose files; only `:9096` is covered by the
  loopback-ports CI gate's exception. State this as current reality: agentbox has a dual
  LAN ingress.
- **Stale `--auth none` comment in `flake.nix`.** The live supervisor command is
  `--auth token` (`flake.nix:1977`), but the port-publish comment at `flake.nix:2244`
  still says "(aoe serve, --auth none) is NEVER published". Cosmetic/misleading only —
  the running config is token-authed — but the comment should be corrected to prevent
  the same drafting error recurring.
- **ADR-040 key-split defect (pending).** The relay allowlist entry
  `agentbox.toml:148` is labelled `visionclaw-server — governance publisher (key-split
  pending, ADR-040 D3)`: the governance publisher currently signs under a key that is not
  yet split from the operator/server identity. Until split, governance-published events
  and server identity share a key. Open.
- **Unsigned pod-signing fallback.** Pod signing can fall back unsigned (legacy agentbox
  ADR-026); combined with the `did:nostr:local` placeholder fallback in
  `agent-identity.js:175`, a degraded boot can produce a non-sovereign identity silently.
- **Break-glass bearer over the LAN.** When `NIP98_PROXY_ALLOW_BEARER` is set the bearer
  is accepted on `:9096` (LAN) and via `?access_token=`/`?bearer=` on WS upgrades
  (`proxy.mjs:753-760`). A single shared secret bypasses NIP-98 entirely — acceptable as
  documented opt-in, but it is a full identity bypass while enabled.
- **Session secret is per-boot.** `NIP98_PROXY_SESSION_SECRET` defaults to
  `crypto.randomBytes` (`proxy.mjs:107`): NIP-07 sessions do not survive a proxy restart.
  Intentional, but every restart forces re-authentication.
- **ADR-051 (Loom) load-bearing but only Proposed**, and legacy ADR-045 status
  contradictions (frontmatter vs body vs index) remain unreconciled in the legacy corpus.

## Invariants (must not silently change)

1. AoE `:9095` stays loopback + `--behind-proxy` + `--auth token`; the nip98-proxy is the
   sole *identity* ingress, and every direct loopback consumer (gateway, tab0-bridge,
   seed script, `aoe-curl.sh`) must present the daemon token — a tokenless request to
   `:9095` must always 401.
2. Identity is verified before any route is consulted; `X-Agentbox-Pubkey` is always
   proxy-injected, never trusted inbound.
3. For *named governance upstreams*, `Authorization` injection is gated on
   `auth.mode !== 'nip98'` — a signed NIP-98 identity reaches them intact. The default
   AoE route is the exception: the proxy replaces `Authorization` with the daemon token
   for **every** auth mode (the proxy is AoE's authenticator; identity travels via
   `X-Agentbox-Pubkey`), and fails 503 locally when no token is available.
4. Missing NIP-98 verifier ⇒ fail closed. Malformed route/allowlist config ⇒ fatal at boot.
5. The DID is `did:nostr:<64-hex>`; hex x-only pubkey is the single storage/URL identity.
   Private keys never leave `agent-identity.js` and persist at 0600.
6. Relay ingress is allowlist-only with no auto-add; an empty allowlist drops everything.
7. Every host publish binds `127.0.0.1` except the ADR-045 `:9096` exception — the
   loopback-ports CI gate enforces this.

## Change process

This is a living document. Amend it in the same PR as any change to the door inventory,
the proxy auth path, the identity mint, or the relay posture. Re-run
`scripts/ci/check-ports-loopback.sh` and update `verified_commit` on every ratified edit.
Load-bearing claims cite `file:line` against the running code; legacy ADRs are evidence
only.
