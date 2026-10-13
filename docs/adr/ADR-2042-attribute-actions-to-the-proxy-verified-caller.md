---
id: ADR-2042
title: Attribute actions to the proxy-verified caller, and the trust caveat that comes with it
date: 2026-09-05
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 044f1d689569572417a98f91afcf744fc2ca2385
verified_paths: [management-api/lib/agent-event-auth.js]
owner: jjohare
review_trigger: management-api stops binding 0.0.0.0, a second carrier of caller identity is added, or any caller other than the NIP-98 proxy needs to send X-Agentbox-Pubkey
repo: agentbox
domain: INGRESS-identity
lineage: ADR-2009 (NIP-98 proxy identity); ADR-2041 (action pipeline wiring); ADR-2044 (fail-closed attribution). Filed retroactively on 2026-10-12: the number was cited from code and docs/INGRESS-identity.md but the record never existed (TODO-unified S-3).
---

# ADR-2042 — Attribute actions to the proxy-verified caller, and the trust caveat that comes with it

## Context

The NIP-98 proxy on `:9096` verifies a caller's signature, strips any client-supplied
`X-Agentbox-Pubkey`, and re-injects the verified pubkey before forwarding to management-api.
Until this decision the attribution layer ignored that header, so an agent-event or journal
envelope was attributed to the container's own identity rather than the person or agent that
made the request. Invariant 2 (identity is established once, at the proxy) held at the proxy
but was not load-bearing downstream.

Some callers cannot sign a NIP-98 header on the management-api hop itself: NIP-07 browser
sessions and break-glass callers are authenticated at the proxy and arrive with only the
re-injected header.

## Decision

`verifyAgentEventRequest` (`management-api/lib/agent-event-auth.js`) resolves caller identity
in two ordered paths:

1. **Direct NIP-98.** A request carrying a `Nostr `-prefixed `Authorization` header must verify,
   or it is rejected with 401. A failed signature is never rescued by the header.
2. **Proxy-verified header.** Only when path 1 did not apply, `X-Agentbox-Pubkey` is accepted
   if it is exactly 64 lowercase hex characters (`proxyVerifiedPubkey`). Anything else is
   ignored, never partially trusted, and the request falls through to 401.

The derived `did:nostr:<pubkey>` is then reconciled against any caller-supplied `source_urn`
(`reconcileSourceUrn`): a mismatch is a 403.

## Consequences

- Actions and journal envelopes record the caller's identity, not the container's.
- Path 2 is sound only while (a) the proxy keeps stripping and re-injecting the header, and
  (b) nothing but the proxy can reach management-api's port directly.
- **(b) is not true today.** `server.js` binds `0.0.0.0` in-container, and a cross-container
  caller on `visionclaw_network` needs only the shared `MANAGEMENT_API_KEY` to pass the general
  auth gate before this module runs, so a holder of that key can forge the header and emit
  events under any `did:nostr:`. The source comment at the head of `agent-event-auth.js`
  records this as a known residual.
