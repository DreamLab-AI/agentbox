---
id: ADR-2009
title: The nip98-proxy is the fail-closed AoE identity boundary
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: [config/nip98-proxy/proxy.mjs, flake.nix, docs/INGRESS-identity.md]
owner: jjohare
review_trigger: A second identity ingress is proposed, or aoe serve stops binding loopback
repo: agentbox
domain: INGRESS-identity
lineage: legacy ADR-042 (AoE interaction plane), ADR-043 (session identity binding), ADR-045 (sovereign npub front door)
---

# ADR-2009 — The nip98-proxy is the fail-closed AoE identity boundary

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
--port 9095`, so bypassing the proxy bypasses identity. Every upstream request is
authenticated before routing; the proxy-owned NIP-07 handshake is separate; any inbound `X-Agentbox-Pubkey`
(and `-Auth-Mode`) is unconditionally stripped and re-injected from the verified
identity on both HTTP and WebSocket paths. If the Schnorr verifier cannot load,
every NIP-98 token is rejected (401; only an explicit break-glass bearer may
pass). A malformed route, allowlist or upstream config crashes the proxy at boot
rather than silently dropping a rule. This forbids an additional ungoverned AoE identity
ingress and client-asserted pubkeys; other estate services retain their own
authentication boundaries.

## Consequences
Identity is structurally single-sourced and auditable. Cost: the proxy is a hard
dependency — if it is down, its upstream routes are unreachable, and a verifier load failure is
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

## Closeout extension — 2026-09-04

**Work package:** CP-04. **Owner:** existing owner above. **Dependencies:** CP-01
revision/feature identity and the downstream consumer contract.

**Current source verification:** The current HTTP/WS paths strip supplied identity headers and inject authenticated identity. The NIP-07 handshake page is a proxy-owned pre-auth surface; upstream requests pass `verifyIdentity` before routing. Supported modes include fresh NIP-98, signed-handshake HMAC sessions and explicit break-glass. The single-door claim is scoped to AoE identity ingress, not all estate services.

At `89301ec7c911eab270c00a0cf81596d0d4f15535`, the local proxy suite passes 45 assertions with no skips using
`NODE_PATH=management-api/node_modules node config/nip98-proxy/selftest.mjs`.
The initial default-resolution run skipped three signature cases; both runs
are preserved in the [estate receipts](../../../../VisionFlow/docs/estate-review/evidence/ingress-selftest-runtime-deps.json).
These are local fake-upstream checks, not deployed acceptance or, for the
identity helper, a key-persistence test. Prior verification at `d19073a82c319f7be01cf61d31521598dc044da5` remains
part of this record's history; the refreshed commit covers the scoped source
claims above. Existing activation labels are not newly verified by this run.

**Acceptance still required:** Verify spoofed identity headers, absent verifier, allowlist removal, cookie expiry/restart and each direct sidecar path. Bind the door inventory to deployed ports and credentials; document any bypass of per-user attribution.

## Acceptance progress — 2026-09-05

**Implemented.** The four acceptance cases named in the closeout are now
exercised against the real proxy, and the defects they exposed are fixed.

- *Spoofed identity header.* A client that supplies the identity headers the
  proxy injects has them **stripped and replaced** by the authenticated
  identity, asserted on both the HTTP and the WebSocket path; the upstream never
  observes the client-supplied value.
- *Absent verifier.* When the NIP-98 verifier is unavailable or throws, the
  proxy **fails closed** — it denies rather than routing unauthenticated, and
  the upstream receives nothing.
- *Allowlist removal.* An identity that was allowed and is then removed is denied
  on the next request, **including one carrying an already-established session
  cookie**, so a live session cannot outlive its authorisation.
- *Cookie expiry and restart.* An expired signed-handshake cookie is rejected,
  and a cookie minted under a previous HMAC key is rejected after restart, with a
  control case proving a current-key cookie still works. Neither rejection
  contacts the upstream.

**Tests and results.** `NODE_PATH=management-api/node_modules node config/nip98-proxy/selftest.mjs`
— **120 assertions, 0 failures, 0 skips**. The suite grew from 45 assertions with
the cases listed above; the pre-existing cases are unchanged.

**Receipts.** `docs/estate-closeout/2026-09-05/adr-2009-nip98-selftest.json`.

**Remaining.** Fake upstreams throughout: this is not deployed acceptance. The
door inventory is still not bound to deployed ports and credentials, each direct
sidecar path is untested, and no bypass of per-user attribution has been
enumerated against a running deployment.

**Governed paths changed.** `config/nip98-proxy/proxy.mjs`,
`config/nip98-proxy/selftest.mjs`, `config/nip98-proxy/README.md`.
