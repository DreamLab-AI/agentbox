---
id: ADR-2117
title: "Private owner-issued USD unit of account: a labelled test asset bridged through RGB into a dedicated sidestr chain"
date: 2026-09-23
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: a2fd86cb4110b8dcfcdfd79785b048a246d8c136
verified_paths: ["config/sidechain/*/chain.json"]
owner: jjohare
review_trigger: the owner gives the live go for the Liquid USDt proof (amendment 2026-09-23); Tether lists RGB among its supported protocols or publishes a canonical USD₮-on-RGB contract ID; a Tether or UTEXO test asset appears on testnet4 or signet; an rgb-lib release pins final rgb-protocol 0.11.1 or moves to the v0.12 line; Liquid peg-outs restored with a post-mortem; Circle lists a Bitcoin layer as a native USDC chain; any proposal to back the unit with real value, let anyone outside the owner's estate hold or redeem it, or add a chain document under config/sidechain/
repo: agentbox
domain: BASELINE-container
lineage: "Research brief docs/research/stablecoin-wrap-experiment.md (2026-09-23, deep tier, strict gate PASS). Amends ADR-2102 (fills its parked attestation format, signer and validator checks for this private experiment only); relates ADR-2096, ADR-2101, ADR-2103, ADR-2112, PRD-024."
---

# ADR-2117 — Private owner-issued USD unit of account: a labelled test asset bridged through RGB into a dedicated sidestr chain

## Context

The owner asked how the estate could wrap USD₮ or USDC into its sidestr chains as an
experiment, and then scoped it (binding addendum, 2026-09-23): the result is **his own USD
unit of account**, issued and held only inside his sovereign system (his instances, his
did:nostr agents, his chain), not a stablecoin product. The research brief
(`docs/research/stablecoin-wrap-experiment.md`) found: no issuer-backed USD₮ or USDC exists on
any Bitcoin test network we could use; USD₮ on RGB is not live on mainnet (UTEXO's only tested
route is Arbitrum mainnet into UTEXO's own signet, and Tether's supported-protocols page lists
no RGB); Circle issues natively on no Bitcoin layer; Liquid had a supply-validation exploit on
6 September 2026 whose unbacked L-BTC left through the legitimate peg-out path.
`sidestr:dreamlab` is sealed with no `rules` and `pegs: []`, and announces on public relays.
ADR-2102 fixes the shape and parks the attestation format, signer and validator checks.

## Decision

1. **Scope: a private, owner-issued USD unit, never a real stablecoin.** The issuer is the owner.
   Only the owner's keys (his instances and did:nostr agents) hold it. There is no public offer,
   no third-party holder and no redemption for anyone outside the estate. No USD₮ or USDC, on any
   network, is locked, held or referenced as backing. The unit has no value and is not
   redeemable. **External or user-facing use is out of scope and needs a new ADR.**
2. **Phase 0, mock on route A.** A new chain (not `sidestr:dreamlab`) with `rules: ["assets"]`
   carries the unit, issued with the upstream `issue:`/`tally:` records and moved between the
   owner's agent keys, to exercise wallets, agents, the asset URN and Nostr surfaces. It proves
   no backing and says so.
3. **Phase 1, real RGB wrap on route B, testnet4 only.** The owner's issuer wallet mints an RGB20
   NIA asset on testnet4 with rgb-lib; the unpublished `sidestr-bridge` process receives it by
   out-of-band consignment, the owner's attester validates and signs, and a chain carrying a
   versioned `bridge` rule mints the wrapped unit. Exit is burn, `FINALISE_BLOCK` (ADR-2101),
   then an RGB send back that the issuer wallet validates. This is ADR-2102's ratification
   evidence.
