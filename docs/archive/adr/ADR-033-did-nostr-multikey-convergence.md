---
id: ADR-033
title: did:nostr Multikey convergence — single canonical DID Document form
status: accepted
date: 2026-06-15
type: contract
author: Dr John O'Hare
supersedes_clause: ADR-074 D2 (the SchnorrSecp256k1VerificationKey2019 / publicKeyHex document shape). ADR-074 D1 is retained unchanged.
depends_on: [ADR-005, ADR-009, ADR-010, ADR-012, ADR-013, ADR-017]
review_trigger: the did-nostr Community Group spec (nostrcg.github.io/did-nostr) publishes a new verificationMethod shape; melvincarvalho/create-agent changes its emitted document; or any change to the S4 emitter (s04-did.js) or the sovereign-bootstrap.py DID writer
---

# ADR-033 — did:nostr Multikey convergence (single canonical DID Document form)

**Related:** ADR-074 (cross-system did:nostr canonicalisation — this ADR
supersedes its D2 and retains its D1), ADR-013 (canonical URI grammar — the
`did:nostr:<hex>` identity string this ADR leaves untouched), ADR-010 / ADR-009
(solid-pod-rs + relay substrate that resolves the document), ADR-012 (JSON-LD
federation grammar — the S4 surface), `management-api/middleware/linked-data/surfaces/s04-did.js`
(the emitter), `scripts/sovereign-bootstrap.py` (the bootstrap writer),
`tests/contract/upstream_vectors/did-doc-conformance.json` (the conformance
corpus).

## TL;DR for newcomers

The DID Document for `did:nostr:<hex>` previously carried a
`SchnorrSecp256k1VerificationKey2019` verification method with a `publicKeyHex`
field (ADR-074 D2). The did-nostr Community Group spec and the canonical
reference implementation (`melvincarvalho/create-agent`) instead emit a single
`Multikey` verification method whose `publicKeyMultibase` is
`fe70102` + the 64-char lowercase x-only hex. This ADR adopts that single form
and **drops the 2019 suite — we do not dual-publish.** The agent's identity (the
`did:nostr:<hex>` string, the BIP-340 x-only even-y hex pubkey) is **unchanged**.
Auth (NIP-98) verifies the raw pubkey in the signed event and never reads the
verification method, so this is a pure re-encoding of the same key.

## Context

The mesh agreed on `did:nostr:<hex>` as the identity primitive (ADR-074 D1,
retained). The *document* shape, however, was pinned to the 2019 W3C suite with
a `publicKeyHex` field — a form that the did-nostr Community Group has since
converged away from in favour of W3C Multikey + multibase, matching the
`create-agent` reference. Carrying the old shape is gratuitous drift from the
ground-truth ecosystem the Solid/did:nostr infra was ported from
(JavaScriptSolidServer → solid-pod-rs → agentbox).

## Decision

### D1 (retained from ADR-074 D1) — canonical hex identity

Identity is the BIP-340 x-only (even-y) Schnorr secp256k1 pubkey, 64 lowercase
hex chars. The DID URI is `did:nostr:<64-hex>`. **Unchanged.** No identity, npub,
URN, ACL, pod, or payment migration is implied by this ADR.

### D2′ (supersedes ADR-074 D2) — canonical DID Document shape

The single canonical form is the did-nostr CG Multikey document:

```jsonld
{
  "@context": ["https://w3id.org/did", "https://w3id.org/nostr/context"],
  "id": "did:nostr:<hex>",
  "type": "DIDNostr",
  "verificationMethod": [{
    "id": "did:nostr:<hex>#key1",
    "type": "Multikey",
    "controller": "did:nostr:<hex>",
    "publicKeyMultibase": "fe70102<hex>"
  }],
  "authentication": ["#key1"],
  "assertionMethod": ["#key1"],
  "service": []
}
```

The `SchnorrSecp256k1VerificationKey2019` / `publicKeyHex` block is **dropped**.
We do **not** dual-publish both forms.

### D3′ (supersedes ADR-074 D3) — multibase encoding (the `02` byte is payload)

`publicKeyMultibase` = `"f"` + `"e701"` + `"02"` + `<x-only-hex-lower>`. The
segments are load-bearing:

| Segment | Bytes | Role |
|---|---|---|
| `f` | — | base16-**lower** multibase indicator (`F` upper is a different, malformed-here form) |
| `e701` | `0xe7 0x01` | unsigned-varint of `0xe7` = `secp256k1-pub`. Two bytes because `0xe7 ≥ 0x80`. A single-byte `e7` (`fe702…`) is wrong. |
| `02` | `0x02` | SEC1 compressed-point even-y prefix — the **first byte of the 33-byte multicodec payload**, NOT a separator. BIP-340 `lift_x` always selects even-y, so this is invariantly `02`. |
| `<hex>` | 64 chars | the 32-byte x-only `X`, byte-identical to the `did:nostr:<hex>` body |

