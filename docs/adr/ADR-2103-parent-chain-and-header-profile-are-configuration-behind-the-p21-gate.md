---
id: ADR-2103
title: The parent network and header profile are manifest configuration exposed by onboarding, bound into the chain document at genesis, with mainnet variants behind an implemented owner-and-legal gate
date: 2026-09-21
decision_status: proposed
implementation_status: partial
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: e434a7a596a3a0518c51b7da107d6e0831891910
verified_paths: [config/sidechain/dreamlab/chain.json, config/sidechain/dreamlab-txbt4/chain.json, config/sidechain/README.md, config/sidechain/run-producer.sh, tests/config/sidechain-genesis.test.sh, tests/config/sidechain-producer-gates.test.sh, management-api/lib/sidechain-health.js, scripts/activation/sidechain-demo-witness.sh, scripts/activation/sidechain-witness.cjs, scripts/activation/sidechain-witness-replay/src/main.rs]
owner: jjohare
review_trigger: sidestr/spec PR #4 and sidestr/explorer PR #2 merging or being declined; a new alias in the SPEC 3.2 parent table; any proposal to sign a chain document whose parent is a mainnet variant; a change to the Knots BLAKE2b fork's header format or activation; a BLAKE2b testnet4 node reachable from the container; upstream implementing assets between chains (assets-and-pools section 4)
repo: agentbox
domain: BASELINE-container
---

# ADR-2103 — The parent network and header profile are manifest configuration exposed by onboarding, bound into the chain document at genesis, with mainnet variants behind an implemented owner-and-legal gate

## Context

## Re-verification — 2026-09-30 (interim sidechain supervision)

Reviewed the interim supervision amendment and unchanged sealed tbtc4 document. Genesis checks inside the running container pass 3/3 including the stored block-zero hash. Mirror retry/isolation and catalogue parent-gate tests pass 2/2; sidestr-agent and runtime Nix builds pass. The broader proposed decision remains partial.
Source anchor: `d0fa1b80b`. Existing status axes and deferred work are unchanged;
this scoped source/test receipt does not assert a new running-image activation.

### Original context

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

### The first seal (2026-09-22) and what it corrected

`sidestr:dreamlab` was sealed beside `tbtc4` by the merged upstream engine: genesis
`4db37517728bd509c0cb96ee5a2e3e2a77f9e965a092e9f67948b413d453dbc0`, signer
`7092810a05359b29acfa1f884d0e1a8e0290309e1133198b0f059447a4c76d62`, prefix `drm`, level 1,
depth 0, no pegs. Block 0 is 320 bytes with an 80-byte stock header, version `0x20000000`
(bit 31 clear), `bits` at `powLimit`, `prev` zero, header time equal to `genesisTime`; the
engine replays it cold and an engine-free check hashes the header to the document
(`tests/config/sidechain-genesis.test.sh`). The document is `config/sidechain/dreamlab/chain.json`;
the signer key is in the `agentbox-secrets` volume at mode 0400, never in `identity.env` and
not derived from the identity key (ADR-2101 D3); the block file is under `$WORKSPACE/sidestr/`.
Meeting the real engine corrected three claims in this record:

- **The Context overstated what the genesis commits to.** Upstream's genesis
  (`siding/lib/chain.mjs` `buildGenesis`) commits the chain id (as the coinbase marker), the
  pegs, `genesisTime` and the signer's witness. It does not commit `parent`, `comment`,
  `signers` or any containment field, so D3's "bound on-seal" is not yet true of any field
  but those four. The document carries `depth`, `containment` and `containmentDigest`
  (SHA-256 over the JCS form) as the estate's fields; the coinbase `pin:` record that would
  commit the digest is unbuilt, and until it is, the binding of parent and containment is
  the committed document plus its `genesisHash`. Building the pin is a change to genesis
  construction and therefore an upstream proposal (a second marker push in the coinbase),
  not a local overlay.
- **D1's manifest block is not yet expressible.** `schema/agentbox.toml.schema.json` sets
  `additionalProperties: false` at the top level and has no `sidechain` entry, so the
  `[sidechain]` block cannot be added to `agentbox.toml` without the schema change; the
  projector's validation of `parent` (D1) and the boot-time document-versus-manifest check
  (D3) are therefore unimplemented and the sealed document is the only source of the parent.
