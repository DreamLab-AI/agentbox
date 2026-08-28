# ADR-069: Unified operator auth — dreamlab-ai auth adoption on the :8444 console

- **Status:** Accepted — implementing (2026-08-27)
- **Date:** 2026-08-27
- **Relates to:** ADR-043 (D4.6 sole ingress), ADR-045 (NIP-07 browser sessions,
  npub allowlist), PRD-021 (interaction plane), voice/README.md (ADR-044 console)

## Context

The dreamlab-ai production auth system (DreamLab-AI/nostr-rust-forum, live on
dreamlab-ai.com) authenticates humans with a NIP-07 browser signer minting a
server-side session, verifies NIP-98 for API calls, and gates by an admin
roster. Agentbox's nip98-proxy already implements the same pattern (ADR-045),
but the :8444 operator console only used it for `/aoe/*`:

- `/approvals/*` and `/mgmt/*` went straight to management-api :9090;
- `/feed` + `/bridge/*` went straight to tab0-bridge :8971 with a raw
  `BRIDGE_TOKEN` bearer **held in the browser** (sessionStorage break-glass);
- the console signed NIP-98 per request (signer prompt fatigue → operators
  lived on the break-glass bearer).

## Decision

Adopt the dreamlab auth model completely for the console origin:

1. **One authenticator.** Every authenticated :8444 surface rides the
   nip98-proxy (:9096): `/aoe/`, `/approvals/`, `/mgmt/`, `/bridge/`, `/feed`,
   plus the proxy-owned `/nip07/*` login handshake. Caddy forwards prefixes
   unstripped; the proxy verifies identity first, then strips per its route
   table.
2. **Session-first.** Operators sign in once via `/nip07/` (Podkey or any
   NIP-07 signer) → HttpOnly HMAC cookie (12 h, per-boot secret) covering
   fetch **and** websocket. Per-request NIP-98 signing remains a fallback;
   the sessionStorage break-glass input is demoted to an emergency surface
   behind `?breakglass=1`.
3. **Credential exchange at the trust boundary.** Proxy routes may declare
   `bearer_env`: when the operator authenticated by **session cookie or
   break-glass**, the proxy replaces the credential upstream with the
   service's own bearer (`BRIDGE_TOKEN` for tab0-bridge,
   `MANAGEMENT_API_KEY` for management-api). A genuine NIP-98 header passes
   through untouched — upstreams re-verify the signature themselves, and
   governance decisions require the operator's signed identity (a bearer
   alone must never release a gate). The browser never holds upstream
   secrets.
4. **Boot-class config.** Routes + npub allowlist live in
   `agentbox.toml [interaction_plane.proxy]`, projected every boot to
   `workspace/.agentbox/nip98-proxy-config.json` (supervisord env cannot carry
   JSON). The proxy fails closed on malformed config. The allowlist seeds from
   the dreamlab identity roster (operator key).

## Consequences

- Apply classes: config projection + Caddy + console site are **boot/live**;
  the proxy.mjs config-file support ships at the next **rebuild** (interim:
  repo-copy proxy with the supervised unit stopped — the ADR-045 precedent).
- `/mgmt/`'s and `/dream/`'s previous proxy bypasses in Caddy are closed (the
  `/dream` one caused the dream↔cockpit "unauthorised circle": session-cookie
  operators hit management-api's own auth with no verifiable credential).
- Browser-verified 2026-08-27 (browsercontainer, house key 11ed64…663c): mint
  200; dream/approvals/mgmt/aoe/bridge all 200 on one session cookie; dream
  ledger renders (6 repos, 4 draft PRs); cockpit round-trip live; feed WS
  LIVE via cookie + BRIDGE_TOKEN exchange.
- The u-tag of console-signed NIP-98 events now covers the unstripped path
  (`/approvals/v1/...`), matching what the proxy sees.
- Deeper roster integration (D1-style admin lookup, NIP-26 delegation,
  passkeys from the forum kit) is future work — the session + allowlist +
  credential-exchange core is what this ADR lands.