The `secp256k1-pub` codec (`0xe7`) is defined over the **33-byte compressed
point**, never the raw 32-byte x-only value. Lengths are invariant: total
multibase string = `f`(1) + `e701`(4) + `02`(2) + `X`(64) = **71 chars**. A
consumer treating the body as `varint ‖ 32-byte-x-only` (no parity) produces the
WRONG, 2-char-shorter `fe701<x>` (67-char) form that does not round-trip.

The encoder MUST (a) prepend the `0x02` parity byte (33-byte compressed form),
(b) emit lowercase hex throughout, (c) round-trip to the identical key. Fixed
71-char output.

### D4′ — `service` array (canonical form is empty)

The canonical create-agent / did-nostr CG form emits `service: []`
unconditionally. The only spec-named populated entry is `type: "Relay"`. The
agentbox-specific entries (`SolidStorage`, `NostrRelay`, a WebID `SolidWebID`
entry) are **agentbox extensions** — permitted by the optional `service` field,
not part of the canonical reference output. They are layered by callers/manifest
gates; they MUST be labelled "agentbox extension", never "the create-agent form".

### D5′ — agent identity storage (DreamLab convention, inspired by create-agent)

`create-agent` does **not** store the key in `git config nostr.privkey` and does
**not** write `agent.did.json`: it takes `--privkey <hex>` on the CLI and writes
the document to stdout. The `git config nostr.privkey` (hex) + repo-root
`agent.did.json` layout that `sovereign-bootstrap.py` now writes is therefore a
**DreamLab convention inspired by create-agent's key/document separation** — it
is greenfield/additive to the existing `identity.env`, changes no key bytes, and
MUST be described as a DreamLab convention, not "the create-agent layout".

The **per-user pod is a full git repo** (Melvin's create-agent design), so the
pod-git ROOT — `<SOLID_POD_ROOT>/pods/<npub>` — is the repo into which
`agent.did.json` and the signing key are committed. `sovereign-bootstrap.py`
(`write_agent_repo_identity` → `_ensure_pod_git` + `wire_pod_contract_substrate`)
**git-init's the pod if needed**, writes `agent.did.json`, sets
`git config nostr.privkey`, and anchors the ADR-124 contract substrate
(`gitmark.json` + `blocktrails.json`) onto the live pod git with **real pod
commit SHAs** in `blocktrails.states[]`. An explicit `AGENTBOX_AGENT_REPO_ROOT`
override is honoured for non-pod deployments. The deploy ritual is
edit → commit → git-mark (write gitmark/blocktrails) → commit, with the trail
tip advanced to the real anchor commit SHA. Honest-or-caught (L0): the trail tip
is a real git commit; `txo[]` is empty (the single-use-seal seam to a confirmed
on-chain tx — L1/RGB/DLC — is reserved, not yet opened).

### D6′ — VerifiedSkill ↔ `aam skill sign` (functional analogue)

Our `VerifiedSkill` URN (`urn:agentbox:skill:<scope>:<name>:v<n>`) is the
**functional analogue** of create-agent's `aam skill sign` (a Schnorr-signed JCS
envelope, `owner_did` attester, URN kept as the internal index). It is an
analogue, not "his envelope".

## Hard invariants

- **I1.** Identity is the BIP-340 x-only (even-y) hex pubkey. The
  `did:nostr:<hex>` string is **unchanged**. No identity/npub/URN/ACL/pod/payment
  migration.
- **I2.** `publicKeyMultibase` MUST equal `"fe70102"` + the same 32-byte x-only
  hex (parity `02` because even-y). Regex `^fe70102[0-9a-f]{64}$`, length 71.
  Round-trips to the identical pubkey; no key bytes change.
- **I3.** Auth = NIP-98 Schnorr verification against the **raw pubkey in the
  event** — it MUST NOT read the DID-doc `verificationMethod`. Re-encoding the VM
  cannot touch the auth path.
- **I4.** ADR-074 D1 (x-only hex = canonical identity) **stays**. Only ADR-074 D2
  (the 2019 `publicKeyHex` document shape) is superseded.

## CI invariants (D13′ extension)

Every DID-doc conformance gate MUST assert:

