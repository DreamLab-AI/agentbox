---
id: ADR-2011
title: Hex-canonical identity — 64-hex BIP-340 x-only is the sole storage/URL identity, npub is display-only
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: [management-api/lib/agent-identity.js, config/nip98-proxy/proxy.mjs]
owner: jjohare
review_trigger: A durable identity appears in bech32/npub form in storage or a URL, or the did:nostr:local fallback fires in production
repo: agentbox
domain: INGRESS-identity
lineage: legacy ADR-053 (hex-canonical pod naming), ADR-033 (did:nostr / Multikey convergence, D3′)
---

# ADR-2011 — Hex-canonical identity: 64-hex x-only everywhere durable

## Context
An identity has several encodings (bech32 npub, x-only hex, did:nostr, W3C
Multikey). Storage paths, URLs and cross-references need exactly one canonical
form, or the same agent forks into multiple identity strings. bech32 is
case- and checksum-sensitive and a poor filesystem/URL key. The private key must
never leave the mint. Cross-repo, visionclaw reached the same hex-canonical
decision independently (ADR-2022) — parallel, not deduped. Governing doc:
`docs/INGRESS-identity.md`.

## Decision
Every durable identity is a lowercase 64-hex BIP-340 x-only pubkey, used
directly in storage paths, URLs and `did:nostr:<hex>`. A fixed-71-char
did:nostr Multikey (`fe70102` prefix + 64-hex) is offered alongside for
downstream DID consumers. npub/bech32 is a display and symlink form only, never
a storage or lookup key. The proxy accepts only `^[0-9a-f]{64}$` pubkeys. The
private key never leaves the mint function — only the public did:nostr, x-only
pubkey and Multikey are returned. This forecloses bech32 as a durable key and
any identity string that is not the canonical hex.

## Consequences
Identity comparison is a plain lowercase-hex string match; paths and URLs are
stable and case-insensitive-safe. Cost: humans see hex, not friendly npubs, at
the storage layer — display translation is a separate concern. Residual: on a
degraded boot where an x-only key cannot be derived, the entrypoint keeps its
historic `did:nostr:local` placeholder fallback rather than aborting — a
non-canonical identity that must be caught before it reaches storage.

## Verification
Re-checked at `cbe7335b9`: `management-api/lib/agent-identity.js:150`
(`did: did:nostr:${xOnly}`), `:45` (`MULTIKEY_PREFIX = 'fe70102'`), `:50`
(`multikeyFromXonly`). Proxy validates only `^[0-9a-f]{64}$` at
`config/nip98-proxy/proxy.mjs:120`, `:250`, `:396`. Residual placeholder
fallback confirmed at `agent-identity.js:175`/`:184` (`did:nostr:local`,
fail-open).

## Closeout extension — 2026-09-04

**Work package:** CP-01 / CP-04. **Owner:** existing owner above. **Dependencies:** CP-01
revision/feature identity and the downstream consumer contract.

**Current source verification:** The identity helper returns lowercase x-only public identity and persists the private key with mode 0600. A persistence failure can return a valid but restart-unstable identity with `persisted: false`; derivation failure returns null and the entrypoint may retain its placeholder. The helper does not establish a universal cross-repository identity migration.

At `89301ec7c911eab270c00a0cf81596d0d4f15535`, the local proxy suite passes 45 assertions with no skips using
`NODE_PATH=management-api/node_modules node config/nip98-proxy/selftest.mjs`.
The initial default-resolution run skipped three signature cases; both runs
are preserved in the [estate receipts](../../../../VisionFlow/docs/estate-review/evidence/ingress-selftest-runtime-deps.json).
These are local fake-upstream checks, not deployed acceptance or, for the
identity helper, a key-persistence test. Prior verification at `960394b145fc2f9ab1c3191b682f87079c712e9e` remains
part of this record's history; the refreshed commit covers the scoped source
claims above. Existing activation labels are not newly verified by this run.

**Acceptance still required:** Verify restart stability, rejected or explicitly quarantined placeholder identities, failed persistence, existing-key permissions and canonical storage/URL lookup in each pod tier. Confirm that public identifiers remain stable without disclosing private key material.

## Acceptance progress — 2026-09-05

**Implemented.** The identity helper's claims are now asserted directly.

- Output is a lowercase 64-hex x-only public identity; the `did:nostr` form uses
  that hex verbatim and the Multikey is the fixed 71-character form.
- `deriveXonly` rejects npub/bech32, short and non-hex input, while an
  **uppercase private hex still derives the lowercase canonical pubkey** — case
  normalisation happens on the way in, not silently on the way out.
- The private key file is persisted with mode **0600** by both the mint API and
  the CLI, and **restart with the same key file yields the same identity** rather
  than a re-mint.
- A persistence failure surfaces `persisted: false` rather than a valid but
  restart-unstable identity presented as durable.
- No private key material appears in the returned identity, in the CLI export, or
  in proxy stdout/stderr — with an explicit non-vacuousness control asserting the
  child proxy's logs were actually captured, so the check cannot pass by
  observing nothing.

**Tests and results.** `NODE_PATH=management-api/node_modules node config/nip98-proxy/selftest.mjs`
— **120 assertions, 0 failures, 0 skips**. The suite grew from 45 assertions with
the cases listed above; the pre-existing cases are unchanged.

**Receipts.** `docs/estate-closeout/2026-09-05/adr-2009-nip98-selftest.json`.

**Remaining.** Rejected-or-quarantined placeholder identities, existing-key
permission repair, and canonical storage/URL lookup in each pod tier are not
covered. The helper still does not establish a universal cross-repository
identity migration, and no booted-image key-persistence test ran.

**Governed paths changed.** `config/nip98-proxy/selftest.mjs`,
`config/nip98-proxy/proxy.mjs`.
