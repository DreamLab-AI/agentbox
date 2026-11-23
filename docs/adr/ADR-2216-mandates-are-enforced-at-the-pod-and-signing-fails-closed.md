---
id: ADR-2216
title: Mandates are enforced at the pod, and mandate signing fails closed
date: 2026-11-23
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 9df9ce56d373880e7fad42f6d0f89b9925ab9f5f
verified_paths: [management-api/routes/sessions-boundary.js, management-api/lib/mandate-runtime.js, management-api/lib/journal-lock.js, management-api/lib/mandate.js, management-api/lib/mandate-acl.js, management-api/lib/mandate-grant.js, management-api/lib/mandate-revocation.js, management-api/lib/mandate-registry.js, management-api/lib/mandate-signer.js, management-api/lib/mandate-publish.js, management-api/routes/mandate.js, management-api/routes/voice-intent.js, services/nostr-pod-bridge/src/identity_port, config/custody/identity-port-acl.json]
owner: jjohare
review_trigger: management-api moving to its own uid, a second pod owner per container, a session-DID pod signer, solid-pod-rs changing its ACL sidecar layout, or the identity port gaining a generic 30078 grant
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
5. **Tombstone.** `ensureMandate` never re-mints over a revoked mandate, and the tombstone covers every container that overlaps the revoked one for that agent (ancestor, descendant or equal), because `acl:default` makes a parent grant re-admit it. Only the operator's explicit `POST /v1/mandate` replaces one, and it first drives any unfinished revocation of the old entry to `revoked` (pod, then relay) or is refused 409 `revocation_pending`.
6. **voice-intent** looks the URN up in the registry; revoked, revoking, expired or absent is inactive, and the event signer must equal the registered issuer and pod owner.
7. **Identity port.** A 30078 is grantable only to `sign_event` on `core`, and the port signs it only as the exact mandate envelope: `created_at` within 300 s of the port's clock; exactly one each of `d` (`urn:agentbox:mandate:<core xonly>:[A-Za-z0-9_-]+`), `p` (64 lowercase hex), `t=agent-mandate` and `status` in {active, revoked}, plus at most one numeric `expiration`, and no other tag; content a JSON object (at most 16 KiB) with `urn == d`, `issuer == did:nostr:<core>`, `agent == did:nostr:<p>` and a boolean `revoked` that agrees with `status`.
8. **Who may grant, and where.** A session or lazy grant is confined to `/pods/<owner>/proj/<slug>/` (the `proj/` root and anything else is refused); container segments may not start with a dot; the agent may not be the issuer. `/v1/sessions/boundary` requires the operator for `eager_mandate` and no longer honours `mandate_container`: the container is always `/pods/<owner>/proj/<sanitised slug>/`. Only the explicit operator `POST /v1/mandate` may target another container. Legacy registry entries migrate (URN kept; a never-enforced legacy `active` becomes `failed` and is re-granted on use; on a key collision the more restrictive state wins).
9. **Signer outage never freezes a revocation.** A revoke marks the entry `revoking` locally before preflight (no signature needed), answers 503 with `effective_at_pod:false`, and the reconciler drives the pod and relay when a signer returns. Reconciler work still undone after one interval is logged as `mandate.reconcile-overdue`.
10. **A rolled-back grant that had been signed is superseded.** The `active` event is recorded before it is published; a rollback (or the reconciler's stale-`granting` rollback) publishes `status=revoked` for it, or leaves `revoke_event_pending` for the reconciler.
11. **The sidecar is never taken from someone else.** Every managed sidecar carries the marker triple `<#managed> a <urn:agentbox:ns#ManagedSidecar>`. The current sidecar is read before the first write; one without the marker is refused with 409 `foreign_acl` and left intact, and only a marked sidecar is deleted.
12. **Concurrency and transport.** The registry read-modify-write and the per-container lock use `journal-lock` (cross-process, stale-holder takeover); the registry directory is held at 0700; the pod client refuses plain `http:` to a non-loopback host.
13. **Out of scope.** Revoke stays outside `authority.guard` (it only reduces authority), and there is no session-DID pod signer.

## Known residuals
- **Uid 1000 can sign a mandate envelope.** management-api shares uid 1000 with the agents, and uid 1000 already holds `nip98` on `core`. Pod enforcement therefore contains a cooperating agent, not a hostile uid-1000 process: such a process can already sign any NIP-98 request as the owner. The envelope checks above remove the generic-30078 and far-future-`created_at` abuse; a separate uid for management-api (so that only it holds `sign_event`/`nip98` on `core`) is the real fix and is out of scope here.
- A hand-written sidecar on a managed container blocks the grant (409) until the operator resolves it.
- The foreign-sidecar check is a read followed by a write, not an atomic compare-and-swap.

## Consequences
Agent pod writes become genuinely scoped and revocable, and a revoke is effective at the pod before it is published. Grants and revokes now need a working pod, signer and local relay; an outage is a 5xx, not a silent downgrade. A grant over a container that already has a hand-written sidecar fails 409 rather than overwriting it. The ACL client spaces same-second identical requests because NIP-98 events carry no nonce and the pod rejects the repeat as a replay. The pod matches NIP-98 against its public origin, so the client connects to the local listener but signs `[integrations.solid_pod_rs].base_url`; with `base_url` unset under the identity port, signing is refused and mandates fail closed. Assumes the identity-port `core` key is the pod owner's key; if not, every grant is 503 `signer_mismatch`.

## Verification
`management-api` jest and `test:node` (including `tests/integration/mandate-enforcement.node-test.js` against a real solid-pod-rs-server and a WebSocket relay, and `tests/sovereign/mandate-signer.node-test.js` against the real identity port), and `cargo test -p nostr-pod-bridge`. Run on the branch before the verified_commit stamp.