- **D2's `sidestr-header` crate did not exist at the seal.** None of `sidestr-header`,
  `sidestr-core`, `sidestr-nostr` or `sidestr-wallet` was on crates.io that morning, so the
  independent check on the genesis was the raw header hash. **Closed the same day:** all four
  were published at 0.1.0 (ADR-2106; `crates/sidestr/`), and `sidestr-core` replays this
  genesis to its hash, reproduces a throwaway genesis byte for byte from its key, and
  cross-validates block 1 with the reference in both directions; `sidestr-header` hashes
  block 0 and the live txbt4 and xbt fork headers.

Implementation is therefore **partial**: the seal exists and is verifiable; D1, D3's pin and
boot check, D4's CI receipt check (the test enforces only "mainnet alias needs
`p21Receipt`") and the faucet compile-out are not built. Nothing was announced to a relay
and no producer runs.

### Interim supervision approved 2026-09-30

The owner approved committing and deploying the existing testnet producer, public Pages
mirror and DREAM/testnet-sat faucet under supervisord. `[sidechain].enabled` gates the
producer; `mirror` and `faucet` are subordinate rebuild-class gates, off in setup defaults.
All run as devuser. The producer still verifies the upstream JS checkout pins; the faucet
uses a standalone AGPL `sidestr-agent` binary built from a pinned Git revision and lockfile,
not a workspace-built executable or a dependency of a permissive crate. Existing signer,
parent cookie, treasury key and grant ledger remain in persistent storage.

This supersedes the first-seal snapshot's statement that no producer runs, not the proposed
parent-selection, containment, native-node or bridge design. The sealed `tbtc4` document
and genesis are unchanged. No mainnet, real-value redemption or new chain is authorized.
The mirror retries outstanding pushes without requiring another block and commits only
the three public chain files; unrelated staged files remain untouched.

Verification: Nix runtime build (including sidestr-agent package tests), the live on-disk
genesis test (3/3), and `tests/config/sidechain-mirror.test.cjs` (failed-push retry and staged
file isolation). Runtime activation is checked after deployment, not inferred from a build.

### The next chain sits beside `txbt4` (proposed 2026-09-30)

The owner asked for a BLAKE testnet token in members' wallets. Upstream points one way: all seven
chain documents in sidestr/spec 0.0.6 (`chains/`) sit beside `txbt4`, `siding new` offers it as the
default parent, the desk (`proposals/desk.md`) only works on a BLAKE2b parent, and sidestr/wallet
takes the chain as a parameter (`?chain=<id>`). `sidestr:dreamlab` is the only chain in the family on
`tbtc4`. This amendment is proposed and nothing in it is built.

- **`sidestr:dreamlab` stays where it is.** Its parent is sealed; moving it is a new genesis, and
  DREAM, 594 blocks and every member balance would have to move with it. Assets between sidestr chains
  are reserved upstream for level 2 (`proposals/assets-and-pools.md` section 4) and this chain is
  level 1, so DREAM stays on `sidestr:dreamlab` until upstream builds that section.
- **The estate's next chain is sealed beside `txbt4`**, through D1's manifest path. It would be the
  first chain whose parent comes from `[sidechain]` rather than from the committed document alone, so
  D1's projector validation and D3's boot check are prerequisites, not follow-ups.
- **It needs a BLAKE2b testnet4 node the estate does not have.** The Dell VM node on
  `192.168.2.27:48332` is Bitcoin Core 30.3.0 on stock testnet4: `getblockhash 150308` returns
  `0000000000cf9d15…`, not the fork hash `000000000000b9d1…`, so it follows the SHA-256d branch
  (checked 2026-09-30, height 154,530, `txindex` synced, 13.6 GB). The node wanted is a second
  instance on that VM: Bitcoin Knots 29.4.1 or later (the unified-sighash release) on the BLAKE2b
  testnet4 fork, its own data directory, RPC port and rpcauth user, and a cookie file in the secrets
  volume beside `sidestr-tbtc4.cookie`. D3a still applies: post-fork peg keys, and a boot assertion of
  the fork hash at height 150,308. Its disk is roughly the stock node's again (the chains share
  everything below the fork but not a data directory). The VM is root-only, so the operator installs
  it; nothing in this container can.
