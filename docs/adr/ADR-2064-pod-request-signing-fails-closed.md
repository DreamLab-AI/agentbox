---
id: ADR-2064
title: Pod request signing fails closed when a NIP-98 header cannot be originated
date: 2026-09-05
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: e070514d808b218574403377fb75e0e1a0a256b3
verified_paths: []
owner: jjohare
review_trigger: adding a pods adapter implementation, changing `[integrations.solid_pod_rs].sign_requests`, introducing a dev-profile flag to this codebase, or provisioning per-stack nostr signing material
repo: agentbox
domain: INGRESS-identity
lineage: ADR-2009 (nip98-proxy identity boundary), ADR-2010 (default-deny pod), ADR-005 §pods slot (adapter contract), ADR-2041 (fail-closed with no dev relaxation, because no dev flag exists), PRD-014 Seam C/C2 (pod NIP-98 origination)
---

# ADR-2064 — Pod request signing fails closed when a NIP-98 header cannot be originated

## Context

`[integrations.solid_pod_rs].sign_requests` turns on per-request NIP-98
origination so an agent authenticates to a default-deny pod under its own
`did:nostr`. The implementation was fail-open at two points in
`management-api/adapters/pods/_solid-http-base.js`: the constructor bound
`this._fetch = this._rawFetch` whenever the originator was falsy, and
`_signedFetch` returned `this._rawFetch(...)` whenever no header could be built.
`lib/pod-signer.js` returns `null` for *both* "signing not wanted" and "signing
wanted but unavailable" (no stack resolved, key undecryptable), so the second
case silently emitted an unsigned request with no error surfaced anywhere.

That contradicts the estate's fail-closed posture. It is not hypothetical: in
the deployed manifest `sign_requests = true` while the supervised
management-api has no `AGENTBOX_STACK`/`AGENTBOX_PROFILE` and no `sign_stack`,
so every pods request goes out unsigned today while the manifest claims
otherwise.

## Decision

`sign_requests` is a fail-closed switch, not a best-effort hint.

- The pods adapter takes `requireSigned`, set by `adapters/index.js` from
  `[integrations.solid_pod_rs].sign_requests`. It rides with the adapter config
  **even when the signer could not be built**, so an unbuildable signer cannot
  degrade into an unsigned request.
- When `requireSigned` is set and no `Authorization` header can be produced —
  no originator configured, the originator throws, or it declines by returning
  a falsy value — the adapter throws the typed
  `SigningUnavailable` (`code: SIGNING_UNAVAILABLE`, `slot: 'pods'`) and **no
  request is emitted**. The pods slot degrades visibly per the adapter
  contract instead of going out anonymous.
- A caller-supplied `Authorization` header is still trusted and never
  overwritten, in both modes.
- When `sign_requests` is off, behaviour is byte-identical to the prior
  unsigned path. `requireSigned` defaults to false, so every existing caller
  and all three adapter classes are unaffected.
- **No dev-profile relaxation.** As established at ADR-2041, a grep across
  agentbox for `AGENTBOX_DEV*` / `dev_profile` / `dev_mode` / `dev-profile`
  finds no such flag. This ADR does not invent one; refusal is unconditional
  until a future ADR introduces a real dev gate.

## Consequences

- A misconfigured or unprovisioned signer becomes a loud, typed failure rather
  than a silent authentication downgrade. This is the point of the change.
- **Activation prerequisite.** With `sign_requests = true` and no resolvable
  signing material, the pods slot now fails every operation instead of working
  unsigned. In this container signing cannot currently succeed at all: there is
  no `AGENTBOX_STACK`, no `sign_stack`, and no `nostr.key.enc` on disk (see
  ADR-2066). The operator must either provision signing material or set
  `sign_requests = false` to declare the pod path unsigned deliberately. The
  manifest comment now states this prerequisite next to the key.
- `activation_status: staged` rather than `live`: the code path is complete and
  tested, but in this deployment it changes a working-but-unsigned slot into a
  failing one until the prerequisite above is met.
- `lib/pod-signer.js` returning `null` no longer decides the request outcome; it
  only reports "no originator could be built". The decision belongs to the
  adapter, keyed on the same manifest flag.

## Verification

Verified on the uncommitted working tree above
`e070514d808b218574403377fb75e0e1a0a256b3` (`git rev-parse HEAD`); the changes
described here were not committed at verification time, so `verified_paths` is
empty.

- `cd management-api && ./node_modules/.bin/jest ../tests/contract/pods.contract.spec.js ../tests/sovereign/pod-nip98-origination.test.js`
  → 2 suites passed, 53 passed / 17 todo (baseline before the change: 42 passed).
  New coverage asserts that with `requireSigned` and no originator the adapter
  throws `SigningUnavailable` on `write`/`read`/`del`/`list` **and that the
  fetch spy recorded zero calls** — i.e. nothing left the process unsigned.
- The contract suite asserts the guarantee per adapter class: `local-solid-rs`
  and `external` both fail closed; `off` is exempt (no HTTP surface) and still
  raises `AdapterDisabled` on every method.
- `cd management-api && ./node_modules/.bin/jest` → 80 suites, 1289 passed,
  0 failed (whole-suite regression check).
- Live fail-open confirmed before the fix by loading the real server module:
  `[adapters] pods NIP-98 signing unavailable: pod-signer: sign_requests is on
  but no stack resolved` — previously followed by unsigned requests.

## Queen decision at landing — 2026-09-05

The lane's finding that the hole is live, not theoretical, was confirmed: no stack
holds `nostr.key.enc`, `sign_stack` is unset, the supervised management-api has no
`AGENTBOX_STACK`, so every pods request has been unsigned since the flag existed.
Leaving `sign_requests = true` would make the fail-closed adapter throw at the
next restart and degrade the pods slot, taking the JS relay consumer's inbox
writes (ACSP governance) with it. `sign_requests` is therefore set to `false` in
both manifests with a dated comment: the pod path is declared unsigned
deliberately, which is what the runtime has honoured all along. This record
stays `activation_status: staged` until ADR-2078 (proposed) provisions the
signer from the sovereign identity the boot already mints
(`/var/lib/agentbox/identities/agent-did-main.key`, hex secret, devuser-owned),
at which point the flag returns to `true` in the same change. Verified after the
flip: `node scripts/agentbox-config-validate.js` on both manifests, and the pods
contract suite with `sign_requests = false` byte-identical to prior behaviour.