4. **The `bridge` rule's invariants** (for this experiment; upstream or fork per owner decision b):
   - records `bmint`, `bburn`, `brelease`, `breject`, `bhalt`, each keyed by origin network plus
     reserve outpoint; a reused key is invalid (replay guard);
   - a `bridgeConfirmations` depth in the chain document before any attestation may be signed;
   - mint authority is an authority coin whose key is the attestation key, distinct from
     block-signing keys; every mint, halt and rejection spends and recreates it, and the rule
     checks the signature itself against the key pinned in the chain document;
   - signers and attesters are owner-controlled instances: 1-of-1 now, matching ADR-2101's
     research-stage topology, and k-of-n owner instances later, each running its own rgb-lib
     validation in its own process; RGB semantics stay outside consensus (ADR-2102 §2);
   - a per-asset cap; a zero amount or empty attestation digest is invalid;
   - `circulating + pending = minted − released`, checked by every validator at every block,
     fail-closed;
   - release only after the burn's `FINALISE_BLOCK` certificate; `breject` re-credits the burner;
     an unsettled burn past a declared window is published by validators;
   - `bhalt` stops mints and releases for the asset while units stay transferable and are shown
     impaired; no haircut or rebasing in consensus; **no per-holder freeze**, since every holder
     is the owner's own key;
   - an independent reserve-versus-supply check passes before any release is broadcast (the
     Liquid lesson: key security is not supply validation).
5. **Naming and disclaimer.** A generic "USD" description is allowed. The name, ticker, contract
   metadata and code contain none of USDT, USD₮, Tether or USDC, private or not (Tether's marks
   clause covers "meta data or code"). Every surface that names the unit (README, chain document
   `comment`, wallet UI, any announcement) carries: "Private USD unit of account of the owner's
   estate, testnet only. No value, not redeemable, not offered to anyone. Not USD₮ or USDC and
   not issued, backed or endorsed by Tether or Circle. Do not send mainnet assets."
6. **Process isolation.** rgb-lib runs only in `sidestr-bridge`, `publish = false`, never linked
   with an AGPL `sidestr-*` crate: ADR-2102 §3 for engineering reasons, and now also because
   rgb-lib's graph contains `base85` declared `MPL-2.0-no-copyleft-exception`.
7. **Testnet only.** Parent is testnet4 (or regtest for CI). No mainnet chain document, no
   mainnet deposit address and no wording suggesting either. Mainnet stays behind the P21
   owner-and-legal gate (ADR-2103).
8. **Private by default.** The experiment chain runs on private relays and a private mirror
   unless the owner decides otherwise (decision f). Access to the chain and its mirror is the
   owner's to grant.
9. **Watch items, not routes.** Real USD₮ on RGB, Liquid USDt, USD₮ on Taproot Assets and USDC
   are revisited only on the `review_trigger` events above.

### Options considered and rejected

- **Wrap real USD₮ on RGB now.** Not live on mainnet, no testnet contract, and holding it makes
  the owner a custodian of a stablecoin (ADR-2102 amendments) before counsel has advised.
- **Use UTEXO's signet route.** It locks real Arbitrum-mainnet USDT to mint on a signet the owner
  does not control; that is a real-value backing, outside decision 1.
- **Liquid USDt.** Liquid peg operations were suspended after the 6 September exploit, and the
  route does not involve our testnet4 parent.
- **Taproot Assets first.** tapd needs LND plus a Core ZMQ change; Tether's USD₮ plan is on RGB.
- **Add `rules` to `sidestr:dreamlab`.** A sealed field change is a new genesis; validators would
  disagree from height zero.
- **Link rgb-lib into the node or a published crate.** Breaks ADR-2102 §3 and raises the
  `base85`/AGPL question in one binary.
- **Independently operated attesters now.** Right for a bridge that serves others; a private
  single-owner unit has no other operators, so owner instances it is, and the choice is revisited
  with any external use.
- **A per-holder freeze.** Nothing to protect against when every holder is the owner.

## Consequences

