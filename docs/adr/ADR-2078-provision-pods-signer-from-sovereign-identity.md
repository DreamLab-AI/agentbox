---
id: ADR-2078
title: Provision the pods signer from the sovereign identity the boot already mints
date: 2026-09-05
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: e070514d808b218574403377fb75e0e1a0a256b3
verified_paths: []
owner: jjohare
review_trigger: ADR-2064 flipping sign_requests back to true, a change to nostr-pod-bridge bootstrap key layout, or a second stack needing its own pod identity
repo: agentbox
domain: INGRESS-identity
---

# ADR-2078 — Provision the pods signer from the sovereign identity the boot already mints

## Context
ADR-2064 made the pods adapter fail closed when `sign_requests = true` and no NIP-98
header can be originated. At landing the rebuilt image resolved no signing material:
the signer (`management-api/adapters/pods`) expects a stack directory holding
`nostr.key.enc` + `nostr.salt` named by `AGENTBOX_STACK` / `sign_stack`; no stack has
one, and the supervised management-api carries no `AGENTBOX_STACK`. Meanwhile boot
phase 2 (`nostr-pod-bridge bootstrap`) already mints the container's sovereign
identity: `/var/lib/agentbox/identities/agent-did-main.key` (64-hex secret, devuser,
0600) and `agentbox-core.json`, exported to PID 1 through `/run/agentbox/identity.env`.
Two key layouts for one identity is why the flag could never be honoured (AB-11, ES-08).

## Decision
The pods adapter signs as the container's sovereign identity. The signer gains a
second source, tried first: the identity file the boot mints (path from the manifest
`[sovereign_mesh]` identity root, key name derived from the same slug the bootstrap
uses), read through the existing identity library rather than a new decoder, and
used with the existing NIP-98 originator (`nostr-bbs-core`/`k256` per the
never-hand-roll-crypto rule). The per-stack `nostr.key.enc` path remains for
profiles that own a distinct identity. `sign_requests` returns to `true` in both
manifests in the same change, and the entrypoint exports whatever the signer needs
to the management-api supervisor environment (no secret on argv or in supervisor
text; the SEC-003 move-to-file pattern applies).

## Consequences
Pod writes carry the agent's own `did:nostr` signature, which is what PRD-014 Seam C
promised and what a default-deny pod needs. The pods contract suite gains a signed
case for all three implementation classes. Until this lands, ADR-2064 keeps the
path declared unsigned and `activation_status: staged`.

## Acceptance test
1. With a fresh `agent-did-main.key` and no stack key, `sign_requests = true`: the
   pods adapter's fetch spy records exactly one request per operation, each carrying
   a NIP-98 `Authorization` header whose pubkey equals the identity in
   `agentbox-core.json`; zero unsigned requests.
2. With the key file absent: `SigningUnavailable` is thrown before any byte is sent
   (the ADR-2064 test) — no silent fallback to the stack path or to unsigned.
3. `sign_requests = false`: byte-identical to today.
4. `./agentbox.sh health` and `/ready` green in the rebuilt image with the flag on.

## Verification
None yet — proposed. The landing commit for this record must run the four cases above
and the full pods contract suite, and update INGRESS-identity's invariant on pod
origination.