- **The same node serves the forum's read-only view.** electrs (jasonsopko, `blake2b` branch) and the
  blaketest shim over this node are one of the two backends nostr-rust-forum ADR-2019 accepts; the
  other, preferred, is blaketestnode's own address index (`run --address-index`, proposed as
  bitcoin-blake/blaketestnode PR #1), whose `--pair-api` also reports each address on the stock
  branch, so one member key is read on both testnet4 chains. Nothing BLAKE is deployed.
- **Supervision generalises only when the second chain exists.** Today's interim `[sidechain]` block
  names one producer, one mirror and one faucet. A second chain turns it into a list of chains, each
  with its own port, mirror checkout, signer key and gates. That is a schema change and rebuild class,
  so it lands with the seal, not before it.

### The `txbt4` seal (2026-10-02)

Owner decisions SC1, SC2 and SC5 (2026-10-02) make the 2026-09-30 proposal real. The demo's
parent is `txbt4`, its payments are transactions on a `txbt4`-anchored sidechain, and
checkpoints stay off for cost. `sidestr:dreamlab` stays on `tbtc4`, unchanged.

- **Sealed** by the pinned engine (`siding new`, spec `fa86dac`), committed at `f7465412d`
  as `config/sidechain/dreamlab-txbt4/chain.json`:
  - genesis `1009aa2984d5c699fe61ef1e5905afe472a49d67551542045726828c8b82d108`;
  - signer `5e05b5bae0b9eff8dfd893444817558f67a6acfc8d47b0b65022d5c7c6665f2f`, key in the
    secrets volume at 0400;
  - prefix `drt`, level 1, depth 0, `pegs: []`.

  Block 0 is 418 bytes with Knots' 164-byte v2 header (version `0xa0000000`, committed
  height 0), and its hash is Knots' BLAKE2b construction. `containment` adds
  `headerProfile: knots:blake2b-v2` and keeps `cashOut: false`. As for the first seal, the
  `pin:` record is unbuilt, so containment is bound by the committed document alone.
- **Header family (D2).** No code was needed. The pinned engine already builds v2 headers
  and signs with the unified sighash beside a BLAKE2b parent; all seven upstream chain
  documents sit beside `txbt4`. `sidestr-core` carries the BLAKE2b arm (`Family::Blake2b`);
  the 0.2 audit replayed `sidestr:txbt4-siding` with it
  (`docs/proposals/sovereign-settlement-research/AUDIT-sidestr-core-0.2-gpt6-astra.md:330`). The engine-free check is
  `tests/config/knots_header_v2.py`. It reproduces Knots' own hashes of two live `txbt4`
  headers (`getblockheader … false`), then hashes block 0 to `genesisHash`.
- **Parent view.** This record's review trigger has fired. On 2 October the container reached
  the node and read tip 152,225, and block 150,308 was the fork hash. The Dell's Knots 29.4.2
  (`knots-txbt4`, `192.168.2.27:48342`) had been opened to the LAN earlier that day: user `txbt4read`, a method whitelist, `rpcwhitelistdefault=0` and
  nftables. That user already serves everything the producer calls without a wallet:
  `getblockcount`, `getblockhash`, `getblock` (verbosity 2, needs `txindex`, which is on) and
  `gettxout`. It refuses `decoderawtransaction` (HTTP 403, checked from the container), so
  parent transactions relayed over kind 23503 are refused rather than judged.
  `scripts/sidechain/dell-txbt4-open-rpc.sh` gives the producer a user of its own with that
  one call added; owner-run, not yet run.

  rbitcoin's Esplora on `:3002` is not a parent view for the engine, because siding's
  `makeParent` speaks JSON-RPC only. It stays the forum wallet's read path.
- **D3a, built.** `run-producer.sh` refuses to start beside a BLAKE2b parent unless the
  node's block 150,308 is the fork hash. A stock-branch node, or an unreachable one, is a
  boot failure; `tests/config/sidechain-producer-gates.test.sh` covers both. No peg key
  predates the fork, and the scan starts at 152,225, the tip at the seal.