1. `^fe70102[0-9a-f]{64}$` on `publicKeyMultibase` (lowercase, parity-present).
2. `len(publicKeyMultibase) == 71`.
3. Negative vector `fe701` + 64 hex (missing-parity, 67-char) → **rejected**.
4. Negative vector: any uppercase hex under `f` → **rejected**.
5. `publicKeyMultibase[7:] == doc.id["did:nostr:".len:]` (multibase body == DID body).

These live in `tests/contract/upstream_vectors/did-doc-conformance.json` and the
`tests/contract/linked-data/surfaces.contract.spec.js` S4 case. The
`sovereign-bootstrap.py` DID writer + the pod-git contract substrate (I1/I2/I4 +
the real-commit-SHA `blocktrails.states[]` assertion) are covered by
`tests/sovereign/test_sovereign_bootstrap_did.py`.

## Drift assessment (port lineage: JSS → solid-pod-rs → agentbox)

| Layer | State before this ADR | Action |
|---|---|---|
| `did:nostr:<hex>` identity string (ADR-074 D1) | Already conformant | **No change** (I1) |
| NIP-98 auth path | Verifies raw event pubkey; never reads the VM | **No change** (I3) |
| `.well-known` / WebID / Solid pod scaffolding | Conformant | **No change** (additive `agent.did.json` only) |
| S4 emitter `verificationMethod` shape | Drift: 2019 suite + `publicKeyHex` | **Corrected** to Multikey single form |
| `sovereign-bootstrap.py` `did-nostr.json` | Drift: 2019 suite + `publicKeyHex` (and a non-existent 2022 suite in the comment) | **Corrected** to Multikey single form |
| Conformance corpus | Pinned to ADR-074 D2 (`zQ3sh…` base58 + 2019 suite) | **Corrected**; negative vectors added |

## Consequences

### Positive
- Byte-conformance with the did-nostr CG / create-agent reference.
- One canonical document form; no dual-publish ambiguity.
- The `02`-parity / 71-char framing is now CI-policed, closing the latent
  missing-parity ship-bug.

### Negative
- Cross-repo: solid-pod-rs (`did_nostr_types.rs` encoder), nostr-rust-forum
  (`did.rs` prefix asserts), and VisionClaw / dreamlab-ai-website conformance
  fixtures must move to `fe70102` in lock-step. Tracked in their own repos; this
  ADR governs only the agentbox emitters and corpus.

### Neutral
- External Nostr clients are unaffected: they verify `event.pubkey`, not the DID
  document.

## ADR-124 build-out note (gitmark / blocktrails substrate)

This ADR is the identity half of the convergence. The contracts half (the
4-layer web-contract anchored by `gitmark.json` + `blocktrails.json`) is
identity-rail-agnostic and holds I1–I4 trivially. For the gitmark envelope, the
verbatim create-agent ground truth is the **5-key** form
`{@id, genesis, nick, package, repository}` — `@context`/`@type`/`commit`/`parent`
are NOT in the ground-truth file and must not be added to `gitmark.json`
(parent-linkage lives in `blocktrails.json` `states[]`/`txo[]`). "Verbatim" is
retained only for `gitmark.json`; `blocktrails.json`/`verify.js`/`validate-cli.js`/`ship.js`
are reconstructed "per the webcontracts.org reference shape", not lifted from a
fetchable create-agent artefact.

**Agentbox build-out (live surface, not a stub).** `sovereign-bootstrap.py`
anchors this substrate directly onto the **real per-user pod git**
(`build_gitmark` / `build_blocktrail` / `wire_pod_contract_substrate`):
`gitmark.json` (5-key form, `repository = did:nostr:<hex>`) and
`blocktrails.json` (`@type: Blocktrail`, `profile: gitmark`,
`states[]` = **real pod commit SHAs** confirmed against the pod's `git log`,
`txo[]` = the BIP-341 single-use-seal UTXO chain, empty at L0) are committed into
the pod and the trail tip is advanced to the live anchor commit. The same
gitmark/blocktrails shape is mirrored at the solid-pod-rs (`key_provisioning.rs`)
and forum (`provision.rs`) surfaces in their own repos — one shared design, no
parallel form. Trust model: honest-or-caught (L0); the single-use-seal seam
upgrades to trustless (RGB/DLC) when `txo[]` opens. Covered by
`tests/sovereign/test_sovereign_bootstrap_did.py`.

## References
- ADR-074 — Cross-System did:nostr canonicalisation (D1 retained, D2 superseded)
- did-nostr Community Group spec — https://nostrcg.github.io/did-nostr
- melvincarvalho/create-agent — `index.js` (the reference emitter)
- W3C DID Core — https://www.w3.org/TR/did-core/
- W3C Multikey / Multibase / Multicodec specs
- BIP-340 — Schnorr signatures for secp256k1
