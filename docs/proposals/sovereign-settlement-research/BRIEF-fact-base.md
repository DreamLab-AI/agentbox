# Coordinator brief — sidestr + RGB financial substrate (fact base, 2026-09-21)

Written by the Fable coordinator for the Opus planning tier. Every planner reads this first, then
the R-reports in `./` (R1-sidestr-spec.md, R2-agentbox-surfaces.md, R3-pods-forum-visionclaw.md,
R4-canon-assertions.md). Claims below are verified by the coordinator unless marked (R#).

## Owner's framing (verbatim intent)
- "closing the payments and assets loop properly" is a missing element inside agentbox.
- sidestr (Melvin Carvalho, upstream author of JavaScriptSolidServer/JSS, which solid-pod-rs ports) is
  the candidate financial substrate; it "can incorporate and extend to include the RGB protocol",
  which "unlocks the previously asserted design choices based on RGB" (ADR-124/128 L3).
- Must integrate with: Solid pods, did:nostr pubkey identity, agent wallets, user value and asset
  chains, across VisionFlow's repos, federated instances, agent containers.
- Owner clarification 2026-09-21: **we are not bound to BLAKE2b** — the Knots-BLAKE2b parent is the
  upstream developer's preference; treat SHA-256d Bitcoin (testnet4 / mainnet) as our target parent.
- Owner clarification 2026-09-21: **USDT on RGB** (Tether) "gives us USD tokens on our platform".

## sidestr — what it is (verified from spec/ clone, SPEC.md v0.0.1 draft dated 2026-09-15)
- A Bitcoin-family sidechain whose only network is Nostr: signed blocks (BIP-325 signet-style
  challenge), no subsidy, every coin a pegged coin, rules as signed JSON-LD documents with activation
  heights ("user activated": nodes adopt rule documents; signers order, users validate).
- Chain document fields: id `sidestr:<name>`, parent, challenge (script), powLimit, addressPrefix
  (bech32m), magic, pegConfirmations (6), refundBlocks (10000), pegoutBlocks (144), pegoutMin,
  minFeeRate, genesis pegs, signer(s)/threshold, rules[]. Nesting: a sidestr chain can parent another.
- Peg-in: parent tx pays a taproot peg output (key path = peg holders; script path =
  `and_v(v:pk(refund), older(refundBlocks))`) + OP_RETURN `pegin:<chain>:<script>`; claimed after
  pegConfirmations as coinbase output paired with `claim:<txid>:<vout>`. Refund path returns coins
  to the pegger after the timelock with no signer.
- Peg-out: burn OP_RETURN `pegout:<parent script hex>` ≥ pegoutMin; peg holders pay it on the parent
  with marker `pegout:<chain>:<sidechain txid>`. Level 1: "the federation's promise". Trust-minimised
  peg-out explicitly out of scope for 0.0.1.
- Levels: 1 = one signer, validators trust signers for pegs ("for coins with no value"); 2 = k-of-n
  taproot multi_a signers with parent view, co-signing round over relays (kinds 23510-23514), PSBT
  peg-out round; 3 = rotation + recovery (not built).
- Nostr kinds: 23500 tx, 23501 faucet, 23510-23514 signer round, 33333 tip (NIP-333 shape, `d`=chain
  id, `t`=sidestr, `u`=mirror URLs), 33500 rule doc, 33501 genesis, 33502 peg record.
- Opt-in rules (proposals, each "running" on one test chain since 18 Sept 2026): `assets` + `pool`
  (issued unbacked assets via OP_RETURN records `issue:`/`tally:`/`pool:`; constant-product AMM as
  consensus rule; assets-between-chains reserved/draft), `desk`, `checkpoints` (OP_RETURN
  `ckpt:<chain>:<height>:<hash>` into the parent), `evm` (ethereumjs, 1 sat = 1 gwei, JSON-RPC),
  `ephemeral` (a note, nothing built: chains with a `close`, pro-rata closing coinbase, tombstone).
- Live chains: `sidestr:gitmark` ("a chain for blocktrails — git commits anchored as trails of tweaked
  taproot outputs (git-mark.com)… checkpointed into the parent"), txbt4-evm, txbt4-fed (2-of-3),
  txbt4-desk, tally, melchain, capewars-s6. All parent `btc:testnet4-blake2b`.
- Engine: bitcoin-desktop/schema (JSON-LD declarative Bitcoin schema + JS codec/kernel, byte-exact
  round-trip tests). `siding/lib/engine.mjs:15-18` loads the Knots BLAKE2b overlay unconditionally;
  `overlay.mjs:50-52` gives the sidechain's own headers `powHash: 'knots:blake2b-v2'` from height 0.
  Parent is read via bitcoind JSON-RPC with txindex + a wallet (`parent.mjs`). R1 to confirm how
  hard the BLAKE2b assumption is; owner says it is a preference, not a bound.
- Maturity: single author, repo created 2026-09-15, 2 stars, last commit today, spec self-described
  "nothing here is final… field names, kinds and document shapes are provisional". All JS, AGPL-3.0.
  Upstream JSS has zero sidestr code today (gh code search = 0 hits).
- Spec's own prior-art note: "RGB and Taproot Assets, for validation by the client rather than the
  chain" — sidestr's assets rule is chain-validated (consensus), the opposite model to RGB.

## RGB and USDT (verified via web search 2026-09-21)
- Tether announced USD₮ on RGB 2025-08-28 ("plans to launch"). Commercial rollout led by UTEXO
  (Tether-funded, $7.5M seed 2026-03); CTO on 2026-07-30 community call: realistic, not committed,
  launch window "end of summer to mid-September 2026". Not confirmed live as of 2026-09-21.
- RGB v0.11.1 on mainnet since July 2025; used by Iris Wallet, BitMask, KaleidoSwap, LNFI, Utexo.
  `rgb-lib` (Rust) is the app-developer library (issuance, transfers, UTXO mgmt, consignments);
  `rgb-lightning-node` (RLN) = rgb-lib + LDK fork. RGB v0.12 = LNP/BP consensus re-design
  (RGB-WG), full consensus test coverage, NOT integrated in any Lightning app; the ecosystem split
  (github.com/rgb-protocol vs RGB-WG) means "RGB" names two divergent codebases.
- Tether WDK (Wallet Development Kit) has a Utexo RGB-on-chain module (Feb 2026) and an RGB
  Lightning module (live per rgb.info).
- Regulatory: ADR-124 §7 asserts removing custody does not remove UK obligations at any trust level
  (MLR-2017, FCA); a fiat-referenced stablecoin adds the FCA stablecoin regime to that matrix.

## Estate — what exists (R2, R3, R4, coordinator-verified where stated)
- solid-pod-rs (Rust JSS port, AGPL-3.0-only) owns 100% of Bitcoin tx construction:
  `crates/solid-pod-rs/src/bitcoin_tx.rs` (1442 lines) + `mrc20.rs` (1181) hand-roll BIP-341
  TapSighash/taproot tweak on raw k256 (house rule: never hand-roll crypto → highest-priority port).
  Routed `/pay/*` economy: WebLedger (did:nostr→sats), acl:PaymentCondition debit, TXO+MRC20
  deposits with replay guard, order book + AMM (30 bps), `.buy/.withdraw/.withdraw-sats` broadcast
  via one configured mempool.space-style REST URL (ADR-2007, default testnet4). README disclaims
  production-safety of payment routes (non-atomic payment state).
- git-mark = a plain git commit (author = agent DID); block-trail anchor = opt-in chained taproot
  UTXO timestamping the commit SHA (ADR-059). Provenance feature OFF in default build.
- agentbox: sell-side 402 (payment-gate.js, cost-gate.js — cost gate defaults fail-OPEN on backend
  unreachability) + buy-side C1-C5 (pay402.js closed-grammar classifier {agentbox-ledger|x402|l402|
  unknown}, spend-policy.js caps/allowlist/threshold with in-memory daily budget, consumer-payer.js,
  receipt-minter.js, well-known.js, skills/payment-router). `[payments]` manifest block exists.
  `payment_settlement` is a declared zero-tolerance authority class BUT `routes/payments.js` never
  calls `lib/authority.js` (coordinator grep 2026-09-21: only broker-bridge and llm-marketplace do).
  x402/l402 payable:false; no NWC/NIP-47/NIP-57 code anywhere. Lightning-first (PRD-015 C10) is the
  only planned real-money rail; EVM/USDC rail formally rejected (C11).
- Blocktrail `txo[]` — the named single-use-seal seam to L1/RGB/DLC (ADR-033) — is constructed empty
  in `services/nostr-pod-bridge/src/contract.rs:139` and never populated. uris.js has 20 URN kinds;
  none for wallet/asset/ledger/chain.
- Three unsynced did:nostr-keyed sats ledgers: solid-pod-rs StoragePaymentStore, VisionClaw
  `src/handlers/pay_handler.rs` FsPaymentStore (its `.deposit` is a 501 stub; ADR-124's P21 testnet
  pin / cash-out disablement NOT implemented), nostr-bbs-pod-worker D1. Version skew: VisionClaw pins
  solid-pod-rs 0.4.0-alpha.15, nostr-bbs pins 0.5.0-alpha.7.
- VisionClaw's `src/web_contract/` holds TrustLevel L0-L3 / GitMark / Blocktrails (ADR-124/128);
  `crates/visionclaw-contracts` is an unrelated envelope-schema crate (naming collision).
  AnchorConfirmer (seal-closing) has only test doubles. RGB/AluVM/rgb-core: zero hits estate-wide.
- Nostr: relay allowlist is build-time (ADR-2012); no sidestr kinds anywhere; agentbox owns kind
  block 38000-38201 (38106-38201 free); nostr-bbs owns 31400-31405; forum takes colloquy crates from
  crates.io with no path edge. nostr-bbs-core signing is RustCrypto (clean).
- Five adapter slots; ADR-2085 precedent: no sixth slot — new capabilities consume memory/events.
- Federation economics: PRD-010 has zero economic content; BC20 receipt kind deliberately stays local.
- Owner decision 2026-09-02 (blake2-experiment/SPEC.md): "tokens first, no VisionFlow pivot. The
  anchoring stack keeps using mainnet." A b2mine Rust BLAKE2b header/PoW codec is specced, no code.
- Licensing: repo root AGPL-3.0; `services/` crates MIT OR Apache-2.0 (ADR-2030) unless they link an
  AGPL library (then declare AGPL-3.0-only, publish=false). Contributors must not link solid-pod-rs
  as a Rust library from agentbox (HTTP boundary only). sidestr JS is AGPL → a container-internal
  sidecar is fine; a publishable Rust crate must be clean-room from the spec or declared AGPL.

## Canonical tensions the plan must resolve explicitly (R4)
1. ADR-124/128 sequence RGB last/optional/audit-gated — must be formally re-sequenced, not overridden.
2. rgb-core/rgb-lib vs k256-only zero-rust-bitcoin-dep posture (rgb-lib pulls rust-bitcoin/bdk).
3. Lightning-first sole planned rail (ADR-032 D5) vs a sidechain rail — additive or amending?
4. sidestr `evm` rule vs PRD-015 C11 "no native EVM rail" rejection — must be excluded or superseded.
5. Custody: sidestr level-1 signer = custodian of the peg; PRD-015 "non-custodial by default".
6. Regulatory: no cell of the ADR-124 matrix is exempted by RGB; USDT adds stablecoin regime.
7. "single-use seal" terminology forbidden until spent-exactly-once check exists (ADR-124 §2.3).
8. Three ledgers → one canonical ledger decision is a precondition.
9. Every 402 scheme addition is an ADR-032 revision + fixtures, never a runtime extension point.

## House conventions for the deliverables
- agentbox: next ADR = ADR-2096+ in `docs/adr/` (TEMPLATE.md frontmatter, ≤10-line Context,
  verified_commit/verified_paths, `decision_status: proposed` for anything not yet ratified);
  PRD = `docs/proposals/<slug>.md` with `id: PRD-024` frontmatter (precedent PRD-023 =
  docs/proposals/sovereign-system-one.md); DDD = `docs/proposals/<slug>-domain.md` `DDD-022` (BC25);
  governing doc to amend in the same change; regenerate `node scripts/adr-index-gen.js docs/adr`.
- VisionFlow host repo (`/home/devuser/workspace/project/docs/adr/`): next ADR-2111.
- solid-pod-rs (`crates/solid-pod-rs/docs/adr/`): next ADR-2008. nostr-rust-forum, VisionFlow canon
  (`/home/devuser/workspace/VisionFlow/docs/adr/`): next ADR-2012 each.
- UK English. No em-dashes in prose. Cite file:line. Mint decisions as proposed; the human ratifies.

## Owner direction 2026-09-21 (supersedes anything above that conflicts)
- **"Our own sidestr sidechains are the key and only instrument."** DreamLab-operated sidestr chains
  (we are the signers / peg holders, level 2 federation across our own instances as the target) are
  THE value instrument of the platform. Lightning/NWC, x402, L402 and the pod WebLedger are not the
  instrument; they are at most on-ramps, bridges or legacy surfaces to be reconciled onto the chains.
- **"Note we can bridge assets in."** External assets enter our chains by peg-in / bridge: Bitcoin
  (sats) by the spec's peg-in, and issued assets (USDT-on-RGB, other RGB20 assets, Taproot Assets)
  by a bridge that claims a wrapped asset on our chain (the assets-and-pools §4 "assets between
  chains" shape, generalised to an RGB origin). The RGB integration is therefore primarily a
  BRIDGE (an RGB-aware peg holder that receives a consignment and claims a wrapped asset), not an
  in-chain RGB VM. Tension 3 (Lightning-first) is resolved as "amended: sidestr rail replaces
  Lightning as the planned real-money rail; Lightning becomes an optional bridge". Tension 5
  (custody) is resolved as "we are our own federation"; the level-1→2→3 ladder is the custody
  hardening path and must be stated honestly per chain.

## Owner decisions 2026-09-21 (answered directly; binding for the plan)
- D1 Parent/value: SHA-256d **testnet4 first**; mainnet and real USDT only behind the ADR-124 P21
  owner+legal build gate, which must be IMPLEMENTED (on-seal currency pin, cash-out disablement)
  before any mainnet chain document is signed.
- D2 Topology: **one DreamLab root chain** (level 2, k-of-n; each federated instance holds a signer
  key) carrying users and bridged assets; agents/sessions/jobs open **ephemeral child chains** nested
  off it and settle back on close.
- D3 Build: **Rust clean-room validator + wallet** as a publishable permissive crate (from the spec,
  not the AGPL code); **accept rust-bitcoin** into the estate and port solid-pod-rs's hand-rolled
  BIP-341 to it in the same programme; **rgb-lib only inside an isolated bridge service**; run the
  upstream AGPL JS `siding` as the interim signer/producer sidecar until the Rust producer has parity.
- D4 Ledger truth: **the chain is truth**; a did:nostr balance is the UTXO set keyed by that pubkey
  on our chain; WebLedger / FsPaymentStore / D1 ledger become derived read-through views; pay402
  gains a `sidestr` scheme (ADR-032 revision + fixtures).
- D5 **Lightning-first is dropped** ("we have sidestr now"): PRD-015 C10 and ADR-032 D5 are
  superseded; NWC/L402 are not built; Lightning may later appear only as a bridge on-ramp.
- Standing: `evm` rule excluded (PRD-015 C11 stands); RGB enters as a bridged asset (wrapped-asset
  claim on our chain), not as an in-chain VM; everything minted `proposed`, the human ratifies.
- Owner: "we should fully align our ecosystem around these decisions and stack over nostr."

## Owner amendment 2026-09-21 (D1 amended; D6 new)
- `sidestr:gitmark` IS the estate's gitmark (same product, Melvin's). Upstream has switched to the
  Knots BLAKE2b fork; the owner says "we can pivot too, which is fine", so the 2026-09-02 "anchoring
  stack keeps using mainnet [SHA-256d]" decision is no longer binding.
- D6 **Parent chain and hash family are configuration, not a pivot**: `agentbox.toml` gets a
  `[sidechain]` block where the parent network (`btc:testnet4-blake2b` | `btc:mainnet-blake2b` |
  `btc:testnet4` | `btc:mainnet`) and the sidechain's own header/PoW family (`knots:blake2b-v2` |
  `sha256d`) are explicit, validated choices; the onboarding system (agentbox-manifest projector,
  TUI manifest round-trip, stack provisioning, `./agentbox.sh` first-run) must expose and explain
  the choice; the chain document's `parent` is projected from it; mainnet variants stay behind the
  P21 gate (D1). Default: follow upstream (`btc:testnet4-blake2b`, `knots:blake2b-v2`) so the live
  gitmark chain, mirrors and tooling are reusable on day one; the SHA-256d option requires the
  R1 §11.4 overlay parameterisation, proposed upstream as a `chain.json` field rather than a fork.
- Consequence for the Rust port (D3): the `sidestr-core` header codec must support BOTH the 80-byte
  SHA-256d header and the 164-byte Knots v2 BLAKE2b header + unified sighash (the b2mine spec in
  ~/workspace/blake2-experiment/SPEC.md §1.1 already documents the v2 wire format).