- **D3, built in part.** `[sidechain.dreamlab-txbt4].parent` must equal the sealed
  document's `parent`, or the runner refuses to start. The schema admits only `txbt4` there,
  so no mainnet alias can be named. The projector check of D1 is still unbuilt, and the
  document stays the only source of the parent.
- **Supervision generalised**, as this record said it would be when a second chain existed:
  - every `[sidechain.<name>]` table bakes `sidestr-producer-<name>`, `sidestr-mirror-<name>`
    and `sidestr-faucet-<name>`;
  - `[sidechain].enabled` dominates every table, and a table's `enabled` dominates its own
    mirror and faucet (catalogue `requires`);
  - the table ships `enabled = false`.

  The mirror is a Pages repository of its own (`DreamLab-AI/sidestr-dreamlab-txbt4`, not yet
  created), because `mirror-sync.sh` never pulls and two writers on one repository would
  wedge each other.
- **Liquidity: none.** The chain mints nothing: no subsidy, `pegs: []` (SPEC 2). Coins arrive
  only by peg-in from `txbt4`, and the estate holds no post-fork `txbt4` coins. A Knots
  29.4.2 mempool also refuses to relay a mined reward younger than 6,705 blocks, so mining
  for coins is slow. A claimed peg-in is a coinbase output and waits 100 sidechain blocks.
  `scripts/sidechain/preflight-liquidity.sh` asserts the treasury and two demo agents hold
  mature sats, and it prints the anchoring state before any balance.

### Open — checkpoints into `txbt4` (owner SC5, cost), recorded 2026-10-02

**`sidestr:dreamlab-txbt4` is not anchored.** No checkpoint is written into `txbt4`, so every
block is the single signer's word, and a signer could rewrite history without the parent
noticing. The owner chose this for cost and asked that it be left visibly open and raised
again. Until it closes, the chain document, the README, the producer's log line and the
pre-flight all say so, and no demo may imply anchoring.

To switch checkpoints on, all of the following are needed. The owner does the first three
on the Dell and the agentbox side; nothing here does them.

1. A Knots wallet on `knots-txbt4` used only for fees, never the peg. For example,
   `createwallet sidestr-txbt4-fees`, run on the Dell with the node's cookie.
2. That wallet funded with post-fork `txbt4` coins that Knots will relay, meaning no mined
   reward younger than 6,705 blocks. Each checkpoint is one OP_RETURN transaction.
3. The producer's RPC user allowed to call the wallet:
   `dell-txbt4-open-rpc.sh apply --rpcauth '<the minted verifier>' --with-checkpoint-wallet`.
   This adds `send`, `gettransaction` and `listtransactions` to that user's whitelist.
   Then point `parent_credential_file` at `sidestr-txbt4.rpc`.
4. The switch itself, in `[sidechain.dreamlab-txbt4]`:
   `checkpoint_every = N` and `checkpoint_wallet = "sidestr-txbt4-fees"`, then a rebuild.
   The runner passes `--checkpoint-every N --checkpoint-wallet sidestr-txbt4-fees`. It
   refuses N > 0 with no wallet, because the engine would otherwise skip every checkpoint
   silently.

Every checkpoint then lands in `<state>/checkpoints.json`, and the pre-flight reports the
last one.

**Reminder on the governance panel.** After merge, queue it once:
`node scripts/dream-inbox.mjs remind agentbox "sidestr:dreamlab-txbt4 is NOT anchored: checkpoints into txbt4 are off by owner decision SC5 (cost); approve to plan switching them on (checkpoint_every + a funded checkpoint_wallet, ADR-2103 Open) or reject to keep them off."`
The engine publishes it as a kind-31402 case at the end of the next night. It is queued once
ever, because the item id is the engine's own hash of the text; an answer or a dismissal
therefore stays put.

## Consequences

### Interim deployment receipt — 2026-09-30

- Source: `0a407fc61`; image: `sha256:4bdd3d7b9f8166ec9f7fc8868bfc2e06eb1cd35db829ae7b19bf27108ece5ca3`.
- `sidestr-producer`, `sidestr-mirror` and `sidestr-faucet` are supervised and running as
  devuser. The producer serves tip 593 on loopback and announced it to 5/5 relays; the
  faucet subscribed to kind 23501 on all five relays using the baked 0.3.2 binary.