The owner gets a private USD unit for his agents in days (Phase 0) and a real RGB wrap in weeks
(Phase 1), with no real stablecoin locked and nothing offered to anyone. That the closed,
unbacked, unpriced, owner-only unit sits outside the UK cryptoasset and stablecoin regimes and
outside MiCA's offer-to-the-public test is an inference for counsel: the evidence gives no
guidance on single-owner or no-value tokens, and the inference ends if real value backs the
unit, even inside the closed system. The experiment cannot show anything about Tether's terms,
freezes on RGB, or v0.12 compatibility. Costs: a new chain and producer, the `bridge` rule in JS
siding and later as a Rust `BlockRule` in sidestr-rs (Rust followers refuse any rule-bearing
chain today), the `sidestr-bridge` binary, an indexer, a few thousand tBTC4 sats, and the
attester process. With the owner running every attester, k-of-n buys process isolation, not
independence, which is acceptable only while no one outside the estate relies on the unit.

**Decisions for the owner.**

- (a) The new chain: a throwaway, never sealed into `config/sidechain/`, or sealed and funded by
  a real testnet4 peg-in (no fake genesis peg, which would mint unbacked sats).
- (b) Propose `bridge` (and the non-coinbase authority-coin mint path) upstream to Melvin
  Carvalho, or fork the spec at 722ad42 and accept losing `sidestr:tally`-style interoperability.
- (c) The reserve attestation format: a signed Nostr event (consignment digest, rgb-lib version,
  RGB line, anchoring height and depth, reserve output key, recipient script, attester
  signatures) referenced by digest from the record, or the digest carried in the authority-coin
  spend's witness if the 255-byte record limit bites.
- (d) Whether to run electrs beside the Dell testnet4 node. That host also runs a live mainnet
  Lightning node with real funds, so any change there needs owner approval; until then Phase 1
  uses a public testnet4 Electrum server.
- (e) Counsel engagement before anything touches a real stablecoin (including as backing inside
  the closed system), before anyone outside the estate could hold the unit, and before public
  material that could read as an invitation; the brief's section 9 lists the questions.
- (f) Whether the experiment chain announces on public relays with a public mirror, as
  `sidestr:dreamlab` does today, or runs on private relays and a private mirror. Recommended:
  private by default for a private unit.

## Amendment 2026-09-23: real-asset proof of principle on the light Liquid option

The owner then asked for a proof of principle against a real asset, still inside the closed,
single-owner scope, and chose the light Liquid option. This amendment changes decisions 1 and 3
for that proof only. It is recorded before anything is live; the live step needs the owner's
explicit go.

**What changes.**

- **Decision 1, amended.** A small reserve of real, Tether-issued **Liquid USDt** (the owner's
  own funds, of the order of 10 to 50 USD) may back the private unit. Everything else in
  decision 1 stands: the owner is the only issuer and holder, there is no public offer, no
  third-party holder and no redemption outside the estate, and no Tether or Circle mark appears
  in the unit's name, ticker, metadata or code. Counsel question Q2 in the brief (real-value
  backing inside a closed system) is now live, not hypothetical.
- **Decision 3, amended.** Phase 1's origin becomes Liquid USDt instead of an RGB20 test asset.
  The bridge process uses Blockstream's Liquid Wallet Kit (LWK, MIT, crates `lwk_wollet`,
  `lwk_signer`, `lwk_common` 0.19.x) in place of rgb-lib. LWK is MIT, so the process-isolation
  reason that rgb-lib's MPL-2.0 dependency created does not apply to it; the bridge stays a
  separate process anyway, because it holds reserve keys. The owner holds the reserve wallet's
  blinding key, so the attester can check the asset and the amount itself, which RGB could not
  give inside consensus. RGB USD₮ moves to the watch list with its existing revisit trigger.
