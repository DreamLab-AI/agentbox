---
id: ADR-2103
title: The parent network and header profile are manifest configuration exposed by onboarding, bound into the chain document at genesis, with mainnet variants behind an implemented owner-and-legal gate
date: 2026-09-21
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit:
verified_paths: []
owner: jjohare
review_trigger: sidestr/spec PR #4 and sidestr/explorer PR #2 merging or being declined; a new alias in the SPEC 3.2 parent table; any proposal to sign a chain document whose parent is a mainnet variant; a change to the Knots BLAKE2b fork's header format or activation
repo: agentbox
domain: BASELINE-container
---

# ADR-2103 — The parent network and header profile are manifest configuration exposed by onboarding, bound into the chain document at genesis, with mainnet variants behind an implemented owner-and-legal gate

## Context

Every live sidestr chain pegs to `btc:testnet4-blake2b`, the Bitcoin Knots BLAKE2b hard fork's
testnet4 (fork at height 150,308, 2026-08-30), and the sidechain's own headers are
unconditionally Knots v2 BLAKE2b with the unified sighash (`siding/lib/overlay.mjs:50-52`,
duplicated in `explorer.mjs`); the parent side is hash-agnostic (`codec.js:325-327` defaults to
`sha256d`). `sidestr:gitmark` is the estate's own gitmark, moved upstream to the fork. The owner
noted on 2026-09-02 that the anchoring stack keeps using SHA-256d mainnet; on 2026-09-21 first
chose SHA-256d testnet4 as the target parent (PRD-024 D1), then amended that we may follow
upstream to BLAKE2b provided the choice is configurable in the toml and the onboarding system
(D6). The default below follows D6; the first seal's family is PRD-024 open question 9. Host ADR-124 §7 P21 specified an "architecturally enforced"
testnet pin, cash-out disablement and owner-plus-legal build gate as on-seal commitments; none
was built. A sidestr chain document feeds `parent`, `signers`, `challenge` and `comment` into a
`genesisHash` that `open()` refuses to proceed past if it does not reproduce.

## Decision

1. **`[sidechain]` carries the choice.** `parent` is validated against
   `{btc:testnet4-blake2b, btc:mainnet-blake2b, btc:testnet4, btc:mainnet}` and
   `header_profile` against `{knots-blake2b-v2, sha256d}`. The `agentbox-manifest` projector
   validates both at boot and projects them into the served `chain.json`; the TUI manifest
   round-trip, stack provisioning and first-run onboarding expose and explain both, with the
   liveness and finality character of each parent stated (the fork family is low-hashrate and
   stall-prone; SHA-256d testnet4 is the standard testnet; mainnet variants carry real value).
   **As amended by upstream 0.0.2 (subsection below):** `parent` is the SPEC 3.2 alias
   `{tbtc4, btc, txbt4, xbt}` and the header family is derived from it and displayed, not
   chosen. **The estate's first seal (owner decision 2026-09-21): `parent = tbtc4`**, the
   estate's own testnet4 node, which holds testnet4 funds, with stock 80-byte headers. `txbt4`
   remains the parent for consuming the live gitmark chain. The upstream producer had never
   run beside a stock parent; PR #4 makes it able to, and P1 proves it against our node.
