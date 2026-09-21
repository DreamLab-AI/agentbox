---
id: ADR-2102
title: External assets are bridged in; RGB enters only as a wrapped asset behind an isolated rgb-lib process, re-sequencing ADR-124 for the bridged case alone
date: 2026-09-21
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit:
verified_paths: []
owner: jjohare
review_trigger: USDT-on-RGB confirmed live on mainnet; an RGB consensus release (v0.12 line) adopted by rgb-lib; any proposal to validate RGB contract state in-chain; any proposal to link rgb-lib from a published crate
repo: agentbox
domain: BASELINE-container
---

# ADR-2102 — External assets are bridged in; RGB enters only as a wrapped asset behind an isolated rgb-lib process, re-sequencing ADR-124 for the bridged case alone

## Context

Host ADR-124 and ADR-128 (archive) sequence RGB last, optional and audit-gated as trust level
L3, "a rewrite, not a tightening" that would replace the Contract and State layers with AluVM
and consignments and pull `rgb-core`, which conflicted with the then k256-only posture. Tether
announced USD₮ on RGB (2025-08-28); the UTEXO-led rollout named a launch window of late summer
to mid-September 2026 and was not confirmed live on 2026-09-21. RGB v0.11.1 is on mainnet
(`rgb-lib`, Iris, BitMask, Utexo); v0.12 is a consensus re-design not yet in any Lightning app,
and the ecosystem is split across two organisations. sidestr validates issued assets in
consensus (`assets` rule: `issue:`/`tally:` records), the opposite model to RGB's client-side
validation, and reserves assets-between-chains as a draft. The owner decided assets are bridged
in and USDT gives us USD tokens (PRD-024 D0).

## Decision

1. **External value enters only by peg-in or by bridge.** Sats enter by the spec's peg-in.
   Issued assets (RGB20 including USDT-on-RGB, and later Taproot Assets) enter through
   `sidestr-bridge`, which receives and validates a consignment with `rgb-lib`, holds the
   origin asset in a bridge-controlled UTXO, and claims a **wrapped asset** on our chain under
   a new, versioned **`bridge` consensus rule** named in the chain document (the upstream
   `assets` rule cannot do this: an issued asset's identity is its issuing txid and its supply
   is fixed at issue, so a second deposit cannot mint more of the same asset). The rule defines
   asset identity as the origin contract id under a rule namespace, authorised reissuance for
   repeated deposits, unique reserve allocations, redemption records bound to genesis, txid,
   vout and asset, and replay protection; a validator lacking the rule refuses the chain. The
   wrapped asset is minted as `urn:agentbox:asset:<issuer>:<full origin digest>` (twelve hex
   for display only). Exit burns the wrapped asset first and issues a consignment to a named
   UTXO second, never the reverse, and only after the burn is final under the ADR-2101 rule,
   bound to one asset and recipient, recorded durably before any retry, with reserve
   allocation atomic across bridge instances and origin-chain reorgs reconciled. Wrapped
   supply equals held reserve at every settled height, with pending redemptions carried as
   liabilities; ordinary asset destruction by omission from a tally is distinct from
   redemption, and the coin selector is asset-aware so it never destroys attached assets.
2. **RGB never enters as an in-chain VM.** No AluVM, no consignment-as-State-layer, no RGB
   contract semantics in `sidestr-core`. Host ADR-124's L3 deferral and hard-refusal stand
   unchanged for in-chain RGB; **this record re-sequences ADR-124 P3 and ADR-128 P3 for the
   bridged-asset case only**, which is narrower than it first appears and is argued that way.
3. **`rgb-lib` is confined by a process boundary, not a crate feature.** `sidestr-bridge` is
   `publish = false`, runs as its own supervised program gated `[sidechain.bridge]`, and
   talks to the producer over the same Nostr and HTTP surfaces any client uses. The dependency
   graph of every published crate never contains `rgb-lib`, `rgb-core` or AluVM; if the RGB
   ecosystem split resolves badly, one process is replaced.
4. **The bridge is a custodian and says so**, in the manifest (`custody` label), the chain
   document `comment` and the skill text, the PRD-015 C9 custody-warning precedent.
5. **USDT-on-RGB is bridged only once confirmed live on mainnet and only behind the P21 gate**
   (ADR-2103). The bridge path is proven first with a test RGB20 asset on the configured
   testnet parent. No document claims RGB or client-side validation exempts any cell of the
   ADR-124 §7 regulatory matrix; a fiat-referenced stablecoin adds the FCA stablecoin regime.
6. **Assets never leave through the sats peg.** A burn is of sats only; a wrapped asset leaves
   only by its bridge redemption or a child chain's close.

### Amendments after independent adversarial review (GPT-6 Astra, 2026-09-21)

- **A wrapped USDT claim is a claim on the bridge operator**, which holds an RGB asset under
  Tether's separate issuance and redemption terms. The rights at each layer (segregation,
  encumbrance, freezing, insolvency, recovery) are stated before any USD-denominated claim is
  made to a user; an on-chain reserve figure proves neither ownership nor the absence of
  competing claims, and proof of reserves does not enumerate liabilities.
- **What a node verifies about RGB reserves is decided, not assumed.** Excluding RGB
  semantics from `sidestr-core` makes the bridge's attestation the thing validators check; the
  attestation format, its signer and its audit are part of the `bridge` rule.
- **Replacing one process does not migrate contract history.** The process boundary contains
  software dependencies, not the economic consequence of choosing the wrong RGB line, issuer
  contract or consignment semantics; that choice is recorded and audited.
- **The USDT product claim is conditional with a decision date.** If USDT-on-RGB is not live by
  P4, the bridge is proven with a test RGB20 asset and no token is labelled USDT.
- **Research-stage scope (owner decision 2026-09-21): scaffold and frame only.** The `bridge`
  rule is specified and the `sidestr-bridge` process boundary, manifest gate and `asset` URN
  kind are scaffolded so a USD-denominated unit has a place in the model; no RGB asset is
  bridged, no USD technicalities are decided and no USDT claim is made until the owner
  reopens this record. The parked items are the reserve attestation format, redemption
  identity and the legal rights at each layer.
- **Regulatory obligations attach to the activity, not the parent enum.** Custody, transfer
  and promotion duties can arise before mainnet value (ADR-2103); "at first mainnet value" is
  too late a trigger for counsel.

## Consequences

The estate gets USD-denominated value on its own chain without adopting RGB's validation model
in consensus. The bridge becomes the highest-value single component and the first target of an
independent audit before mainnet. Holding USDT makes the federation a custodian of a
stablecoin, which is a regulatory question for counsel before P4, not a technical one. The
rgb-protocol versus RGB-WG split is contained to one process.

## Verification

Proposed. Ratification evidence: an RGB20 test asset bridged in, transferred between two DIDs
on our chain, and exited to a consignment `rgb-lib` validates; `cargo tree -p sidestr-core
-p sidestr-wallet -p sidestr-nostr | grep -c rgb` is zero; the wrapped-supply-equals-reserve
invariant asserted on every block by `sidestr-node`; `urn:agentbox:asset:…` resolves to the
origin contract id.
