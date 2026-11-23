---
id: ADR-2011
title: Hex-canonical identity — 64-hex BIP-340 x-only is the sole storage/URL identity, npub is display-only
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 06c2f701130aa94edf24a20f9f86de2131a0bcf4
verified_paths: [management-api/lib/agent-identity.js, config/nip98-proxy/proxy.mjs]
owner: jjohare
review_trigger: A durable identity appears in bech32/npub form in storage or a URL, or the did:nostr:local fallback fires in production
repo: agentbox
domain: INGRESS-identity
lineage: legacy ADR-053 (hex-canonical pod naming), ADR-033 (did:nostr / Multikey convergence, D3′)
---

# ADR-2011 — Hex-canonical identity: 64-hex x-only everywhere durable

## Scoped source check — 2026-11-14

Reviewed at `18315de55b9be6f8fdaed6e9f33b6ad26da1cf4f`. agent-identity.js is unchanged. The proxy diff removes the retired constant-false AoE discriminator without changing public-key canonicalisation. With the declared nostr-tools dependency available, the proxy selftest passes without failures or skips, including identity minting, persistence, lowercase hex and rejection of invalid identity forms. This is isolated fixture evidence, not a new production identity rehearsal.


## Re-verification — 2026-10-29 at 3b498088e (ADR-2153 cutover)

Reviewed the governed-path diff from this record's previous verification to
`3b498088e5a35e78158a9eb8d6f0266996d31f82`. Shared manifest, schema, supervisor and bootstrap changes
are scoped to the owned session plane: AoE and its token consumers retire,
provider provisioning moves, and session status hooks are added. Other named
capability sections and their status axes retain their existing claims.
Validation: session-plane tests (44 unit, 15 integration), manifest projector
suite and Clippy for both crates, proxy selftest (zero failures/skips), hook
registration (12), role-supervisor isolation (25), boot projection (13), and
manifest catalogue/declared-state checks pass locally. This does not claim new
runtime acceptance of this record's unrelated capabilities.

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

**2026-09-05 re-verified at 08e817f39.** Governed paths changed by ADR-2044 (`management-api/lib/agent-identity.js`, +44/-6: the `mint` CLI now exits non-zero with no export lines on a failed mint or a failed persist, instead of failing open) and by `11804ba4b` in `config/nip98-proxy/proxy.mjs`. Both tighten the canonical-identity path; the decision still holds. The `cbe7335b9` citations above have drifted; at HEAD: `management-api/lib/agent-identity.js:168` (`did: \`did:nostr:${xOnly}\``), `:63` (`MULTIKEY_PREFIX = 'fe70102'`), `:68-69` (`multikeyFromXonly`, lowercased), `:154-161` (private key persisted 0600, `persisted` flag at `:173`). The proxy still accepts only `^[0-9a-f]{64}$`: `config/nip98-proxy/proxy.mjs:222` (allowlist entries), `:244` (`canonicalPubkey`), `:367` (route config), `:565` (session token). **The residual recorded in Consequences is unchanged and still real:** `config/entrypoint-unified.sh:915` still runs `export AGENTBOX_AGENT_DID="${AGENTBOX_AGENT_DID:-did:nostr:local}"` unconditionally, so the ADR-2044 CLI hardening does not by itself remove the non-canonical placeholder at boot — the module's own header says so at `agent-identity.js:42-43`. Commands: `git diff 89301ec7..HEAD -- management-api/lib/agent-identity.js config/nip98-proxy/proxy.mjs`, `grep -n 'did:nostr:local' config/entrypoint-unified.sh`, `grep -n '0-9a-f]{64}' config/nip98-proxy/proxy.mjs`.

## Closeout extension — 2026-09-04

**Work package:** CP-01 / CP-04. **Owner:** existing owner above. **Dependencies:** CP-01
revision/feature identity and the downstream consumer contract.

**Current source verification:** The identity helper returns lowercase x-only public identity and persists the private key with mode 0600. A persistence failure can return a valid but restart-unstable identity with `persisted: false`; derivation failure returns null and the entrypoint may retain its placeholder. The helper does not establish a universal cross-repository identity migration.

At `89301ec7c911eab270c00a0cf81596d0d4f15535`, the local proxy suite passes 45 assertions with no skips using
`NODE_PATH=management-api/node_modules node config/nip98-proxy/selftest.mjs`.
The initial default-resolution run skipped three signature cases; both runs
are preserved in the [estate receipts](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/evidence/ingress-selftest-runtime-deps.json).
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

## Re-verification — 2026-09-21 (`b680a7aeef604276af73e00e1eb5156f379530ae`)

Only `config/nip98-proxy/proxy.mjs` moved (`de37998a8`, `cae729aa7`); `management-api/lib/agent-identity.js` is untouched since the previous anchor. The hex-only acceptance is intact at `HEAD` — `^[0-9a-f]{64}$` guards the boot allowlist (`proxy.mjs:222`), the verifier's returned pubkey (`:244`), each route allowlist entry (`:370`) and the session-token pubkey (`:568`). No bech32 acceptance path was added. Claim STILL TRUE.

## Re-verification — 2026-10-02 (`a48ea407a24185f7a4f654a35e66805778acbec8`)

Tripped by ADR-2078 (pods signer signs as the sovereign identity). `management-api/lib/agent-identity.js` gains `sovereignIdentityPath` and `loadSovereignSigner`, a read-only reader of the bootstrap identity that keys on the 64-hex x-only pubkey, returns `did:nostr:<hex>`, and returns only `pubkey`, `did`, `path` and a `sign` closure, never the secret; `loadOrMint`, `deriveXonly`, `multikeyFromXonly` and the CLI mint are unchanged. That extends the record rather than departing from it: the new reader keeps the canonical-hex identity and the private-key-stays-inside rule. The decision holds unchanged.
Re-verified by `git diff b680a7aee..a48ea407a -- <verified_paths>`; no re-implementation was needed.

