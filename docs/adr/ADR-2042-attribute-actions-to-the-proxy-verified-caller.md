---
id: ADR-2042
title: Attribute actions to the proxy-verified caller, and the trust caveat that comes with it
date: 2026-09-05
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 3f05ae9e7ae13d103ad8d9fe06baed991fedb987
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

## Alternatives rejected

- Trusting `X-Agentbox-Pubkey` unconditionally, including alongside a Nostr header: lets a
  bad signature be papered over.
- Dropping path 2: breaks NIP-07 session and break-glass callers, which have no way to sign
  on the second hop.