- The accepted mitigation is deliberately deferred, not forgotten. The two candidates are to
  bind the listener to loopback, or to require NIP-98 on path 2. Each changes a wire contract
  for existing callers (VisionClaw's `management_api_client`, the proxy, break-glass tooling),
  so neither is made here. `implementation_status: partial` stays until one lands, tracked as
  TODO-unified S-3.

## Update 2026-10-12: the header is honoured only from the proxy's peer address

`peerIsProxy` (`management-api/lib/agent-event-auth.js`) requires the request's TCP peer to be
loopback (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`), the address the NIP-98 proxy connects from
(`NIP98_PROXY_MGMT_UPSTREAM`, default `http://127.0.0.1:9090`). A holder of `MANAGEMENT_API_KEY`
on `visionclaw_network` connects from a docker-network address, so its `X-Agentbox-Pubkey` is
ignored and path 2 answers 401. A request with no socket information is untrusted. The same rule
now guards the second reader, `resolveAgentDid` in `lib/action-plane.js`. `AGENTBOX_PROXY_PEERS`
(comma-separated exact addresses) replaces the loopback default for a topology whose proxy
connects from elsewhere. `server.js` still binds `0.0.0.0`: loopback binding would cut off
VisionClaw's legitimate non-header calls, so it was not chosen. Residual: a process inside the
container can still connect over loopback, which is the same-UID boundary (TODO-unified X-1).
Tests: `tests/sovereign/agent-event-auth.test.js`.

## Alternatives rejected

- Trusting `X-Agentbox-Pubkey` unconditionally, including alongside a Nostr header: lets a
  bad signature be papered over.
- Binding management-api to loopback: breaks cross-container callers that use the shared key
  without a header.
- Dropping path 2: breaks NIP-07 session and break-glass callers, which have no way to sign
  on the second hop.

## Re-verification — 2026-10-13 at `044f1d689`

The decision holds. Every claim below was checked against the code, and the tripped hunks are unrelated to it.

Claims checked:

- verifyAgentEventRequest resolves identity in two ordered paths: Nostr-prefixed Authorization must verify else 401, never rescued by the header
- Path 2: X-Agentbox-Pubkey accepted only if exactly 64 lowercase hex (proxyVerifiedPubkey); else falls through to 401
- did:nostr:<pubkey> reconciled against caller source_urn; mismatch is 403 (reconcileSourceUrn)
- 2026-10-12 update: peerIsProxy requires TCP peer in 127.0.0.1, ::1, ::ffff:127.0.0.1; AGENTBOX_PROXY_PEERS (comma-separated exact addresses) replaces the default; no socket info => untrusted
- Same guard applies to the second reader resolveAgentDid in lib/action-plane.js
- server.js still binds 0.0.0.0
- Proxy strips client-supplied X-Agentbox-Pubkey and re-injects the verified one
- NIP98_PROXY_MGMT_UPSTREAM default http://127.0.0.1:9090
- Tests in tests/sovereign/agent-event-auth.test.js

Evidence:

- git diff 3f05ae9e7..de7fa461e -- management-api/lib/agent-event-auth.js → exactly the peerIsProxy addition, proxyVerifiedPubkey(request, env) gate and updated header comment that the 2026-10-12 update describes (commit e4ff72769); nothing else
- management-api/lib/agent-event-auth.js (at de7fa461e): peerIsProxy ~L98-107 (loopback default list, AGENTBOX_PROXY_PEERS override, non-string/empty addr => false); proxyVerifiedPubkey L116-123 returns null when !peerIsProxy and unless HEX64_LOWER matches; verifyAgentEventRequest: hasNip98Header branch returns 401 on any failure and never consults header; fall-through returns 401 'NIP-98 Authorization header required'; reconcileSourceUrn returns 403 on mismatch
- management-api/lib/action-plane.js:49 imports proxyVerifiedPubkey; :228-229 resolveAgentDid uses it ('Honoured only from the proxy's loopback peer')
- management-api/server.js:49 HOST = MANAGEMENT_API_HOST || '0.0.0.0'; :1502 app.listen({port, host: HOST})
- config/nip98-proxy/proxy.mjs:994 and :1155 drop any incoming x-agentbox-pubkey; :1012 and :1172 re-inject auth.pubkey; canonicalPubkey normalises to 64 lowercase hex
- flake.nix:2871 supervises the proxy with NIP98_PROXY_MGMT_UPSTREAM=http://127.0.0.1:%(ENV_MANAGEMENT_API_PORT)s; server.js:44 PORT default 9090; .env.example:131 NIP98_PROXY_MGMT_UPSTREAM=http://127.0.0.1:9090
- jest (binary from the agentbox checkout's node_modules, cacheDirectory in scratchpad, inline config) tests/sovereign/agent-event-auth.test.js → 16 passed, 0 failed
- config/custody/env-classes.json:340 lists AGENTBOX_PROXY_PEERS

Commands run: `git diff 3f05ae9e7..de7fa461e -- management-api/lib/agent-event-auth.js; jest --config '{"rootDir":".","testEnvironment":"node","testMatch":["**/tests/sovereign/agent-event-auth.test.js"],"testPathIgnorePatterns":[]}'`

Not checked, and notes: The original Consequences bullet '(b) is not true today ... a holder of that key can forge the header' is superseded by the dated 2026-10-12 Update in the same record (header now honoured only from loopback peers); the record is internally consistent as a dated history but a reader of the Consequences section alone would over-state the residual. Optional editorial tidy: add '(superseded by the 2026-10-12 update below for cross-container callers)' to that bullet; not required for truth. The residual in the update (same-container process can connect over loopback) is accurate. NIP98_PROXY_MGMT_UPSTREAM 'default http://127.0.0.1:9090' is true only of .env.example/the supervisor stanza (config/nip98-proxy/README.md:174 documents the code default as unset); the claim as worded is loosely true for the shipped deployment. I did not run the live proxy-to-management-api hop, so the claim that the proxy's connections arrive from loopback rests on the supervisor stanza + proxy.mjs, not a runtime capture.

Checked at `218dc12c3` by reading each claim against the code, not by the staleness diff alone. Stamped at `044f1d689`, which adds only the gate fixes in `config/custody/env-classes.json`, the `check-manifest-catalogue` baseline, `services/agentbox-vex`'s README and licence notice, a stale `agentbox.toml` comment, a stale `paths` example in the ontology-augment docs, and the grounding test's stub.
