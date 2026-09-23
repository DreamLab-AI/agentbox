---
id: ADR-2113
title: "Wrapped stablecoin experiment: a labelled test asset bridged through RGB into a dedicated sidestr chain"
date: 2026-09-23
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: bfda4d4e4eebfcb0bcb9b9bbe363f57b96477fdc
verified_paths: ["config/sidechain/*/chain.json"]
owner: jjohare
review_trigger: Tether lists RGB among its supported protocols or publishes a canonical USD₮-on-RGB contract ID; a Tether or UTEXO test asset appears on testnet4 or signet; an rgb-lib release pins final rgb-protocol 0.11.1 or moves to the v0.12 line; Liquid peg-outs restored with a post-mortem; Circle lists a Bitcoin layer as a native USDC chain; any proposal to lock a real stablecoin, accept a deposit from outside the estate, or add a chain document under config/sidechain/
repo: agentbox
domain: BASELINE-container
lineage: "Research brief docs/research/stablecoin-wrap-experiment.md (2026-09-23, deep tier, strict gate PASS). Amends ADR-2102 (fills its parked attestation format, signer and validator checks for the experiment only); relates ADR-2096, ADR-2101, ADR-2103, ADR-2112, PRD-024."
---

# ADR-2113 — Wrapped stablecoin experiment: a labelled test asset bridged through RGB into a dedicated sidestr chain

## Context