2. **Both header profiles are first-class in `sidestr-header`** (a crate `sidestr-core` depends
   on): the 80-byte SHA-256d header with BIP-341 sighash, and the 164-byte Knots v2 header with
   the two-round tagged-hash-plus-BLAKE2b pipeline and the `SIGHASH_UNIFIED` flag byte (wire
   format per `blake2-experiment/SPEC.md` §1.1 and §1.2, whose b2mine codec plan is folded in
   rather than duplicated; test vectors are `getblockheader` on fork block 961,640 and five
   later blocks, one per ASIC profile). Each arm is proven against a live upstream chain. The
   manifest spells the profile `knots-blake2b-v2`; the chain document carries upstream's
   registered name `knots:blake2b-v2`; the one-line mapping lives in the projector and nowhere
   else. The first `headerProfile` proposal (sidestr/spec PR #4, 2026-09-21) surfaced one
   corrected audit claim, that the Knots overlay is not inert for a stock chain because
   `knots:rule-header-v2-from-fork` fires whenever `blake2bHeight` is absent; upstream 0.0.2
   then made the header family follow the parent, so mixed pairings are not expressible and
   the field is gone. The PR is re-scoped to the producer's half (subsection below).
3. **The choice is bound on-seal, and the manifest configures creation, never
   interpretation.** `parent`, `headerProfile`, `currencyPin`, `cashOut`, `pegConfirmations`
   and `refundBlocks` form a `containment` block whose `sha256(JCS)` is committed as a `pin:`
   record in the deterministically built genesis coinbase, so editing any of them yields a
   different chain rather than a re-flagged one. The validator reads parent and header profile
   from the sealed document, never from the TOML; a manifest that disagrees with a sealed
   document is a boot failure, not a silent preference for either side. Changing any of them
   is a new chain with a new genesis, never a configuration edit, rule document or
   redeployment. The apply class for `parent` and `header_profile` is `rebuild` (the header
   family reaches baked kernel constants), never `boot`.
3a. **Peg parameters are family-dependent and the four parents are not equally safe.**
   `btc:mainnet-blake2b` is the most dangerous peg parent of the four: the only option whose
   coins carry value and whose finality can be bought (about 1 to 2 PH/s, ASIC-minable, the
   fork's own guidance treats its coins as zero-value below 100 confirmations plus a second
   explorer's agreement). `pegConfirmations` and `refundBlocks` are therefore set per family
   inside the containment block, and a value-bearing chain on any `*-blake2b` parent requires
   an audit whose scope includes reorg economics. Standard `btc:testnet4`'s retarget stalls
   freeze the refund clock, which onboarding must state. Peg keys are post-fork by
   construction (a new `m/86'` branch) and the producer refuses to operate if any controlled
   UTXO confirmed below the fork height, because replay across the fork pair is asymmetric
   and `SIGHASH_UNIFIED` only protects one direction; every parent-side spend under a
   `*-blake2b` parent sets it anyway. A `*-blake2b` parent node asserts at boot that
   `getblockhash` at the fork height equals the known fork hash (the fork shares mainnet's
   network magic and port, so a wrong-chain parent view looks healthy).
4. **The P21 gate, made real.** A chain document whose `parent` is a mainnet variant, or whose
   `currencyPin` is `btc`, or whose `cashOut` is enabled, cannot be sealed unless a signed kind-
   31403 approval from the owner and legal principals exists and its event id is written into
   the document as `p21Receipt` before genesis, together with a gitmark commit authored by the
   approver's DID as the offline-verifiable record. This is a build and deploy gate: a CI check
   fails the build if a mainnet chain document exists without a resolvable receipt, a second
   check forbids any level-1 chain on a mainnet parent, and the node refuses to open one.
   Onboarding **filters** the mainnet variants out of the offered set until a gate receipt
   exists, rather than warning; the refusal names the gate. The faucet (23501) is compiled out
   for mainnet variants.
5a. **Two parent selections exist in the estate and are not collapsed.** This record governs
   the sidechain peg parent. The block-trail anchoring stack's explorer target (solid-pod-rs
   `JSS_PAY_MEMPOOL_URL`, ADR-2007) is a separate setting; whether the two are aligned is an
   owner decision recorded in PRD-024's open questions, not a side effect of this one.
5. **Cash-out disabled by default.** `cash_out = false` in the manifest and `cashOut` on-seal;
   the bridge (`[sidechain.bridge]`) is disabled by default and cannot be enabled on a
   mainnet chain without the same receipt.

### Amendments after independent adversarial review (GPT-6 Astra, 2026-09-21)

- **The sealing procedure is acyclic and commits the approval.** The containment block as
  first written omitted the receipt it claimed to make immutable, and the security plan's
  version hashed a document that contained a reference to its own approval. The procedure
  is: (1) a canonical policy payload with every security-relevant field (parent, header
  profile, protocol profile version, currency pin naming the exact fork asset, cash-out
  definition, bridge enablement and asset set, exposure limits, peg confirmations, refund
  blocks, signer set and threshold, deployment scope), excluding approval references;
  (2) two separately authenticated approvals, owner and legal, each a signed 31403 over the
  payload digest (one Nostr event has one author; a Git author field is not an approval);
  (3) an envelope containing the payload and both complete signed approvals; (4) the genesis
  `pin:` commitment over the envelope; (5) an archival record with the authorised-principal
  snapshot, because relay ids alone are not retrievable evidence. Every committed field has a
  mutation test, not only the receipt id. An old approval unlocks nothing: approval binds the
  exact policy, scope, asset set and limits.
- **The gate triggers on economic exposure, not on the parent enum.** A testnet-parented chain
  whose coins are redeemable against our services carries value; a child inherits the
  restrictions of its ancestors and assets; any bridged asset or service-redeemable claim
  requires the gate. "Testnet parent" is never the proxy for "no value".
- **Cash-out is defined and enforced by the validator.** It covers ordinary peg-outs, bridge
  redemption, automated close payouts, deposit refunds, reserve migration, AMM withdrawal and
  export of a transferable claim; a prohibited burn is rejected by consensus, because wallet
  refusal and onboarding filtering are presentation controls.
- **Local fields change validity, so they are a protocol profile.** `headerProfile`,
  containment, close policy and the `bridge` rule are not metadata a conformant validator
  ignores; they are a named, versioned protocol profile with mandatory feature negotiation.
  The record states which upstream chains remain compatible (unmodified profile) and which
  local chains require the local validator.
- **Two header profiles are two consensus implementations.** Header length and hash do not
  define a chain: sighash, script rules, activation, timestamps, coinbase maturity, block
  limits and the BIP-325 signing preimage differ, and rust-bitcoin is not a consensus engine.
  The BLAKE2b arm has a live oracle (`sidestr:gitmark`); the SHA-256d arm has only locally
  minted chains until upstream accepts `headerProfile`, and the two are not claimed equally
  proven. Eight parent-and-profile combinations are reduced to justified equivalence classes.
- **Fork replay is not closed by a height check.** A pre-fork UTXO spent with a standard
  sighash to a fresh peg address after the fork lands on both branches with post-fork
  confirmations. Controls: family-specific descriptors and accounts, fork-exclusive funding
  or an explicit coin-splitting procedure, exact sighash checks on every input, tests with
  replayed post-fork descendants, and continuing parent-correctness enforcement (peer
  diversity, reorg handling), not a boot-time tripwire alone.
- **Coinbase maturity and cost are stated.** Claims are coinbase outputs and inherit the
  parent's maturity unless the profile overrides it, so "create, fund, transact" has a
  latency the profile sets; and someone funds peg transactions, checkpoints, consolidation,
  child open and close, mirrors, archives and recovery: the cost model and who pays are part
  of the profile.
- **The legal operating model precedes activation.** Responsible entity, territory, customer
  classes, permitted activities, custody terms and the registrations or permissions obtained
  (UK MLR custodian-wallet and exchange status; Travel Rule; financial promotions; the FCA
  regime commencing 25 October 2027 with applications from 30 September 2026; CARF due
  diligence from 1 January 2026 with first reports by 31 May 2027; sanctions screening) are
  determined by counsel before any activity that triggers them, which may be before mainnet.


### Upstream 0.0.2 (2026-09-21) changes the shape of this record

sidestr spec 0.0.2 (upstream PRs #5 and #6, merged the same day PR #4 was opened) names
parents by short alias in a SPEC 3.2 table (`btc`, `tbtc4`, `xbt`, `txbt4`; the long kernel ids
stay accepted; `ltc` and `vtc` reserved) and makes the header format and proof of work follow
the parent's family: stock headers beside `btc` or `tbtc4`, v2 BLAKE2b headers beside `xbt` or
`txbt4`. Consequences for this record:

- The manifest enum for `parent` becomes the alias set `{tbtc4, btc, txbt4, xbt}`; the projector
  writes the alias into the chain document and maps the long ids on read.
- `header_profile` is no longer a configured field: it is derived from the parent and shown by
  onboarding, never chosen separately. D6's configurability is satisfied by the parent choice.
  The "mixed pairing" (stock parent, BLAKE2b sidechain headers) is not expressible upstream and
  is dropped.
- **The estate's first seal is `parent = tbtc4` with stock 80-byte headers.** The `sha256d` arm
  therefore has the reference implementation as its oracle after all, and `sidestr-header`'s
  BLAKE2b arm is needed only when a chain sits beside `txbt4` or `xbt` (gitmark today).
- Our contribution is re-scoped to the producer's half, which 0.0.2 left untouched: PR #4 now
  carries `buildBlock()` shaping the header by family, `blockHeight()` and a strict
  `coinbaseHeight()` (BIP 34), and a 17-check test; sidestr/explorer PR #2 gates the Knots
  overlay on `resolveParent(chain.parent).family`. **spec PR #4 merged 2026-09-22 as
  `sidestr/spec@53f91f9`**, so the producer's half is upstream and the estate pins
  `sidestr/spec` at or after that commit; the explorer follow-up is still open, so the
  estate pins `jjohare/explorer@header-profile` until it lands.

## Consequences

The estate is not bound to either hash family: the owner's pivot preference is honoured by the
default, and the SHA-256d path stays open by configuration. The Rust codec carries both arms,
roughly doubling the consensus-critical header surface; the BLAKE2b arm is what upstream
runs today, so it is the one with a live test oracle. Following upstream ties checkpoint
finality to a contentious low-hashrate fork; the onboarding text must say so. ADR-124 §7's
containment finally exists, as a property of the chain document rather than a flag.

## Verification

Proposed. Ratification evidence: the projector rejects an out-of-set `parent` or
`header_profile`; `sidestr-core` validates `sidestr:gitmark` (BLAKE2b arm) and a locally
minted `sha256d` chain to their tip hashes; mutating `p21Receipt` after genesis makes `open()`
refuse the chain; the CI check fails on a fixture mainnet chain document with no receipt;
`grep -n faucet` shows the 23501 path compiled out under a mainnet feature.
