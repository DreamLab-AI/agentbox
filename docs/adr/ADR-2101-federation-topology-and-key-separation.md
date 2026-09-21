---
id: ADR-2101
title: One root chain signed k-of-n by the federated instances, ephemeral child chains bound at session create, and domain-separated spend and signer keys that amend ADR-033
date: 2026-09-21
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit:
verified_paths: []
owner: jjohare
review_trigger: the first level-2 block on three hosts; the first child chain closed with pro-rata settlement; any proposal to let the federation include an instance DreamLab does not operate; any change to build_did_document in services/nostr-pod-bridge/src/contract.rs
repo: agentbox
domain: INGRESS-identity
---

# ADR-2101 — One root chain signed k-of-n by the federated instances, ephemeral child chains bound at session create, and domain-separated spend and signer keys that amend ADR-033

## Context

sidestr reuses one raw private key as Nostr identity, taproot spending key, block-sealing key
and (on EVM chains) Ethereum account, with no domain separation, and derives the level-2 peg
descriptor from the same k-of-n challenge that authorises block production, so one compromise
yields both (R1 §7.4, §4.3). ADR-033 (archive) fixes the DID document as a single Multikey
whose I1 is "no identity migration". The estate already owns HMAC-SHA256 domain-separated
child derivation with a JS-parity vector (nostr-bbs-core `keys.rs:251-265`). AoE session
create already binds a `did:nostr`, URN, beads epic and memory namespace at
`management-api/routes/sessions-boundary.js:212-296` (ADR-043). sidestr's ephemeral-chain note
frames chains for one job by agents; nested chains are supported by the spec and exercised
nowhere. The owner chose one root chain with instances as signers and ephemeral children
(PRD-024 D2).

## Decision

1. **Topology, staged.** One root chain `sidestr:dreamlab`, bech32m prefix `drm`.
   **Research stage (now, owner decision 2026-09-21): level 1, one signer** on the agentbox host,
   optionally `multi_a(1, pk1, pk2)` as a hot standby (either key seals; this buys liveness, not
   safety, and is said so in the chain document). Coins are testnet4 and carry no value.
   **Federation stage (stretch, needs machines we do not have yet): level 2, k-of-n** with one
   signer key per federated instance, threshold from a stated fault model (see the amendments
   below): `2k − n > f` for f Byzantine signers, so 4-of-5 for f = 1 before any chain carries
   value. This stage is the natural first workload of the federation project (repository not yet
   populated; external interest exists), and in the long term the signers may be agents rather
   than instances, which the key-separation rules below already allow. Availability tolerance
   is n minus k and this estate rebuilds containers routinely, so n is sized for rebuilds as
   well as for f. Signers run on distinct hosts with
   NTP; wall-clock round entitlement is a documented assumption. Descriptor and share backups
   are rehearsed off-host, because already-claimed coins on a dead chain have no refund path. Signer-set changes are rule documents (33500) with
   an activation height and a peg-out of the peg outputs to the new descriptor.
2. **Ephemeral child chains.** A session's chain `sidestr:dl-s-<sha12>` is level 1, parent =
   the root (never the parent chain directly), signer = the session's own derived key, with a
   mandatory `close`. It is opened at `sessions-boundary.js` phase=create as a fifth binding,
   funded by a policy-capped peg-in from the root (a settlement under ADR-2100), and recorded
   as `chain_urn`; phase=close closes it, the closing coinbase pays every holder pro rata, and
   the closing hash is checkpointed as the tombstone. A child cannot outlive its session; an
   orphaned open child holding value is an alertable condition. The session-create binding
   fails open like its siblings (the session starts and cannot spend); the money fails closed.