- **Light option.** The reserve wallet syncs from Blockstream's public Liquid servers; no Liquid
  node is run. The attestation's trust basis is therefore that server's view: it cannot forge
  the owner's transactions but could omit or delay one. Privacy cost: the server learns the
  reserve addresses and query times. Upgrade trigger to an own `elementsd` (at least 23.3.4, the
  release that fixed the 6 September range-proof caching bug), on its own VM and not beside the
  mainnet Lightning node: before releases are automated, before the reserve exceeds pocket money,
  or before anyone outside the estate depends on the unit.
- **Parent network.** The experiment chain may take parent `btc` (Bitcoin mainnet, stock headers)
  instead of `tbtc4`, as the owner proposed. It carries **no BTC pegs** (`pegs: []`), so block
  production touches no mainnet funds; the only mainnet spend is an optional checkpoint, one
  ordinary fee each. This opens ADR-2096 D1's mainnet gate for this experiment chain only, and
  only on the owner's explicit go at live time. `sidestr:dreamlab` stays on testnet4.

**Wiring survey of the Dell VM (read-only, 2026-09-23).** Host `tab5`, 192.168.2.27: 8 cores,
7 GB RAM, 499 GB free on `/mnt/staging`. Mainnet `bitcoind` 30.3.0 at height 968,315, synced,
pruned (blocks kept from 954,723; `prune=75000`), Tor-only with 15 peers, one existing wallet
(`cormorant`, not ours, untouched). Its RPC already binds to `192.168.2.27` with the LAN in
`rpcallowip`, and port 8332 is reachable from the agentbox container; the estate holds no
mainnet RPC credential. The mainnet Lightning node (`/var/lib/lightning`, localhost:9735, live
channel) has run since 18 September and was not touched. The testnet4 Lightning service
(`lightningd-testnet4`) has been failed since 21 September after a port clash on 9736; a restart
attempt failed again and it was left down, since this experiment does not need it.

**Further decisions for the owner.**

- (g) How the producer reaches mainnet RPC. Either add an `rpcauth` user for it, which edits the
  mainnet config and restarts `bitcoind` and so briefly interrupts the Lightning node with a live
  channel; or run the experiment's producer on the Dell itself against the local cookie, which
  needs no restart. Recommended: the second.
- (h) Checkpoints: none for the proof, or a separate small mainnet wallet (never `cormorant`,
  never Lightning's) that pays checkpoint fees.
- (i) Funding: the owner acquires the Liquid USDt reserve himself (for example through SideSwap
  or an exchange that withdraws to Liquid) and sends it to the reserve address only when he gives
  the live go.
- (j) Whether to diagnose and restore `lightningd-testnet4` (its data and config are ours; the
  box is shared with real funds).

**Wiring status.** In progress on a sidestr-rs branch (`sidestr-bridge-liquid`, unpublished):
reserve wallet from a mnemonic held outside every repository, sync against the public Liquid
server, USDt identified by an asset id verified from primary sources, and a deterministic signed
reserve attestation that the `bridge` rule will check. Nothing is funded, sealed, announced or
published.

## Verification

Proposed; implementation none, activation inactive. Established at `a2fd86cb4` on a worktree of
`origin/main`: `config/sidechain/` holds one chain document,
`config/sidechain/dreamlab/chain.json`, whose `pegs` is `[]` and which names no `rules`, so no
asset or bridge chain exists; `git grep sidestr-bridge -- services crates` returns nothing, so no
bridge binary exists; `config/sidechain/README.md` records that the interim producer uses the
five default public relays and can publish a GitHub Pages mirror. `verified_paths` watches
`config/sidechain/*/chain.json`, so a new chain document (the first act of Phase 0 if the owner
chooses a sealed chain) trips the gate and forces this record to be re-read. Ratification
evidence is ADR-2102's plus: the supply identity asserted on every block; a replayed reserve
outpoint refused; a burn released only after `FINALISE_BLOCK`; a `bhalt` drill; a reorg-after-mint
drill on testnet4 or regtest; the disclaimer present on every surface that names the unit; no
holder key outside the owner's estate.
