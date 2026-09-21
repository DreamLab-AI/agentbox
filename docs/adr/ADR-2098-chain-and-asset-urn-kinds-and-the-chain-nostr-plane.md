---
id: ADR-2098
title: Mint chain and asset URN kinds, register the sidestr Nostr kinds, and carry chain traffic on a dedicated program authenticated by consensus rather than the identity relay allowlist
date: 2026-09-21
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit:
verified_paths: []
owner: jjohare
review_trigger: an upstream change to any sidestr kind number or tag shape; the first signer-set change on the root chain; any proposal to admit chain pubkeys to the identity relay allowlist
repo: agentbox
domain: INGRESS-identity
---

# ADR-2098 — Mint chain and asset URN kinds, register the sidestr Nostr kinds, and carry chain traffic on a dedicated program authenticated by consensus rather than the identity relay allowlist

## Context

`management-api/lib/uris.js` mints 20 URN kinds and none for a chain or an asset (ADR-013
sole-mint discipline). `docs/PROTOCOL-registry.md` records no Nostr kinds at all; the estate's
kind list had to be assembled by grep. The estate relay's ingress is allowlist-only, no
fallback, baked at Nix build time (ADR-2012, `agentbox.toml:151-159`), so a federation whose
signer set changes cannot live behind it. `nostr-pod-bridge` holds the identity key and is the
ADR-2065 sole writer of `pods/<npub>/events/inbox/`. sidestr uses kinds 23500, 23501, 23510 to
23514, 33333, 33500 to 33502; 33502 carries two schemas (peg record and desk pledge) and 33500
and 33501 have no upstream implementing code. agentbox's first kind band 38000 to 38201 is
fully allocated (38000 to 38099 agent intent, 38100 to 38199 agent response, 38200 and 38201
payments), as are 38200 to 38299 and 38300 to 38399; the free agentbox numbers are
38400 to 38499 (ADR-2105).

## Decision

1. **Two new URN kinds, minted only through `uris.js`:** `chain` (`ownerScope: false`, not
   content-addressed, id = the sidestr chain name, resolvable at `/v1/uri/`) and `asset`
   (owner-scoped to the issuer, content-addressed over the origin contract id, the
   `knowledge`-kind precedent for binding a foreign identifier). **Rejected:** `wallet` (a
   `did:nostr` already identifies it), `pegin` and `pegout` (events; `receipt` and `activity`
   already cover them).
2. **Kind registration.** `docs/PROTOCOL-registry.md` (agentbox and the host mirror) gains a
   Nostr-kind table: 23500, 23501, 23510 to 23514, 33333, 33500, 33501, 33502 recorded as
   **externally owned** (pre-0.0.1, provisional); **38420 `sidestr-account-binding`**
   (addressable, `d` = `<chain id>:<did hex>`, content = the derived spend pubkey, signed by the
   identity key) is ours. The 33502 decoder returns `PegRecord | Pledge | Ambiguous` and never
   guesses; 33500 and 33501 codecs are marked as conformant to SPEC prose only.
3. **Chain traffic runs on a dedicated supervised program**, `[program:sidestr-node]`
   (validator and mirror, loopback `:9097`, gated `[sidechain].enabled`) and
   `[program:sidestr-producer]` (gated `[sidechain.signer].enabled`), never inside
   `nostr-pod-bridge`. The mirror reaches the LAN only as a nip98-proxy upstream at `/chain/`
   (ADR-2013 loopback rule). The served `chain.json` carries `pegs` populated.
4. **Chain ingress is authenticated by consensus, not by the relay allowlist.** Block
   signatures verify against `challenge`, transactions against the UTXO they spend, tips
   against the signer key. `sidestr-node` and `sidestr-producer` subscribe to chain relays
   (public plus estate-operated) as their own connections. **ADR-2012 is narrowed, not
   loosened:** its scope statement becomes "identity ingress". Chain pubkeys are never added
   to the identity allowlist. Estate-operated chain relays carry child-chain traffic because
   ephemeral kinds are filterable only by kind at the relay.
5. **The wallet API** `/v1/wallet/{balance,holdings,send,peg-in,peg-out}` and
   `/v1/chain/{info,tip,open,close}` sit behind the existing NIP-98 hook; the authenticated DID
   selects the spend key; a DID mismatch is refused before policy.

### Amendments after independent adversarial review (GPT-6 Astra, 2026-09-21)

- **A name is never monetary identity.** Upstream admits a chain id is a name, not a proof, and
  discovery trusts the signer found in an announcement. The `chain` URN therefore carries the
  genesis hash (`urn:agentbox:chain:<name>:<genesis-sha256-12>` for display, full digest in the
  record), and every account binding (38420), approval, receipt, reserve reference and cache key
  pins genesis and the protocol profile. A resolver never redirects a monetary identity to a
  different genesis. `asset` URNs use the full origin-contract digest authoritatively; twelve
  hex characters are display only.
- **Domain-event kinds.** DDD-022's five events take 38421 to 38425; 38420 is the account
  binding alone. One registry lists all six with addressability and retention semantics.
- **Relay drop is a normal condition.** Transactions, proposals, partial signatures and PSBT
  rounds are persisted locally before publication, with acknowledgements, retries and
  deduplication; estate-operated relays reduce load but do not establish durability.
- **Consensus-authenticated ingress is for independently held keys.** Managed agent funds,
  federation reserve movements and bridge or close payouts are policy-bound at the key-use
  boundary (ADR-2100), whatever transport the transaction arrives by.

## Consequences

`PROTOCOL-registry.md` finally records kinds, which closes the "no living anchor" finding.
Two supervisor programs, one port and one proxy upstream are added to BASELINE-container.
A signer-set change is a rule document, not a rebuild. Whoever writes the mirror must serve
populated `pegs` or no cold validator can replay genesis. Recording upstream kinds as external
is an honest admission that we do not control their evolution.

## Verification

Proposed. Ratification evidence: `uris.js` unit tests for `chain` and `asset` including the
rejection of ad-hoc strings; PROTOCOL-registry rows present in both repos; `supervisorctl
status sidestr-node` on a gated build and byte-identical supervisor text when the gate is off
(ADR-2077); an integration test that a block signed by a key outside `challenge` is rejected
regardless of relay origin.