3. **Three keys, domain separated by one-way derivation, never by an additive tweak.**
   Identity `k_id` (the sovereign key, `identity.rs:130-158`) never spends and never signs
   blocks. A principal's `k_spend(chain) = derive_subkey(k_owner, "sidestr/v1/spend/" ‖
   genesis ‖ epoch)` uses the estate's keyed HMAC-SHA256 derivation (nostr-bbs-core
   `keys.rs:251-265`), which is one-way: a leaked role key reveals neither its root nor a
   sibling. The federation signer key `k_sign(chain)` and the bridge custody key are **not**
   derived from `k_id`: they come from independent seeds held only by their service accounts
   (see the amendments below), because `k_id` is reachable by every supervised program. An additive tagged-hash tweak (`k_role = k_id +
   H(tag)`) is prohibited because the tweak is publicly computable and one leaked role key
   would recover the identity key. The parent peg wallet and the bridge custody key use
   hardened BIP-32 under rust-bitcoin descriptors (`m/86'/<coin_type>'/…` for the peg,
   dedicated hardened accounts for signer and bridge roles) so recovery works with standard
   tooling and `coin_type` 0' versus 1' is itself a mainnet containment boundary CI can
   assert. Per-chain derivation means a leaked child-chain spend key cannot touch root coins
   and a compromised session cannot seal root blocks. The peg descriptor never contains an
   identity key. `k_sign` never enters `identity.env` (that file is sourced into every
   supervised program, `bootstrap.rs:190-233`); it lives under `/run/secrets` for the producer
   only, backed by `services/secret-backup`. The nsec never enters the settlement domain;
   signing happens behind the identity port. Balance is an authenticated lookup for the
   principal, with per-purpose receive addresses, so a DID does not publicly enumerate its
   whole balance forever.
4. **The address binding is explicit.** Domain separation costs the property that the DID is
   the address; it is bought back with kind 38110 `sidestr-account-binding` (ADR-2098) signed
   by `k_id`, and a second Multikey entry in the DID document for the per-chain spend key.
   **This amends ADR-033** D2'/D3' (the single-Multikey form emitted by `build_did_document`,
   `contract.rs:60-84`) and leaves ADR-033 I1 intact: the DID string and the hex-canonical
   identity (ADR-2011) do not change.
5. **Child HRPs are derived**, `"s" ‖ hex(tagged_hash("sidestr/hrp", chain_id))[0..4]`, with a
   counter suffix recorded in the chain document on collision among a parent's live children.

### Amendments after independent adversarial review (GPT-6 Astra, 2026-09-21)

- **A threshold signature is not a consensus protocol.** `n − k` is availability tolerance,
  not Byzantine tolerance. Two k-quorums intersect in only `2k − n` signers, so 3-of-5 lets a
  single malicious signer certify two blocks at one height with honest co-signers each signing
  once. Thresholds are chosen from a stated fault model: `2k − n > f` for f Byzantine signers
  (4-of-5 for f = 1; 2-of-3 is research-only). Upstream's rule that a signer may re-sign a
  height after a timeout is rejected: a signer never signs two proposals at one height,
  liveness on proposer death comes from a view change, and votes are journalled durably before
  publication. No external release (bridge redemption, peg-out payment, merchant finality,
  anchor) happens before the finality rule the protocol profile defines. The conflicting-
  certificate attack is a mandatory test.
- **Custody roots are independent of the identity root.** `k_id` lives in `identity.env`,
  which every supervised program sources, so anything derived from it is reachable by a
  compromised agent process. The federation signer root and the bridge custody root are
  therefore independent seeds held only by their service accounts under `/run/secrets`; they
  are never derived from `k_id`. A session's `k_spend` derives from the session's own key.
  Derivation namespaces include protocol version, genesis (or a pre-genesis commitment), role
  and epoch, so reusing a chain name for a new genesis never reuses keys. One normative
  construction per role: HMAC domain separation for principal spend keys, hardened BIP-32 with
  full descriptor recovery data (tree, key order, indexes, epochs) for custody roles. The
  identity port authenticates callers and permits named derivations and operations only; a
  generic "sign this payload" port is a bypass. A BIP-32 coin type is recovery labelling, not
  network containment; the signer verifies network, descriptor and chain policy itself.
- **Children are validated with the root view.** A level-1 child validated only by its own
  signer lets the session fabricate claims and pay a merchant invented coins. Every child
  claim is verified against the root UTXO set by every validator, which every participant
  already holds; a child's block, deposit and reserve descriptors are distinct.
- **Close is a consensus transition with an external supervisor.** Upstream's closing
  coinbase conflicts with the coinbase, burn and asset rules; the close is specified as its
  own transition (UTXO retirement, per-asset entitlements, an authenticated root destination
  per holder, fees, dust, rounding, a maximum holder count, finality). A settlement
  supervisor outside the session process holds the authority and durable state to close a
  child whose session died; "session closed", "child closed", "parent payout confirmed" and
  "tombstone published" are four different facts. Nesting depth is bounded, heartbeat and
  expiry margins are stated, and a stalled root is a declared degraded mode with suspension
  rules, not merely a measured compounding.
- **Rebuilds and loss are protocol events.** A signer host restore uses durable vote and
  payout journals with anti-rollback and instance fencing; a lost threshold has a pre-agreed
  recovery and wind-down procedure with its trust cost stated. Deferring "level 3" does not
  defer the operational need.
- **Hosting redundancy is not custody independence.** Five DreamLab hosts are one operator;
  the fault model and the legal model both say so.

## Consequences

Every federated instance becomes a co-custodian of the root chain's value; if the federation
ever includes an instance DreamLab does not operate, a per-instance root nested under the
DreamLab root is the alternative and this record must be reopened (PRD-024 open question 2).
A child chain is the agent budget, enforced by consensus rather than by an AoE feature. Refund
timelocks compound down the nesting: a stalled root freezes every child's refund clock, so the
root producer carries an explicit liveness requirement and the compounding is measured. The
DID document shape changes for principals with a spend key; consumers that assumed exactly one
verification method must be checked.

## Verification

Proposed. Ratification evidence: three signer keys on three hosts seal a block with the
proposer down; a session opens, spends within, closes and settles pro rata onto the root with
a checkpointed tombstone; an adversarial test that a session cannot spend beyond its peg-in;
a known-answer test that `k_spend` and `k_sign` differ from `k_id` and from each other for the
same chain; `build_did_document` emits two verification methods for a bound principal and the
DID string is unchanged.
