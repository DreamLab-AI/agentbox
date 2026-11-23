---
id: ADR-2216
title: Mandates are enforced at the pod, and mandate signing fails closed
date: 2026-11-23
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 5b02f72a7c380a2a22372aab8141c664a560e5c3
verified_paths: [management-api/lib/mandate.js, management-api/lib/mandate-acl.js, management-api/lib/mandate-grant.js, management-api/lib/mandate-revocation.js, management-api/lib/mandate-registry.js, management-api/lib/mandate-signer.js, management-api/lib/mandate-publish.js, management-api/routes/mandate.js, management-api/routes/voice-intent.js, services/nostr-pod-bridge/src/identity_port, config/custody/identity-port-acl.json]
owner: jjohare
review_trigger: a second pod owner per container, a session-DID pod signer, solid-pod-rs changing its ACL sidecar layout, or the identity port gaining a generic 30078 grant
repo: agentbox
domain: INGRESS-identity
evidence_class: source+test
acceptance_boundary: Unit, lifecycle and Rust port tests pass, and the integration suite drives a real solid-pod-rs-server through grant (session-key PUT 201), revoke (403, owner 200), relay outage and pod outage. It does not establish behaviour behind the production Cloudflare tunnel, a live relay at ws://127.0.0.1:7777, or the identity port's sign_event grant on a rebuilt image; it stays staged until the image is rebuilt and a grant is observed on the running pod.
---

# ADR-2216 — Mandates are enforced at the pod, and mandate signing fails closed

## Context
ADR-043 D4.5 mounted `/v1/mandate` and let a mandate be minted unsigned when no signer existed. The design pass at `3f66d51ff` found a mandate was never enforced anywhere: `acl_turtle` was rendered but never PUT, it targeted `<container>/.acl` while solid-pod-rs reads `<container-without-slash>.acl`, and it used root-relative IRIs with no owner block. The kind-30078 event was signed and never published. voice-intent accepted a presented `revoked:false` event forever. `ensureMandate` re-minted over a revoked record. Revoke only rewrote the local registry, signed with the operator stack (unsigned without one), and cached a failed signer lookup for the process. ADR-2064 made pod requests fail closed, ADR-2078 chose the sovereign identity as the pods signer, ADR-2122 put signing behind the identity port, and ADR-2100 keeps authority-increasing settlement behind the gate; the mandate path honoured none of these.

## Decision
1. **Enforced at the pod.** A grant renders the container's whole WAC sidecar from the registry (owner block with Read/Write/Append/Control, plus one `<#mandate-<sha256 urn>>` block per active mandate on full `/pods/<owner>/…` targets) and PUTs it at `<container-without-slash>.acl`; with no active mandate it DELETEs it. Every write is read back. Control is not an allowed mandate mode.
2. **One authority.** The pod's Control holder signs both the ACL requests (NIP-98) and the kind-30078 event, selected by the pods adapter's rule (ADR-2078): the identity port's `core` key under role isolation (ADR-2122, `nip98` and `sign_event`), else a named stack, else the sovereign identity. It must equal `record.issuer` (issuer = pod owner). It replaces `_loadSigner(stack)`; nothing is cached negatively.
3. **Signing is fail-closed (amends ADR-043 D4.5, consistent with ADR-2064).** No signer, or a signer that is not the issuer, is 503 `signer_unavailable` with no change. There is no unsigned grant and no unsigned revoke, and this holds with `sign_requests = false`.
4. **Lifecycle.** States: `granting, active, revoking, revoked_unpublished, revoked, failed, expired`; only an unexpired `active` is enforceable. Grant: preflight, mint, PUT, sign, publish (the local relay must answer OK), mark active; a failure rolls the sidecar back. Revoke: preflight, mark `revoking`, PUT/DELETE and read back, sign and publish `status=revoked` with `created_at = max(now, grant.created_at + 1)`, then the `revoked` tombstone. Pod failure leaves `revoking` and answers 502 `effective_at_pod:false`; publish failure leaves `revoked_unpublished` and answers 200 `published:false`. A reconciler (start-up and interval) re-drives both, rolls back stale `granting`, and retires expired mandates. Each transition is audited to `mandates/audit.jsonl` and emitted as an agent action. Per-container locking spans the whole operation.
5. **Tombstone.** `ensureMandate` never re-mints over a revoked mandate; only the operator's explicit `POST /v1/mandate` replaces one.
6. **voice-intent** looks the URN up in the registry; revoked, revoking, expired or absent is inactive, and the event signer must equal the registered issuer and pod owner.
7. **Identity port.** A 30078 is grantable only to `sign_event` on `core`, and the port signs it only with exactly one `d` tag `urn:agentbox:mandate:<core xonly>:<local>` and `t=agent-mandate`.
8. **Containers** are `/pods/<owner>/proj/<slug>/`; legacy registry entries migrate (URN kept; a never-enforced legacy `active` becomes `failed` and is re-granted on use).
9. **Out of scope.** Revoke stays outside `authority.guard` (it only reduces authority), and there is no session-DID pod signer.

## Consequences
Agent pod writes become genuinely scoped and revocable, and a revoke is effective at the pod before it is published. Grants and revokes now need a working pod, signer and local relay; an outage is a 5xx, not a silent downgrade. The sidecar is owned by the registry: a hand-written sidecar on a managed container is overwritten. The ACL client spaces same-second identical requests because NIP-98 events carry no nonce and the pod rejects the repeat as a replay. The pod matches NIP-98 against its public origin, so the client connects to the local listener but signs `[integrations.solid_pod_rs].base_url`; with `base_url` unset under the identity port, signing is refused and mandates fail closed. Assumes the identity-port `core` key is the pod owner's key; if not, every grant is 503 `signer_mismatch`.

## Verification
`management-api` jest and `test:node` (including `tests/integration/mandate-enforcement.node-test.js` against a real solid-pod-rs-server and a WebSocket relay, and `tests/sovereign/mandate-signer.node-test.js` against the real identity port), and `cargo test -p nostr-pod-bridge`. Run on the branch before the verified_commit stamp.