The owner asked how the estate could wrap USD₮ or USDC into its sidestr chains as an
experiment. The research brief (`docs/research/stablecoin-wrap-experiment.md`, 2026-09-23)
found: no issuer-backed USD₮ or USDC exists on any Bitcoin test network we could use; USD₮ on
RGB is not live on mainnet (UTEXO's only tested route is Arbitrum mainnet into UTEXO's own
signet, and Tether's supported-protocols page lists no RGB); Circle issues natively on no
Bitcoin layer; Taproot Assets USD₮ go-live is unconfirmed; Liquid USDt is real, but Liquid had
a supply-validation exploit on 6 September 2026 whose unbacked L-BTC left through the legitimate
peg-out path. `sidestr:dreamlab` is sealed with no `rules` and `pegs: []`. ADR-2102 already fixes
the shape (bridge in, isolated rgb-lib process, burn before release) and parks the attestation
format, signer and validator checks.

## Decision

1. **The experiment wraps an asset the estate issues, never a real stablecoin.** No USD₮ or
   USDC, on any network, is locked, held or referenced as backing. The asset has no value, is
   not redeemable, and is issued only to estate keys and invited testers.
2. **Phase 0, mock on route A.** A new chain (not `sidestr:dreamlab`) with `rules: ["assets"]`
   carries a test dollar-unit issued with the upstream `issue:`/`tally:` records, to exercise
   wallets, agents, the asset URN and Nostr announcements. It proves no backing and says so.
3. **Phase 1, real RGB wrap on route B, testnet4 only.** The issuer wallet mints our own RGB20
   NIA asset on testnet4 with rgb-lib; the unpublished `sidestr-bridge` process receives it by
   out-of-band consignment, attesters validate and sign, and a chain carrying a versioned
   `bridge` rule mints the wrapped unit. Exit is burn, `FINALISE_BLOCK` (ADR-2101), then an RGB
   send back that the issuer wallet validates. This is ADR-2102's ratification evidence.
4. **The `bridge` rule's invariants** (for the experiment; upstream or fork per owner decision b):
   - records `bmint`, `bburn`, `brelease`, `breject`, `bhalt`, each keyed by origin network plus
     reserve outpoint; a reused key is invalid (replay guard);
   - a `bridgeConfirmations` depth in the chain document before any attestation may be signed;
   - mint authority is an authority coin whose key is the k-of-n attestation key, distinct from
     block-signing keys; every mint, halt and rejection spends and recreates it, and the rule
     checks the threshold signature itself against the key pinned in the chain document;
   - a per-asset cap; a zero amount or empty attestation digest is invalid;
   - `circulating + pending = minted − released`, checked by every validator at every block,
     fail-closed;
   - release only after the burn's `FINALISE_BLOCK` certificate; `breject` re-credits the burner;
     an unsettled burn past a declared window is published by validators;
   - `bhalt` stops mints and releases for the asset while wrapped units stay transferable and
     are shown impaired; no haircut or rebasing in consensus;
   - attestation by at least 2-of-3 attesters, each running its own rgb-lib validation in its
     own process; RGB semantics stay outside consensus (ADR-2102 §2);
   - an independent reserve-versus-supply check passes before any release is broadcast (the
     Liquid lesson: key security is not supply validation).
5. **Naming and disclaimer.** The ticker, name and all contract metadata contain none of USDT,
   USD₮, Tether or USDC (Tether's marks clause covers "meta data or code"). Every surface that
   names the asset (README, chain document `comment`, wallet UI, Nostr announcement) carries:
   "Testnet only. This asset has no value, is not redeemable, is not USD₮ or USDC and is not
   issued, backed or endorsed by Tether or Circle. Do not send mainnet assets."
6. **Process isolation.** rgb-lib runs only in `sidestr-bridge`, `publish = false`, never linked
   with an AGPL `sidestr-*` crate: ADR-2102 §3 for engineering reasons, and now also because
   rgb-lib's graph contains `base85` declared `MPL-2.0-no-copyleft-exception`.
7. **Testnet only.** Parent is testnet4 (or regtest for CI). No mainnet chain document, no
   mainnet deposit address and no wording suggesting either. Mainnet stays behind the P21
   owner-and-legal gate (ADR-2103).
8. **Watch items, not routes.** Real USD₮ on RGB, Liquid USDt, USD₮ on Taproot Assets and USDC
   are revisited only on the `review_trigger` events above.

### Options considered and rejected

- **Wrap real USD₮ on RGB now.** Not live on mainnet, no testnet contract, and holding it makes
  the estate a custodian of a stablecoin (ADR-2102 amendments) before counsel has advised.
- **Use UTEXO's signet route.** It locks real Arbitrum-mainnet USDT to mint on a signet the estate
  does not control; that is a real-value deposit, outside decision 1.
- **Liquid USDt.** Liquid peg operations were suspended after the 6 September exploit, and the
  route does not involve our testnet4 parent.
- **Taproot Assets first.** tapd needs LND plus a Core ZMQ change; Tether's USD₮ plan is on RGB.
- **Add `rules` to `sidestr:dreamlab`.** A sealed field change is a new genesis; validators would
  disagree from height zero.
- **Link rgb-lib into the node or a published crate.** Breaks ADR-2102 §3 and raises the
  `base85`/AGPL question in one binary.
- **A single bridge signing key.** Ronin-class failure; the threshold must count operators.

## Consequences

The owner's question gets a runnable answer in days (Phase 0) and weeks (Phase 1) without any
real stablecoin or regulatory exposure, on the inference (for counsel) that an unbacked,
unpriced, estate-issued test token is outside the UK and MiCA stablecoin regimes. The experiment
cannot show anything about Tether's terms, freezes on RGB, or v0.12 compatibility. Costs: a new
chain and producer, the `bridge` rule in JS siding and later as a Rust `BlockRule` in sidestr-rs
(Rust followers refuse any rule-bearing chain today), the `sidestr-bridge` binary, an indexer,
a few thousand tBTC4 sats, and attester processes. Because one operator runs every attester,
k-of-n here buys process isolation, not independence; a federation of other operators is needed
before the rule carries value.

**Decisions for the owner.**

- (a) The new chain: a throwaway, never sealed into `config/sidechain/`, or sealed and funded by
  a real testnet4 peg-in (no fake genesis peg, which would mint unbacked sats).
- (b) Propose `bridge` (and the non-coinbase authority-coin mint path) upstream to Melvin
  Carvalho, or fork the spec at 722ad42 and accept losing `sidestr:tally`-style interoperability.
- (c) The reserve attestation format: a signed Nostr event (consignment digest, rgb-lib version,
  RGB line, anchoring height and depth, reserve output key, recipient script, per-attester
  signatures) referenced by digest from the record, or the digest carried in the authority-coin
  spend's witness if the 255-byte record limit bites.
- (d) Whether to run electrs beside the Dell testnet4 node. That host also runs a live mainnet
  Lightning node with real funds, so any change there needs owner approval; until then Phase 1
  uses a public testnet4 Electrum server.
- (e) Counsel engagement before anything touches a real stablecoin, a deposit from outside the
  estate, or public material that could read as an invitation; the brief's section 9 lists the
  eight questions.

## Verification

Proposed; implementation none, activation inactive. Established at `bfda4d4e4` on a detached
worktree of `origin/main`: `config/sidechain/` holds one chain document,
`config/sidechain/dreamlab/chain.json`, whose `pegs` is `[]` and which names no `rules`, so no
asset or bridge chain exists; `grep -rn "sidestr-bridge" services/ crates/` returns nothing, so
no bridge binary exists. `verified_paths` watches `config/sidechain/*/chain.json`, so a new
chain document (the first act of Phase 0 if the owner chooses a sealed chain) trips the gate and
forces this record to be re-read. Ratification evidence is ADR-2102's plus: the supply identity
asserted on every block; a replayed reserve outpoint refused; a burn released only after
`FINALISE_BLOCK`; a `bhalt` drill; a reorg-after-mint drill on testnet4 or regtest; the
disclaimer present on every surface that names the asset.
