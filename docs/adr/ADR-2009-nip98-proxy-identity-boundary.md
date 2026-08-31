---
id: ADR-2009
title: The nip98-proxy is the single fail-closed identity boundary
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 960394b145fc2f9ab1c3191b682f87079c712e9e
verified_paths: [config/nip98-proxy/proxy.mjs, flake.nix, docs/INGRESS-identity.md]
owner: jjohare
review_trigger: A second identity ingress is proposed, or aoe serve stops binding loopback
repo: agentbox
domain: INGRESS-identity
lineage: legacy ADR-042 (AoE interaction plane), ADR-043 (session identity binding), ADR-045 (sovereign npub front door)
---

# ADR-2009 — The nip98-proxy is the single fail-closed identity boundary

## Context
Requests must become a verified BIP-340 pubkey before any routing decision.
The AoE interaction plane (`aoe serve`) has its own shared-secret token but no
identity. Loopback binding alone stopped being a trust boundary (N-05): the
daemon now requires the token regardless. Identity must live in exactly one
place, and a client must not be able to assert its own identity by header.
Legacy ADR-042/043/045 defined the plane, session binding and front door; this
consolidates them into one boundary. Governing doc: `docs/INGRESS-identity.md`.

## Decision
Exactly one NIP-98-verifying door — the `:9096` nip98-proxy — turns a request
into a verified x-only pubkey. `aoe serve` runs `--behind-proxy --host 127.0.0.1
--port 9095`, so bypassing the proxy bypasses identity. Every request is
authenticated before any route is consulted; any inbound `X-Agentbox-Pubkey`
(and `-Auth-Mode`) is unconditionally stripped and re-injected from the verified
identity on both HTTP and WebSocket paths. If the Schnorr verifier cannot load,
every NIP-98 token is rejected (401; only an explicit break-glass bearer may
pass). A malformed route, allowlist or upstream config crashes the proxy at boot
rather than silently dropping a rule. This forecloses any second identity
ingress and any client-asserted pubkey.

## Consequences
Identity is structurally single-sourced and auditable. Cost: the proxy is a hard
dependency — if it is down, nothing is reachable, and a verifier load failure is
a total outage by design. Boot-fatal config validation means a typo in routes or
allowlist takes the door offline rather than degrading quietly. The AoE daemon
token becomes defence-in-depth beneath identity, not the boundary itself.

## Verification
Re-checked at `cbe7335b9`: `flake.nix:1977` (`aoe serve --auth token
--behind-proxy --allowed-host 127.0.0.1 --host 127.0.0.1 --port 9095`) and
`:1970` ("only IDENTITY ingress"). `config/nip98-proxy/proxy.mjs:732` drops
inbound `x-agentbox-pubkey`, `:743` re-injects; WS path `:864` strips, `:876`
re-injects. Fail-closed no-verifier at `:472` (`nip98_verifier_unavailable`).
Boot-fatal: `:120` (bad allowlist throws), `:219`/`:259`/`:281` (`process.exit(1)`
on invalid route/config).
