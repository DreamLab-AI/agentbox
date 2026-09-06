---
id: ADR-2010
title: Per-route bearer credentials are gated so a signed NIP-98 identity always reaches the upstream gate
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: f7a3915f91a5f7d16a56c19a46fcfde68ae1e4b1
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

**2026-09-05 re-verified at 08e817f39.** Governed paths changed by `11804ba4b` (`proxy.mjs` break-glass scope/expiry bounds) and the ADR-2047 citation refresh of `docs/INGRESS-identity.md`; neither touches the bearer gate, so the decision still holds. The `cbe7335b9` line numbers above have drifted; at HEAD the gate is `} else if (route.bearer && auth.mode !== 'nip98') {` on the HTTP path at `config/nip98-proxy/proxy.mjs:979-980` and on the WS path at `:1129-1130`, `normalizeRoute` reads `bearer_env` at `:332-333` and throws \"fail closed\" when the named env var is unset at `:336`, and NIP-07 session minting still requires a live NIP-98 signature at `:863` (`if (!auth.ok || auth.mode !== 'nip98')`). The default AoE route still replaces `Authorization` with the daemon token in every mode (`:989-992`). Commands: `git diff --name-only 89301ec7..HEAD -- config/nip98-proxy/proxy.mjs docs/INGRESS-identity.md`, `grep -n \"route.bearer\\|bearer_env\\|auth.mode !== 'nip98'\" config/nip98-proxy/proxy.mjs`. The unproven-against-real-upstreams remainder recorded above is unchanged.

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

## Landing re-verification — 2026-09-05 (ddd1f1ec8)

Governed paths changed in the landing commit: docs/INGRESS-identity.md: one line in `## Remediation — 2026-09-05` recording the ADR-2062 listener gate. Decision unaffected; `verified_commit` moved to the landing commit.

## Landing re-verification — 2026-09-06 (796d85fcf)

Governed paths changed in the Wave 3 landing commit: docs/INGRESS-identity.md. The changes are the ones recorded by the Wave 3 records landed in that commit (ADR-2061, 2064, 2065, 2066, 2068, 2069, 2070, 2072, the proposed 2071/2073–2078) and the ADR-2018 recall diagnosis; none alters this record's decision. Gates at the landing commit: management-api 81 suites / 1290 tests, exposure gate PASS, catalogue 60 paths, config validation clean. `verified_commit` moved to the landing commit.

## Landing re-verification — 2026-09-06 (f7a3915f9)

Governed paths changed in the doc-sync commit: docs/INGRESS-identity.md — frontmatter `version`/`verified_commit` bump and changelog entry for the Remediation — 2026-09-05 section; no code or citation this record depends on changed. `verified_commit` moved to the doc-sync commit.
