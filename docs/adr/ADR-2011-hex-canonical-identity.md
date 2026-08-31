---
id: ADR-2011
title: Hex-canonical identity — 64-hex BIP-340 x-only is the sole storage/URL identity, npub is display-only
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: cbe7335b9
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
