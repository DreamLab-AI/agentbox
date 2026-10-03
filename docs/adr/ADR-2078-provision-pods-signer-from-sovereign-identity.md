---
id: ADR-2078
title: Provision the pods signer from the sovereign identity the boot already mints
date: 2026-09-05
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 26fc543d2a98f1e3d192408ea4cd13d10cd59ddf
verified_paths: [management-api/lib/pod-signer.js, management-api/lib/agent-identity.js, management-api/adapters/index.js, management-api/adapters/pods/_solid-http-base.js, tests/sovereign/pod-sovereign-signer.node-test.js]
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
Implemented at `a48ea407a` (see Acceptance — 2026-10-02 below). The four cases:

| Case | Where | Result at `a48ea407a` |
|---|---|---|
| 1. fresh identity, no stack key, flag on: one request per operation, each NIP-98 header verifying as the `agentbox-core.json` pubkey, zero unsigned | `tests/sovereign/pod-sovereign-signer.node-test.js`, both HTTP impls (`local-solid-rs` through `resolveAdapters`, `external`); real BIP-340 keys verified by `NostrBridge.verifyNip98` with payload binding | pass |
| 2. identity file absent: `SigningUnavailable` before any byte, no stack or unsigned fallback | same file; an ambient `AGENTBOX_PROFILE` and on-disk stack key material are present and ignored; zero requests; operator warning names the file | pass |
| 3. flag off: byte-identical | same file; request log equal to a manifest without the key | pass |
| 4. `./agentbox.sh health` and `/ready` green in the rebuilt image with the flag on | runtime, in the owner's pending rebuild | **pending** (hence `activation_status: staged`) |

The pods contract suite gains a signed case for `local-solid-rs` and `external`
(`tests/contract/pods.contract.spec.js`, `[ADR-2078]`); `off` has no HTTP surface and stays exempt,
as it is for ADR-2064. INGRESS-identity gains invariant 11 (pod origination).

Counts at `a48ea407a`: node:test acceptance 13/13; `npm run test:node` 117/117; jest
`tests/sovereign` + `tests/contract/pods` + `tests/integration` 63 suites, 964 passed (3 skipped,
17 todo); contract gate (`npx jest ../tests/contract/ --testPathPatterns='\.contract\.spec\.js$'`)
29 suites, 596 passed (34 todo); `node scripts/agentbox-config-validate.js` valid for both
manifests; `scripts/ci/check-manifest-catalogue.js` 73/73.

## Disposition — 2026-10-02

- **Suitability:** fits
- **Priority:** P2 — next cycle (named in planning cycle §3 as a sidechain reopening condition and in §6 as "the first item of the next cycle")
- **Why:** Nothing is implemented. `agentbox.toml:546` still has `sign_requests = false`, and no commit references this record since it was filed. The queen's adjudication in §6 is explicit: the record is architecturally right, but a real signer wired into a runtime whose hub was dark would add one more unverifiable claim. The hub has been fixed since then (CY-A1, done 30 Sep).
- **Next:** At the start of the next cycle, implement it and run the four acceptance cases with the pods contract suite in the rebuilt image.

## Acceptance — 2026-10-02

Owner decision **SC3** (sidechain sprint, 2026-10-02), asked whether to keep this record in the
sprint: **"Yes. dark pods is fine, there's no data and a clear signal and progression."** The signer
is wired to the boot-minted identity and `sign_requests = true` lands in both manifests in the same
change. A fail-closed pods slot after the flip is accepted as a signal, not a failure to avoid.

**What landed (`a48ea407a`).**
- `management-api/lib/agent-identity.js` gains `sovereignIdentityPath` and `loadSovereignSigner`: a
  read-only reader of `<AGENTBOX_IDENTITY_ROOT>/<AGENTBOX_AGENT_ID>.json`, resolved exactly as
  `nostr-pod-bridge bootstrap` resolves it (`services/nostr-pod-bridge/src/bootstrap.rs`, defaults
  `/var/lib/agentbox/identities` and `agentbox-core`). It never mints, refuses a secret that does not
  derive its recorded `x_only_pubkey_hex` (via the existing `deriveXonly`), and returns only
  `pubkey`, `did`, `path` and a `sign` closure (nostr-tools `finalizeEvent`, the primitive the
  existing `loadSigner` uses). The header comes from the existing `NostrBridge.buildNip98Header`.
  No crypto is implemented here.
- `management-api/lib/pod-signer.js` selects the source explicitly: the sovereign identity by
  default; a per-stack `nostr.key.enc` only when `AGENTBOX_STACK` or `sign_stack` names one.
