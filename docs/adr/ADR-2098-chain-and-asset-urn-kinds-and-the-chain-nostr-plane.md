---
id: ADR-2098
title: Mint chain and asset URN kinds, register the sidestr Nostr kinds, and carry chain traffic on a dedicated program authenticated by consensus rather than the identity relay allowlist
date: 2026-09-21
decision_status: proposed
implementation_status: partial
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

## Disposition — 2026-10-02

- **Suitability:** fits, needs revision
- **Priority:** P2 — next cycle (planning-cycle §3 reopening; needed by the research-chain demo's wallet API)
- **Why:** D4 is still right: consensus authenticates chain ingress, and chain pubkeys stay off the identity allowlist. Three facts have moved. First, D2's kind list predates upstream kind 23503, "parent transaction to broadcast" (sidestr/spec `fe689e9` SPEC.md:363). Second, ADR-2101's adopted consultant review moves level-2 protocol records off the ephemeral 23510–23514 into stored estate-band kinds. Third, the running deployment is a separate `sidestr-producer`, `sidestr-mirror` and `sidestr-faucet` (`d0fa1b80b`, ADR-2103 interim receipt), not D3's `sidestr-node` on `:9097`. Not built at agentbox `c4ed3ec65`: no `chain`/`asset` kind in `management-api/lib/uris.js`, and no `/v1/wallet/*` or `/v1/chain/*` route. `docs/PROTOCOL-registry.md:152-165` carries the proposed kind rows.
- **Next:** On reopening, add 23503 to the external-kind table and reconcile D3's program shape with the supervised interim programs. Then mint `chain` in `uris.js` with the genesis-pinned form from the amendments.

## Amendment 2026-10-02 (sidestr 0.0.5)

sidestr/spec 0.0.5 (`e8deb63`, SPEC §3, §11, Appendix A) makes the chain document a Nostr event
of kind 3500, regular and immutable, and names its event id the chain's hash: the one value that
names that chain and no other. This amendment follows it and replaces the URN shape in the first
amendment above (`urn:agentbox:chain:<name>:<genesis-sha256-12>`); the rule behind that shape, that
a name is never monetary identity, stands and is now upstream's own.

- **Chain identity is the id of its kind-3500 chain event**, not its name and not its genesis
  hash. `urn:agentbox:chain:` is keyed by that 64-hex id; `sha256-12-<first 12 hex>` is display
  only. `uris.js` `mint` refuses any other local id rather than slugging it, so
  `sidestr:<name>` can never become a chain URN.
- **The alias `sidestr:<name>` and the `genesisHash` live in the resolved record** as
  cross-checks (`uris.chainRecord`, `/v1/chain/info`): an event whose alias, genesisHash or
  author disagrees with the sealed document is an error, never a silently preferred value. The
  event itself is verified with nostr-tools, not by `uris.js`, which stays a name service.
- **A resolver never redirects one id to another.** A hash no record carries resolves to
  nothing, even when an alias matches; `/v1/chain/info?hash=` answers for exactly that hash or
  404s.
- **Chains without a chain event resolve by alias and genesisHash together and are marked
  `legacy`**, with no URN. An alias alone resolves nothing. `sidestr:dreamlab` is such a chain
  today: `/v1/chain/info` returns its alias and genesisHash with `hash: null` until its signer
  publishes the event.
- **38420-38425 carry the chain hash**, never the alias: `<chain id>` in the 38420 `d` tag is
  the 64-hex hash. The implementation is a later sidestr-rs stream.
- **The kind table gains 3500** (regular, external) **and 23503** (parent transaction to
  broadcast, external), **marks 33501 legacy** (pre-0.0.5 chains only; the genesis now travels
  inside the chain event) and records the 33333 tip's `e` tag (the chain event's id, marker
  `chain`). solidpayorg teller's 3700 and 30333 are recorded as external beside them, and
  `scripts/ci/protocol-registry-lint.mjs` gates ownership and collisions.
- **The mirror serves `chain-event.json`.** `config/sidechain/mirror-sync.sh` copies it from
  beside the chain document (where `siding chain-event` writes it and the producer reads it)
  into the Pages checkout when it exists, refuses to replace a published one with a different
  id, and is unaffected when it is absent. The `/chain/` nip98-proxy upstream of D3 is still
  unbuilt; the GitHub Pages mirror the tip names is what serves it.
- **PROTOCOL-registry's "the id is the chain name" rationale is withdrawn**; the registry says
  so in place.

The hash key has a second reason of our own: `URN_RE` in `uris.js` admits at most one colon after
the kind, so an alias local part (`sidestr:<name>`) would parse as scope `sidestr` plus local
`<name>`, and the alias-plus-genesis form would not parse at all.

Not changed by this amendment: no chain event is created or published, the producer pin in
`config/sidechain/upstream-pins` is unchanged, and no deposit address, chain id or published
event moves. The `asset` URN kind is still unminted (D1), and the VisionFlow host's mirror of the
registry table is not updated here.