## Re-verification — 2026-10-03 (`275e12356319a9630846656580d497d53de3d38c`)

Tripped by custody X-1 step 1, W2 (`custody/w2-env-scrub`: `0965a9c8c`, `042115499`, `275e12356`; bypass 3, ROLE secrets out of PID 1's environment). `management-api/lib/agent-identity.js` now re-exports the ROLE-secret loader and reads the `AGENTBOX_AGENT_PRIVKEY_HEX` override through it (`<NAME>_FILE` first; the bare variable only with the flag off). Derivation, the x-only hex identity and the DID string are unchanged. `config/nip98-proxy/proxy.mjs` changes only how its two secrets are read; pubkeys stay 64-hex x-only. The decision holds.
Re-verified by `git diff a48ea407a..275e12356 -- <verified_paths>`. No re-implementation was needed. The image is unverified until the owner's rebuild.

## Re-verification — 2026-11-20 at `f6a87328266381a2f2f1bf6ddf7050ebd72eda49`

Governed delta: `config/nip98-proxy/proxy.mjs` only (W3-05, ADR-2210); `management-api/lib/agent-identity.js` is unchanged. The hunks add a `NIP98_PROXY_REQUIRE_CONFIG=1` mode in which an absent or unreadable config file makes `pubkeyAllowed` refuse every identity (`proxy.mjs:182-183`, `:260-272`, poll at `:1086-1099`). No hunk touches the `^[0-9a-f]{64}$` checks, so hex-only canonical identity is intact; the new refusal can only deny more, never accept a non-hex identity. `proxy.mjs` is +1 line after `:180`, +15 after `:264` and +30 after `:1085`: the `:250` and `:396` in this record's Verification are as of their own commits, and the `:120` allowlist validation sits above the first hunk and keeps its number. Commands run: `git diff 18315de55..f6a873282 -- management-api/lib/agent-identity.js config/nip98-proxy/proxy.mjs`. Re-run the diff to reproduce.

Re-verified 2026-11-20 at dd78dba42: `git diff 57136dbc0..dd78dba42 -- config/nip98-proxy/proxy.mjs`. One hunk, in the pending-config poll (now `proxy.mjs:1086-1105`): the restart probe parses the file as well as checking it is readable, so a half-written file is still pending. No request path, route or identity check changes, so no claim in this record is affected.

## Re-verification — 2026-11-20 at `0913d5458837d8c4d1fa4b5b3e52b70e7975cb5a` (closeout branch)

Governed delta: `config/nip98-proxy/proxy.mjs` (NIP98-STALE-CONFIG): under `NIP98_PROXY_REQUIRE_CONFIG=1` the config poll now also runs when a file was loaded. The proxy keeps the loaded text (`LOADED_CONFIG_RAW`) and exits 0 for a supervised restart when a readable, parsing file differs from it, never before 3.5 s of uptime (`proxy.mjs:1094-1118`, the comparison at `:1112`). The pending behaviour (refuse every identity until a readable file appears), routing, header stripping and re-injection, the verifier and the allow-list parsing are untouched. The fix is partial, as the ADR-2210 note says: the previous boot's file is still served until Stage B rewrites it. Citations in this record to lines after these points are as of their own commit and are not renumbered. Commands run on this commit: `git diff 6a73c5a73..0913d5458 -- <the paths above>` read in full; `node scripts/adr-index-gen.js docs/adr --check`. The Decision and status axes are unchanged and no claim of this record is falsified.

## Re-verification — 2026-11-23 at `06c2f701130aa94edf24a20f9f86de2131a0bcf4`

Governed delta since `0913d5458`: `config/nip98-proxy/proxy.mjs`. `config/nip98-proxy/proxy.mjs` changes in three ways. (1) The boot-config path is chosen by uid through the new `config/nip98-proxy/config-path.mjs` (`proxy.mjs:254`; uid 1000 keeps the workspace file, any other uid reads only `$AGENTBOX_SECRETS_DIR/nip98-proxy-config.json`, and no permitted path means PENDING, `proxy.mjs:274`, `:1126`). (2) The URL it verifies is the raw query minus the proxy's own credential parameters, with one `forwardedProto()` value (`proxy.mjs:532-541`). (3) An inbound `X-Forwarded-Prefix` is dropped and the proxy re-emits its own, taken from the route's stripped prefix (`:891`, `:914`, `:1039`, `:1051`); an inbound `x-forwarded-proto` is likewise dropped on the WebSocket path and re-emitted once (`:1040`). The strip-and-re-inject of `x-agentbox-pubkey` and `x-agentbox-auth-mode` (`:888`, `:915`, `:1032`), route and allow-list parsing, verifier loading and the identity checks are not touched. Identity canonicalisation (`canonicalPubkey`, 64 lowercase hex) is not in the hunks; the proxy still stamps `x-agentbox-pubkey` from the verified identity (`proxy.mjs:915`).

Judged from `git diff 0913d5458..06c2f7011 -- config/nip98-proxy/proxy.mjs`, read in full against this record's claims; `node scripts/adr-index-gen.js docs/adr --check`. The Decision and status axes are unchanged and no claim of this record is falsified. Citations in this record to lines after the points above are as of their own commit and are not renumbered.