- The existing mirror checkout is clean and its authenticated push dry-run succeeds.
  Failed-push retry is covered by the isolated regression fixture. No synthetic live
  payout was requested, and this receipt does not claim a newly produced block.
- Genesis verification inside the rebuilt container passes 3/3, including stored block
  zero. Readiness is true; all five durable-state adapters are healthy with zero degraded
  components. RuVector write/search/rollback smoke checks and voice health pass.
- All 17 persistent volume identities match resolved Compose. Instruction projection,
  complete Codex tiers, credential parity/mode and unchanged host instructions pass;
  baked/deployed Compose matches. Direct AoE and proxy tokenless requests both return 401.
- The canonical rebuild produced and imported the image; its redundant speech-build
  phase was stopped and startup completed with the existing healthy speech images
  (`--no-build`) and the normal base plus override Compose files. Recovery image retained
  as `agentbox:recovery-20260930`. Email and the connected node were not changed.

The broader proposed settlement decision remains partial; this receipt activates only
the explicitly approved interim testnet services.

### Interim receipt amendment — 2026-10-02: tip-age health and the demo witness

Two instruments, so that the supervised chain cannot look healthier or more settled than it is.
Neither one changes consensus, the chain document or the supervisor blocks.

**Tip-age health.** Before this amendment the producer's only health signal was supervisor
`RUNNING`. The producer has been `RUNNING` while making nothing twice: it retried an invalid
transaction in a loop on 23 September, and it sat stopped for four days from 25 September.
`management-api/lib/sidechain-health.js` now reads the producer's status route (`GET /`).
It reports the module unhealthy in any of these cases:

- the route is unreachable, times out (2 s) or answers non-2xx;
- the tip is older than 2 × the idle interval (600 s, so 1,200 s), whatever the mempool holds;
- transactions have waited longer than 2 × the transaction interval (10 s, so 20 s) with no
  new block. This clock starts at the later of the tip time and the first reading that saw a
  non-empty mempool, so a transaction that has only just arrived is not a false alarm.

The interval comes from the producer's own status, so a 2-second loopback chain is judged
at 4 s. Each enabled chain gets its own probe: `sidestr:dreamlab` on :3450, and every enabled
`[sidechain.<name>]` table on its own `port` and `interval`. For example,
`sidestr:dreamlab-txbt4` on :3451 is probed once it is switched on. `GET /v1/system` carries
each record as its catalogue module's `health` (`sidechain`, `sidechain-dreamlab-txbt4`),
plus a top-level `health {ok, probed, unhealthy}`. `GET /ready` lists a stale chain under `degraded`
and stays 200: a stalled sidechain is reported and never blocks the box. `health.anchored`
is true only when the producer reports a checkpoint. Evidence: the 20 cases in
`tests/sovereign/sidechain-health.node-test.js`. Among them, a loopback siding at 2 s blocks
turns red about one second after `kill -STOP`, and goes green again after `SIGCONT`.

**The demo witness.** `scripts/activation/sidechain-demo-witness.sh` takes a chain id, two
agent pubkeys and a payment txid, and optionally a Hitch session. It writes
`.claude/evidence/sidechain/<UTC>.json` and exits 1 unless every required check passes.
The receipt is `format: 1` and has these parts:

- `sidechain`: the payment, its funding and, with a Hitch session, the close. Each carries
  its height, block hash, position, the outpoints it spends, and its later spenders.
- `anchoring`: either a covering parent checkpoint whose hash matches the replay, or
  `"anchored": false` with the owner's reason verbatim: "checkpoints off, cost; open"
  (owner decision 2026-10-02, SC5). The producer's own `every: 0` is cited as evidence.
- `nostr`: the signer's kind-33333 tip announcement, plus the kind-23500 and kind-23600
  events from each agent key. They are embedded whole, and each id and signature is verified.
- `journal`: the ADR-2071 started/completed pairs under the session URN.
- `replay`: crates.io `sidestr-core` `=0.4.0` replays the Pages mirror's `blocks.dat` from
  the genesis to a tip hash. The header family follows the document's parent: stock beside
  `tbtc4`, and `sidestr-header` `=0.3.1`'s BLAKE2b v2 beside `txbt4`. The receipt records the file's SHA-256 and cross-checks the
  height with the baked `sidestr-agent`.
