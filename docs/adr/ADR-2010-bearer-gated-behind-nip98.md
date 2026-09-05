---
id: ADR-2010
title: Per-route bearer credentials are gated so a signed NIP-98 identity always reaches the upstream gate
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: [config/nip98-proxy/proxy.mjs, docs/INGRESS-identity.md]
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

## Closeout extension — 2026-09-04

**Work package:** CP-04 / CP-05. **Owner:** existing owner above. **Dependencies:** CP-01
revision/feature identity and the downstream consumer contract.

**Current source verification:** Both HTTP and WS named-route branches still inject route bearer only when `auth.mode !== 'nip98'`; AoE receives its daemon token in every mode. This source contract does not itself prove downstream approval gates re-verify signatures.

At `89301ec7c911eab270c00a0cf81596d0d4f15535`, the local proxy suite passes 45 assertions with no skips using
`NODE_PATH=management-api/node_modules node config/nip98-proxy/selftest.mjs`.
The initial default-resolution run skipped three signature cases; both runs
are preserved in the [estate receipts](../../../../VisionFlow/docs/estate-review/evidence/ingress-selftest-runtime-deps.json).
These are local fake-upstream checks, not deployed acceptance or, for the
identity helper, a key-persistence test. Prior verification at `960394b145fc2f9ab1c3191b682f87079c712e9e` remains
part of this record's history; the refreshed commit covers the scoped source
claims above. Existing activation labels are not newly verified by this run.

**Acceptance still required:** Test actual governance upstreams with fresh signed NIP-98, session-derived bearer, break-glass, malformed signatures and repeated tokens. Demonstrate that bearer-only requests cannot approve a mutation and that proxy/upstream URL and replay contracts agree.

## Acceptance progress — 2026-09-05

**Implemented.** The source contract is now asserted on both transports, and the
case the closeout said it did not prove is tested directly.

- In `auth.mode === 'nip98'` the route bearer is **not** injected for named
  routes, on HTTP **and** on WS, while AoE still receives its daemon token in
  both — the asymmetry the record describes is now covered rather than inferred.
- A **bearer-only** request (bearer present, no NIP-98) **cannot reach a
  mutation route**: the governance upstream is never contacted.
- The signed NIP-98 `Authorization` reaches the upstream gate untouched, and
  `X-Forwarded-Host` lets the upstream rebuild the signed `u`-tag URL, so the
  proxy and upstream URL contracts agree on what was signed.
- Break-glass and cookie-session modes are shown to receive the route bearer, so
  the mode boundary is explicit rather than implied.

**Tests and results.** `NODE_PATH=management-api/node_modules node config/nip98-proxy/selftest.mjs`
— **120 assertions, 0 failures, 0 skips**. The suite grew from 45 assertions with
the cases listed above; the pre-existing cases are unchanged.

**Receipts.** `docs/estate-closeout/2026-09-05/adr-2009-nip98-selftest.json`.

**Remaining.** The upstreams are fakes. Actual governance upstreams have not been
tested with fresh signed NIP-98, session-derived bearer, break-glass, malformed
signatures or repeated tokens, so the downstream re-verification and replay
contracts remain unproven against real services.

**Governed paths changed.** `config/nip98-proxy/proxy.mjs`,
`config/nip98-proxy/selftest.mjs`.
