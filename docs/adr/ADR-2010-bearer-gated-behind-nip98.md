---
id: ADR-2010
title: Per-route bearer credentials are gated so a signed NIP-98 identity always reaches the upstream gate
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: cbe7335b9
owner: jjohare
review_trigger: A governance upstream stops re-verifying the operator signature, or a bearer is added to the default AoE route
repo: agentbox
domain: INGRESS-identity
lineage: legacy ADR-069 (unified operator auth / DreamLab adoption)
---

# ADR-2010 — Bearer credential exchange is gated beneath the NIP-98 identity

## Context
Named non-AoE upstreams (management API, governance services) authenticate with
their own per-route bearer token, injected by the proxy from a `bearer_env`
secret. But a bearer alone must never be sufficient to release a governance
gate: those upstreams re-verify the operator's Schnorr signature themselves. So
the proxy must not overwrite a genuine signed NIP-98 identity with a bearer.
Sits beneath the identity boundary of ADR-2009. Governing doc:
`docs/INGRESS-identity.md`.

## Decision
For a named non-AoE route the proxy injects the route's `bearer_env` token into
`Authorization` **only when `auth.mode !== 'nip98'`** (i.e. cookie session or
break-glass). A genuinely signed NIP-98 request passes its own `Authorization`
through untouched, so the governance upstream re-verifies the operator signature.
`bearer_env` is fatal at boot if the named env var is unset (fail-closed, no
silent unauthenticated route). NIP-07 browser-session minting itself requires a
live NIP-98 signature. The default AoE route is the deliberate exception: the
proxy replaces `Authorization` with the daemon token for every mode, including
NIP-98. This forecloses a bearer-only path to a governance gate.

## Consequences
A stolen bearer cannot release a gate that also checks a signature; the signed
identity is always the stronger credential and always reaches the upstream. Cost:
governance upstreams must implement their own NIP-98 re-verification — the proxy
does not do it for them on these routes. A missing `bearer_env` secret takes the
route offline at boot rather than serving it unauthenticated.

## Verification
Re-checked at `cbe7335b9` in `config/nip98-proxy/proxy.mjs`: HTTP gate at `:751`
and WS gate at `:880` (`if (route.bearer && auth.mode !== 'nip98')`).
`normalizeRoute` at `:204-227` reads `bearer_env` and throws "fail closed" at
`:219` when unset. NIP-07 session mint requires live NIP-98 at `:651`
(`if (!auth.ok || auth.mode !== 'nip98')` → reject).