- `checks`, plus `claims {proves, does_not_prove}`. An unanchored receipt's first disclaimer
  says it is not anchored.

The replay helper (`scripts/activation/sidechain-witness-replay`) is a standalone, unpublished
binary. It takes `sidestr-core` and `sidestr-header` by exact crates.io version, never by path or
git (ADR-2112),
so a stranger with cargo and the mirror reaches the same hash. The witness is read-only:
it signs nothing, broadcasts nothing and reads no key.

Two findings shaped the format:

- Kinds 23500 and 23600 are NIP-01 ephemeral (20000–29999). Relays forward them and do not
  store them, so a query made after the demo finds none. The demo's events must therefore be
  captured while the session runs and passed as `--nostr-capture`. The Hitch host (stream S2)
  owns writing that capture.
- The read-only trial on 2026-10-02 used the 23 September payment `fbb7bf26…`. It replayed
  the mirror to tip 943, `1fe4e931…`. That hash matches the mirror index, and the baked
  `sidestr-agent` 0.3.2 reached the same height. The trial located the payment at height 240
  and its funding at 131, and stated non-anchoring. It failed N2/N3 (no stored agent events)
  and J1 (no journal session) as designed. The BLAKE2b family replays the sealed
  `sidestr:dreamlab-txbt4` genesis to its document's `genesisHash` (`1009aa29…`).
  Evidence: the 25 cases in `tests/sovereign/sidechain-witness.node-test.js`.
  - The end-to-end case runs against a loopback chain, an in-process relay and a fixture
    journal. It asserts that the Rust replay reaches the JS producer's tip hash, and that a
    tampered capture line is refused.
  - A second loopback case beside `txbt4` asserts the same tip-hash equality for the BLAKE2b
    family.

Not changed here: checkpoints stay off. That item and its reminder are in "Open —
checkpoints into `txbt4`" above. Until the item closes, every receipt carries
`"anchored": false` and SC5's reason.

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

## Re-verification — 2026-09-23 at 9c24aad52

Governed paths changed since `74254cc42` only by `9c24aad52`: one sentence of
`config/sidechain/README.md` says the interim producer now refuses any upstream checkout
other than the commits in `config/sidechain/upstream-pins` (spec `722ad42`, SPEC 0.0.3,
which fixed sidestr/spec issues 9 and 10). The chain document, its `tbtc4` parent, the
stock header family and the genesis test are unchanged, and the P21 gate on mainnet parents
stands. Upstream PR #4 has merged; explorer PR #2 is still open, so the review trigger holds.

## Disposition — 2026-10-02

- **Suitability:** fits, needs revision
- **Priority:** P2 — next cycle (planning-cycle §3 reopening; the sealed `tbtc4` chain is the §9 research chain, and D4's P21 gate is the §10 real-value trigger)
- **Why:** The first seal and the interim supervised producer, mirror and faucet are live on `tbtc4` (`d0fa1b80b`, deployment receipt 2026-09-30; the mirror reached tip 911 on 2 October). That is the chain §9 names. D1's projector check, D3's `pin:` and boot check, and D4's CI receipt check are still unbuilt (this record's first-seal section). The 2026-09-30 amendment proposes a second chain beside `txbt4`. That exceeds §9's stated scope (the research chain beside `tbtc4`), and it is an owner question. That amendment also says "It needs a BLAKE2b testnet4 node the estate does not have". This is overtaken: a Knots 29.4.2 plus rbitcoin 0.7.99 BLAKE2b testnet4 pair is synced on Dell staging (TODO N-10). The review trigger "a BLAKE2b testnet4 node reachable from the container" may therefore have fired; reachability from this container is unverified. A re-verification block also sits between `## Context` and `### Original context`.
- **Next:** On reopening, build D4's CI receipt check first, because §10 makes it the real-value gate. Get the owner's yes or no on the `txbt4` second chain before any D1 work for it. **Owner decision 2026-10-02, Q16: yes, `txbt4` is next-cycle work, not parked.** The 2026-09-30 amendment's second chain is therefore in scope for next cycle, beside `tbtc4`. Before D1 work for it, verify that the Dell staging BLAKE2b testnet4 node is reachable from the container (this record's review trigger).