- `config/entrypoint-unified.sh` Phase 3 pins `AGENTBOX_IDENTITY_ROOT` for writer and reader and,
  after the bootstrap, hands the identity file to devuser at 0600. `AGENTBOX_AGENT_ID` already
  reaches PID 1 through `identity.env`. Only a path and a slug cross into the supervisor
  environment; no secret is on argv or in supervisor text (SEC-003).

**Corrections to the proposal's text, found in implementation.**
1. *Which file is the sovereign identity.* Context names
   `/var/lib/agentbox/identities/agent-did-main.key` as what the bootstrap mints. It is not. The
   bootstrap writes `agentbox-core.json`; `agent-did-<profile>.key` files are minted by
   `agent-identity.js` per profile (the entrypoint's own mint lands as `agent-did-agentbox-core.key`,
   root 0600, and backs `AGENTBOX_AGENT_DID`). On the running container the `agent-did-main.key`
   keypair differs from the `agentbox-core.json` keypair. Acceptance case 1 requires the pubkey in
   `agentbox-core.json`, and that is the keypair the bootstrap writes into the pod ACL and DID
   documents, so the signer reads `agentbox-core.json`. Signing with `agent-did-main.key` would
   produce headers a default-deny pod rejects.
2. *"Path from the manifest `[sovereign_mesh]` identity root".* The manifest has no such key; the
   bootstrap resolves the root from `AGENTBOX_IDENTITY_ROOT`. The signer mirrors the bootstrap, and
   the entrypoint pins the variable, rather than a new manifest key being invented.
3. *"Tried first".* Read literally, a sovereign source tried first and a stack path tried second is
   the silent fallback that acceptance case 2 forbids. The landed rule is selection, not fallback:
   sovereign by default; a stack only when named explicitly. `AGENTBOX_PROFILE` no longer selects a
   stack, because every harness wrapper exports it and an ambient session slug must not divert pod
   writes away from the identity the pod trusts.

**Notes beyond the record.**
- No error on this path quotes the identity file's contents: a corrupt file is refused as "not
  valid JSON" naming only the path, because V8's `SyntaxError` quotes a slice of the input, which
  here would be key material bound for the operator log (tested).
- jest on Node 22 cannot load nostr-tools' ESM-only `@noble` packages, so the real-key cases run
  under `node:test` (the `chain-info.node-test.js` pattern). They are wired into
  `.github/workflows/contract-tests.yml` (with `NODE_PATH` at management-api's nostr-tools, since CI
  does not install `mcp/`) and `npm run test:node`. A guard test fails loudly if the verifier cannot
  run Schnorr, so the suite cannot pass vacuously.
- Pre-existing and out of scope: `resolveAdapters` hands every `external` impl `externalUrl` while
  the classes read `baseUrl` (already recorded in `tests/integration/resolver-degraded.test.js`), so
  `adapters.pods = "external"` cannot be constructed from the manifest. The acceptance test builds
  that impl from the same signer config the resolver derives.

**Activation.** Everything here takes effect only at the owner's pending image rebuild: the
management-api code and manifests are baked into `/opt/agentbox` and `/etc/agentbox.toml`, and the
entrypoint change runs at boot. `activation_status` moves to `live` once case 4 passes in the
rebuilt image: `./agentbox.sh health` and `/ready` green with the flag on, and a pods write carrying
a header that verifies as the `agentbox-core.json` pubkey. Until then, and after it if the pod is not
running, a pods slot failing closed with `SigningUnavailable` is the expected, accepted state (SC3).

## Re-verification — 2026-10-03 (`26fc543d2a98f1e3d192408ea4cd13d10cd59ddf`)

Tripped by `management-api/lib/pod-signer.js` gaining a third, flag-gated signing source: the identity port (custody X-1 step 1, W3; ADR-2122). Under `[security].role_isolation`, or with `[integrations.solid_pod_rs].sign_source = "identity-port"`, the header comes from `nostr-pod-bridge sign-request nip98`. That source is then the only one, so no identity file or stack key is read. The port signs with the same sovereign key this record names; what changes is custody of the key, not which identity signs. With the flag off and `sign_source` unset, nothing new runs and this record's decision holds unchanged. `pod-sovereign-signer.node-test.js` still passes 13/13. ADR-2064's fail-closed behaviour carries over: a refused or absent port throws, and the adapter raises `SigningUnavailable` with zero requests sent (`tests/sovereign/identity-port.node-test.js`, 10/10 against the real binary and `NostrBridge.verifyNip98`). Design §5 calls for an amendment to this record ("under the flag the signer source is the port"). That amendment is for ADR-2122 to make once it lands. It is not made here. Status unchanged.
