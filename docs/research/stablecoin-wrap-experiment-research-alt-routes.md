Backends: ceramic (6 queries, lead-finding only), perplexity_search (12 queries), web-researcher/scrape_page + search_and_scrape (21 pages read), github (gh api: repo licences, releases, sample-tapd.conf), crates.io API, direct HTTP to the public Taproot Assets universe REST API. Native WebSearch/WebFetch not used. All retrieval 2026-09-23.

# Stablecoin wrap experiment: routes other than RGB (researcher B)

Scope: Taproot Assets (USD₮), Liquid (USDt), USDC on Bitcoin, and what a reserve-holding bridge needs for each. RGB is out of scope and covered by another researcher. Status tags: **verified** = read on the cited page or observed directly; **inferred** = reasoned from verified facts; **unresolved** = asserted only by secondary sources, or not found.

## Headline for the sidestr experiment

1. **No route gives us real test USDT or USDC on a Bitcoin test network.** No issuer publishes a testnet4, signet or Liquid-testnet faucet for its own stablecoin. What does exist, all verified: (a) anyone can mint their own asset with tapd on testnet4, signet or regtest, served by Lightning Labs' test universes; (b) anyone can issue a Liquid-testnet asset; (c) a third-party "PEGx USDt Testnet" asset lives on Liquid testnet [100][105][106][114][118]. For a testnet experiment, the honest design is therefore **a mock issuer we control on the parent test network, then a wrap into sidestr**. That exercises the same mechanics as the real asset, with no claim to be USDT.
2. **Liquid is the direct prior art for "federated Bitcoin sidechain carrying a stablecoin"** [111][112][113]. On 6 September 2026 it suffered a peg exploit: about 4,000 unbacked L-BTC were minted through an Elements range-proof caching bug and pegged out for real BTC. Blockstream says issued assets such as USDt were unaffected by the exploit itself, but they were frozen along with the whole chain while bridge nodes were down [115][116]. This is the most relevant lesson in this report for a bridge design.
3. **Circle issues USDC natively on no Bitcoin layer.** Its own list of 38 native chains, dated 16 September 2026, contains no Bitcoin, Lightning, Liquid, Taproot Assets or RGB entry [119][120]. On Taproot Assets, USDC exists only as a *bridged* asset through third parties [102].

## 1. USD₮ on Taproot Assets (Lightning Labs `tapd`)

**Announcement: verified.** Tether and Lightning Labs announced on 30 January 2025, at the Plan ₿ Forum in El Salvador, that USDT would come to Bitcoin on-chain and to Lightning via Taproot Assets. Lightning Labs' post pointed developers at `litd` in integrated mode (which bundles lnd and tapd) and at Polar [100][101]. Tether's release is conditional: "Once fully integrated, USDt will operate…" [101].

**Launch status and mainnet date: unresolved.** Several secondary sites say USDT "went live" on 21 March 2026. Two examples are the HOGE Wire article [110] and a casino-industry page (tech-insider.org, seen only as a search snippet and not read, so not cited). None links a Tether or Lightning Labs primary source that I could read:
- Tether's newsroom excerpt on 23 September 2026 still leads with the January 2025 announcement [101].
- Lightning Labs' v0.8 release post (23 June 2026) does not say USDT is live. It speaks generically of "assets like stablecoins" [103].
- The same HOGE article [110] adds that the live token is a "USDT-L" custodied by Cantor Fitzgerald. That is single-source, attributed to "BTC.network", and **unverified**.

So: the announcement is verified; production go-live remains unresolved pending a primary Tether or Lightning Labs statement. The mainnet universe does list many assets named "USDT" [108]. That list is evidence *against* trusting a name: anyone can mint an asset called USDT. Genuine Tether USD₮ must be identified by Tether's published asset ID or group key, which I did not find.

**Wallets: partly verified.** Lightning Labs' v0.6 post (24 June 2025) says bridged USDT and USDC plus native DePix and GBP are usable "through applications and SDKs like Speed Wallet, LnFi, and Joltz" [102]. A wallet list specific to Tether-issued USD₮ is unresolved.

**Protocol and software: verified.**
- `tapd` is MIT-licensed [104].
- The latest release is v0.8.4 (16 September 2026). v0.8.0 shipped on 8 June 2026 and v0.7.0 on 20 November 2025 [104].
- v0.8 brought the first public Taproot Assets SDK, written in Go with gRPC and REST transports. The post says the design is portable to other languages, Rust included, but no Rust SDK exists yet [103].
- Minting a grouped (re-issuable) asset is a single CLI command; a later tranche of the same group key stays fungible with earlier ones [107][102].

**Test networks: verified.**
- `sample-tapd.conf` lists `mainnet, regtest, testnet, testnet4, simnet, signet`. It names a default proof courier for each test network: `testnet4.universe.lightning.finance:443` and `signet.universe.lightning.finance:443`. A custom `signetchallenge` is also supported [105].
- Lightning Labs' signet guide documents running tapd on signet against `signet.universe.lightning.finance:443` [106].
- The "First Steps" guide says that "On regtest and signet you will have to also run a universe locally" [107]. I read that as "for your own assets". Tapd can itself act as a universe server [107].
- The testnet4 and signet universe REST endpoints both answered `/v1/taproot-assets/universe/info` on 2026-09-23 [108].

**Issuer test assets or faucets: none found (unresolved; searched).** No Tether test USD₮ exists on any Bitcoin test network. **Can a third party mint its own test asset? Yes, verified** [107]. This is the practical path: mint `tUSD` on testnet4 or signet, whose BTC comes from public faucets [106].

**Rust client libraries: verified as immature.**
- `taproot-assets` and its sibling crates (`-rpc`, `-types`, `-core`, `-zk-*`) are at version 0.0.2, last updated 18 February 2026, Apache-2.0, published by a personal account (ffranr) that is not a Lightning Labs organisation account [109].
- `coreyphillips/rust-tap` is an LDK-based Rust implementation of the protocol with 4 stars; it states that Lightning channel support is "in progress" [109].
- Practical option (inferred): generate a tonic client from tapd's `.proto` files, or drive tapd over REST, as the estate already does elsewhere for LND through `tonic-lnd`/`lnd_grpc_rust` [109].

## 2. USDt on Liquid (Blockstream's federated sidechain)

**Live status: verified.** Tether announced USDt on Liquid on 29 July 2019 [117]. Blockstream's status page for the September 2026 incident calls USDT one of the "Other Liquid assets… unaffected by this security incident". The same page says bridge nodes were disabled, so "Effectively, the Liquid sidechain is paused" [115].

As of 10 September 2026, 10:00 UTC:
- block production had resumed;
- "Peg operations, including PAK-authorized peg-outs, remain suspended";
- restoring the reserve was still "in progress" [115].

The Block reports Elements v23.3.4 was deployed on 9 September and transactions resumed on 10 September. About 598.5 BTC had not been returned, and Blockstream refused a 10 % bounty demand [116]. SideSwap reported peg-in reopened through SideSwap on 11 September while peg-out stayed closed. I saw that only in the testnet.sideswap.io news snippet and did not read the page, so it is not cited as verified.

**Issuance model: verified** [113][114]:
- Any participant can issue an asset. The **asset ID** (64 hex characters) is derived from the issuance input and the hash of a JSON contract (name, ticker, domain, precision, issuer_pubkey). Contract fields are immutable once issued [114].
- **Reissuance tokens** are created only at initial issuance ("all or nothing"). Whoever holds them can mint more. They "can be set up with a multisignature scheme… m of n" [113][114].
- Anyone holding the asset can burn it by sending to a provably unspendable output; no reissuance token is needed [114].
- Maximum supply is 21 M×10⁸ base units [114].
- Fees are paid only in L-BTC, so a USDt-only wallet cannot send anything [114].
- Liquid "does not verify whether the underlying asset exists", unlike the BTC peg [113].
- Metadata goes to the Blockstream Asset Registry, with domain proof via `/.well-known/liquid-asset-proof-<asset-id>` [113].

**Confidential assets: verified.** Amounts *and asset types* are blinded by default. Blinding keys can be disclosed for audit [113].

**Freeze: inferred and partly verified.**
- Plain Liquid issued assets are "permissionless… transfers don't require a cosignature from the issuer" [114]. The protocol itself has no freeze primitive.
- Issuer-side freeze exists only in Blockstream's AMP (AMP0/AMP2): an HSM cosigns only to whitelisted wallets and supports "lock/unlock to freeze an asset" [122].
- The Liquid docs list USDt among the *plain* (non-AMP) assets [114]. So Tether's Liquid USDt appears to lack a contract-level freeze of the kind it has on Ethereum and Tron (inferred). What control Tether does have — reissuance tokens, redemption policy — is **unresolved**.

**Peg model, precisely: verified** [111][112]:
- **Federation.** 15 functionaries hold one key each in an HSM. As *blocksigners* they propose one-minute blocks round-robin, and a block needs ≥ 2/3 of signers (11 of 15). Signers refuse to sign anything that would reorganise more than one block, so two confirmations are final. If one-third or more of signers go offline, the chain freezes [111].
- **Peg-in.** The user sends BTC to an 11-of-15 multisig address generated by the Liquid client and claims L-BTC after **102 Bitcoin confirmations**. Anyone can peg in [111][112].
- **Peg-out.** Only functionaries and *participant* members can peg out. The general public cannot [111]. Watchmen check that the L-BTC was burned and that the destination is derived from an entry on the **PAK (Peg-out Authorisation Key) list**, then sign with 11 of 15 keys. Changing the PAK list takes 3 days, so that a compromise of the functionaries can be detected before withdrawals follow [111][112]. Peg-outs run in batches, typically 11–35 minutes [111].
- **Emergency withdrawal.** Each peg-in UTXO carries a timelock of 4,032 blocks (28 days). The timelock is refreshed through peg-out change (2,016 blocks) or an automatic sweep after 1,008 blocks. After 7 days of inactivity the oldest UTXOs become spendable by **Blockstream-held emergency backup keys**; after 28 days, all of them are [112]. The functionary hardware is a host plus a separate key module that accepts SSH only after a physical button press; functionaries talk over Tor [111].
- **September 2026 lesson.** No key was stolen. A consensus-validation bug (range-proof verification caching) let an attacker mint unbacked L-BTC, and the *legitimate* PAK-authorised peg-out path then paid real BTC [115][116]. The federation's key security held, but the sidechain's own **supply validation** failed.

**Liquid testnet: verified.**
- Liquid testnet exists; its L-BTC asset ID is `144c6543…9a49`, and a public faucet runs at liquidtestnet.com/faucet [114].
- Anyone can issue a test asset with LWK or `elements-cli issueasset` [114].
- A third-party **"PEGx USDt Testnet"** asset (`b612eb46…9d73`, issuer domain pegx.io) is served by SideSwap's testnet API [118]. It is not issued by Tether.

**Rust tooling: verified.** LWK (`lwk_wollet` 0.19.0, 18 August 2026) is BSD-MIT licensed [121]. `elements` 0.27.0 is the rust-elements crate [121]. The Liquid docs give Rust issuance examples [114].

## 3. USDC on Bitcoin

**No native Circle issuance on any Bitcoin layer: verified by absence.**
- Circle's USDC page lists 38 native chains "as of September 16, 2026", from Algorand to ZKsync. None is Bitcoin, Lightning, Liquid, Taproot Assets or RGB [120].
- The multichain page (network count dated June 2026) shows the same set with token standards and testnet addresses; none is a Bitcoin layer [119].
- Circle's Bitcoin product is cirBTC — wrapped *BTC* on Ethereum and Arc — which is a different direction. I saw it only in search snippets and did not read the page, so it is not cited as verified.

**Closest alternatives:**
- **Bridged USDC on Taproot Assets.** Verified to exist through Speed, LnFi and Joltz [102]. Trust model: the bridge operator holds real USDC on a Circle chain and mints a Taproot Asset against it. Circle neither backs nor redeems the wrapped token, so holders trust the operator's reserve and redemption, and the Taproot Assets proof chain proves only the operator's issuance (inferred). The operators' reserve and attestation specifics are unresolved.
- A Spark comparison page says Circle "has not made an official announcement about native Taproot Assets support". I saw that only in a search snippet and did not read the page, so it is not cited.
- An issuer-controlled equivalent on Liquid would be AMP2 [122]. I found no USDC issued there (unresolved).

## 4. What a third party needs to receive, custody and move each asset (for a reserve-holding bridge)

| Route | Receive | Custody | Move / redeem |
|---|---|---|---|
| USD₮ (or any asset) on Taproot Assets | lnd ≥ v0.20 plus tapd on the same network, synced to the issuer's universe. Generate a tap address for the asset ID or group key [105][107]. | Keys live in lnd's wallet. Asset **proof files** must be kept and backed up: v0.8 backup/restore covers only the tapd layer, and restore still needs the lnd wallet [103]. Losing proofs means you cannot prove ownership (inferred). | On-chain tap send (BTC fee), or a Lightning asset channel plus RFQ edge node. Redemption to fiat is solely through the issuer [102][103]. |
| USDt on Liquid | Elements node or LWK watch-only wallet, confidential address, the asset ID on an allow-list [114]. | Standard Liquid keys. **Must also hold L-BTC for fees** [114]. Multisig via descriptors. | Liquid transaction, final after 2 blocks [111]. Exit to fiat through Tether or exchanges. The chain can be paused wholesale, as in September 2026 [115]. |
| USDC (no Bitcoin-native form) | Hold on a Circle-native chain, e.g. Ethereum Sepolia test USDC [119]. Or accept a third-party bridged Taproot Asset [102]. | EVM key custody for native USDC. For bridged forms, trust the operator's reserve as well. | Native: EVM transfers or Circle's CCTP. Bridged: the operator's redemption rules. For our wrap, the reserve sits off-Bitcoin and the peg is an observer attestation (inferred). |

**Inferred implication for the sidestr bridge.** Across all three routes the bridge's reserve wallet is a *custodian of an issuer-controlled asset*. The issuer can still control it — through reissuance and burn (Liquid), group keys (Taproot Assets) or blacklists (EVM). A wrapped sidestr token therefore inherits two trust layers: the issuer's, and our federation's. Liquid's incident shows that the federation's **supply-validation code** is as critical as its keys. Any sidestr wrap needs an independent reserve-versus-supply invariant check before a redemption is paid.

## Sources

### [100] A New Era for Stablecoins: Tether Is Coming to Bitcoin and Lightning
URL: https://lightning.engineering/posts/2025-01-30-Tether-on-Lightning/
Retrieved: 2026-09-23
Status: verified
Found via: perplexity → web-researcher/scrape_page
<untrusted-source url="https://lightning.engineering/posts/2025-01-30-Tether-on-Lightning/" retrieved="2026-09-23">
> Today we are excited to announce that Tether is bringing USDT to bitcoin, with both on-chain transactions and Lightning Network support.
> To get started building with USDT on Lightning, developers should download the latest version of the litd suite and use it in integrated mode. The litd bundle combines lnd, tapd, and a number of liquidity services into a single binary … It is also available in the most recent Polar release
</untrusted-source>

### [101] Tether Brings USDt to Bitcoin's Lightning Network, Ushering in a New Era of Unstoppable Technology
URL: https://tether.io/news/tether-brings-usdt-to-bitcoins-lightning-network-ushering-in-a-new-era-of-unstoppable-technology/
Retrieved: 2026-09-23
Status: verified
Found via: perplexity → web-researcher/scrape_page
<untrusted-source url="https://tether.io/news/tether-brings-usdt-to-bitcoins-lightning-network-ushering-in-a-new-era-of-unstoppable-technology/" retrieved="2026-09-23">
> San Salvador, El Salvador – 30th January 2025 – Tether … announced the integration of USDt into Bitcoin's ecosystem, including both its base layer and the Lightning Network.
> Once fully integrated, USDt will operate seamlessly on Bitcoin's base layer and its layer 2 Lightning Network.
</untrusted-source>

### [102] Announcing Taproot Assets v0.6: Bitcoin's Decentralized FX Network Has Arrived
URL: https://lightning.engineering/posts/2025-6-24-tapd-v0.6-launch/
Retrieved: 2026-09-23
Status: verified
Found via: perplexity → web-researcher/scrape_page
<untrusted-source url="https://lightning.engineering/posts/2025-6-24-tapd-v0.6-launch/" retrieved="2026-09-23">
> Once USDT is fully integrated with the Lightning Network, users worldwide will be able to make cross-border payments … Even today, users can utilize bridged USD stablecoins (USDT and USDC) and native stablecoins (DePix and GBP) through applications and SDKs like Speed Wallet, LnFi, and Joltz.
> minters can use the --new_grouped_asset option when minting to ensure assets share a group_key identifier, providing provenance verification and asset fungibility.
</untrusted-source>

### [103] Announcing Taproot Assets v0.8 and SDK: Building Stablecoins at Lightning Speed
URL: https://lightning.engineering/posts/2026-06-23-tapd-0.8-launch/
Retrieved: 2026-09-23
Status: verified
Found via: web-researcher/search_and_scrape
<untrusted-source url="https://lightning.engineering/posts/2026-06-23-tapd-0.8-launch/" retrieved="2026-09-23">
> The Taproot Assets SDK, distributed as a Go package, is a client-side library for applications that talk to tapd.
> The SDK ships two transports … a native gRPC client and a REST client.
> The business concepts are meant to carry over to future SDKs in other languages, so a TypeScript, Rust, Python, Kotlin, or Swift library can expose the same AssetRef, wallet, issuer, and universe surfaces
> because the backup covers only the Taproot Assets layer, a full restore still requires access to the corresponding LND wallet
</untrusted-source>

### [104] lightninglabs/taproot-assets — licence and releases (GitHub API)
URL: https://github.com/lightninglabs/taproot-assets
Retrieved: 2026-09-23
Status: verified
Found via: github (`gh api repos/lightninglabs/taproot-assets`, `/releases`, `/releases/tags/v0.8.0`, `/releases/tags/v0.7.0`)
<untrusted-source url="https://github.com/lightninglabs/taproot-assets" retrieved="2026-09-23">
> {"license":"MIT","pushed":"2026-09-18T09:46:22Z"}
> {"tag":"v0.8.4","date":"2026-09-16T11:31:20Z"} … {"tag":"v0.8.0","date":"2026-06-08T10:30:30Z"} … {"tag":"v0.7.0","date":"2025-11-20T14:03:46Z"}
</untrusted-source>

### [105] taproot-assets/sample-tapd.conf
URL: https://github.com/lightninglabs/taproot-assets/blob/main/sample-tapd.conf
Retrieved: 2026-09-23
Status: verified
Found via: perplexity → github (`gh api …/contents/sample-tapd.conf`)
<untrusted-source url="https://github.com/lightninglabs/taproot-assets/blob/main/sample-tapd.conf" retrieved="2026-09-23">
> ; Default for testnet4:
> ;   proofcourieraddr=universerpc://testnet4.universe.lightning.finance:443
> ; Default for signet:
> ;   proofcourieraddr=universerpc://signet.universe.lightning.finance:443
> ; Network to run on (mainnet, regtest, testnet, testnet4, simnet, signet)
> ; Connect to a custom signet network defined by this challenge
</untrusted-source>

### [106] Testing on Signet — Builder's Guide
URL: https://docs.lightning.engineering/lightning-network-tools/lightning-terminal/testing-on-signet
Retrieved: 2026-09-23
Status: verified
Found via: perplexity → web-researcher/scrape_page
<untrusted-source url="https://docs.lightning.engineering/lightning-network-tools/lightning-terminal/testing-on-signet" retrieved="2026-09-23">
> To run `tapd` on signet, define network=signet on startup or as part of `tapd.conf`
> A universe can be found at `signet.universe.lightning.finance:443`
> Browser-based signet faucets: https://signet257.bublina.eu.org/ https://signetfaucet.com/ https://faucet.coinbin.org/
</untrusted-source>

### [107] Taproot Assets — First Steps
URL: https://docs.lightning.engineering/lightning-network-tools/taproot-assets/first-steps
Retrieved: 2026-09-23
Status: verified
Found via: perplexity → web-researcher/scrape_page
<untrusted-source url="https://docs.lightning.engineering/lightning-network-tools/taproot-assets/first-steps" retrieved="2026-09-23">
> `tapcli assets mint --type normal --name beefbux --supply 1000000 --decimal_display 3 --meta_bytes '{"hello":true}' --meta_type json --new_grouped_asset`
> Assets that were minted with the flag `--new_grouped_asset` do not have a fixed supply. A new batch of this asset can be minted later in a way that the two assets are considered of the same asset group, and therefore fungible.
</untrusted-source>
(The "On regtest and signet you will have to also run a universe locally" sentence appeared in the Perplexity excerpt of this page; the scraped portion was truncated before it, so that sentence is treated as a lead only.)

### [108] Taproot Assets universe servers — direct REST queries
URL: https://universe.lightning.finance/v1/taproot-assets/universe/stats/assets?asset_name_filter=USDT&limit=20
Retrieved: 2026-09-23
Status: verified (direct observation; also queried https://testnet4.universe.lightning.finance/v1/taproot-assets/universe/info and https://signet.universe.lightning.finance/v1/taproot-assets/universe/info)
Found via: direct HTTP (curl)
<untrusted-source url="https://universe.lightning.finance/v1/taproot-assets/universe/stats/assets?asset_name_filter=USDT&limit=20" retrieved="2026-09-23">
> USDT 0f929c417705fd4a … genesis 948676 | USDT 2ffd81695465c848 … genesis 813043 | USDT 7d4bef3cb0c64d1e … genesis 940657 | USDT 7d834e07830eb4c3 … | USDT ae1785d57f868510 … | USDT b0c517224a18b0f7 … | USDT b6938c8eded807c5 … | USDT bb784c2a5c456eb7 …
> testnet4 universe/info: {"runtime_id":"4563566069815946586"}; signet universe/info: {"runtime_id":"296380016439774699"}
</untrusted-source>
(Summarised output of a parsing script: at least eight distinct mainnet assets are named "USDT". The name is not an authority.)

### [109] Rust ecosystem for Taproot Assets (crates.io API and GitHub search)
URL: https://crates.io/crates/taproot-assets
Retrieved: 2026-09-23
Status: verified
Found via: crates.io API + github (`gh api search/repositories?q=taproot+assets+language:rust`)
<untrusted-source url="https://crates.io/crates/taproot-assets" retrieved="2026-09-23">
> taproot-assets 0.0.2 2026-02-18 High-level Rust SDK bundling Taproot-Asset types, RPC client, and more. (repository https://github.com/ffranr/taproot-assets-rs, licence Apache-2.0)
> taproot-assets-rpc 0.0.2 2026-02-18 Taproot Assets gRPC client
> coreyphillips/rust-tap … A Rust implementation of the Taproot Assets Protocol (TAP) built on LDK … Lightning asset channel integration is in progress.
> lnd_grpc_rust 2.16.0 2026-07-17 … tonic-lnd 0.5.1 2023-03-11
</untrusted-source>

### [110] Taproot Assets in 2026: Dollars Return to Bitcoin (HOGE Wire)
URL: https://hoge.gg/taproot-assets-2026-dollars-return-to-bitcoin/
Retrieved: 2026-09-23
Status: unresolved (secondary; claims not traced to a primary source; publisher is a former community-token site)
Found via: perplexity → web-researcher/scrape_page
<untrusted-source url="https://hoge.gg/taproot-assets-2026-dollars-return-to-bitcoin/" retrieved="2026-09-23">
> That changed on 21 March 2026, when Tether's USDT went live on Bitcoin and the Lightning Network through a protocol called Taproot Assets, the finish line of a 14-month integration (BTC.network).
> The version live on Lightning, often labeled USDT-L, is a wrapped representation custodied by Cantor Fitzgerald and backed by existing Ethereum USDT and Tether's reserves (BTC.network).
</untrusted-source>

### [111] Liquid Technical Overview
URL: https://docs.liquid.net/docs/technical-overview
Retrieved: 2026-09-23
Status: verified
Found via: ceramic + perplexity → web-researcher/scrape_page
<untrusted-source url="https://docs.liquid.net/docs/technical-overview" retrieved="2026-09-23">
> Block signers … refuse to sign blocks that would result in a reorganization of more than one block. … Liquid transactions can be considered final once they receive two confirmations.
> If one-third or more of the functionaries are no longer operating, blocks will no longer be signed and the Liquid blockchain will be frozen
> A peg-in transaction requires 102 confirmations on the Bitcoin network before the funds can be claimed on the Liquid Network.
> the watchmen will only send bitcoin to an address under the control of an authorized user. This is done through the use of a Peg-out Authorization Key (PAK). … it takes three days to update the PAK list.
> The general public does not have the ability to independently peg-out of the network
</untrusted-source>

### [112] How does the Liquid Federation's multisig work?
URL: https://help.blockstream.com/liquid-network/faqs/how-does-the-liquid-federations-multisig-work
Retrieved: 2026-09-23
Status: verified
Found via: perplexity → web-researcher/scrape_page
<untrusted-source url="https://help.blockstream.com/liquid-network/faqs/how-does-the-liquid-federations-multisig-work" retrieved="2026-09-23">
> The Liquid Federation uses an 11-of-15 multisig wallet to process peg-ins and peg-outs … The 15 Liquid functionaries each hold one key, which is stored in their specialized HSM hardware.
> the federation functionary units verify that the peg-out transaction has been sent to a whitelisted address (PAK list) and the corresponding amount of LBTC has been burned
> Upon peg-in, a timelock of 4,032 blocks (28 days) is set for each UTXO. … After 28 days of network inactivity, all timelocks will have expired, and the entire federation wallet would be spendable.
> The Liquid Network's emergency backup keys are held by Blockstream.
</untrusted-source>

### [113] Liquid Features & Benefits
URL: https://docs.liquid.net/docs/liquid-features-and-benefits
Retrieved: 2026-09-23
Status: verified
Found via: perplexity → web-researcher/scrape_page
<untrusted-source url="https://docs.liquid.net/docs/liquid-features-and-benefits" retrieved="2026-09-23">
> Confidential Transactions on Liquid allows any two parties to transact without anyone else being able to view the asset (e.g. LBTC, USDT-Liquid) and amount transacted
> The obligations under an issued asset belong to the issuer and Liquid does not verify whether the underlying asset exists or is properly maintained (in contrast to the BTC peg-in procedures).
> The reissuance tokens are used to prove authority and reissue more of the newly created asset at a later date. These tokens can be set up with a multisignature scheme generally described as being "m of n".
</untrusted-source>

### [114] Liquid Assets (support-liquid-assets)
URL: https://docs.liquid.net/docs/support-liquid-assets
Retrieved: 2026-09-23
Status: verified
Found via: perplexity → web-researcher/scrape_page
<untrusted-source url="https://docs.liquid.net/docs/support-liquid-assets" retrieved="2026-09-23">
> Plain Liquid assets are **permissionless**: anyone can issue one, anyone can hold one, and transfers don't require a cosignature from the issuer.
> This page covers how to support **plain Liquid issued assets** in your venue: LBTC, USDt, and any other unrestricted asset
> | Liquid testnet | `144c654344aa716d6f3abcc1ca90e5641e4e2a7f633bc09fe3baf64585819a49` | … Testnet LBTC can be obtained from the public faucet at <https://liquidtestnet.com/faucet>
> Liquid fees are paid in LBTC only. A wallet with a rich USDt balance but zero LBTC cannot send anything.
> Once issued, `name`, `ticker`, `domain`, `precision`, and `issuer_pubkey` are locked by the contract hash.
</untrusted-source>

### [115] Liquid Security Incident — Blockstream Service Status
URL: https://status.blockstream.com/incidents/b8b719f3-db70-4487-9cff-946e69509228
Retrieved: 2026-09-23
Status: verified
Found via: perplexity → web-researcher/scrape_page
<untrusted-source url="https://status.blockstream.com/incidents/b8b719f3-db70-4487-9cff-946e69509228" retrieved="2026-09-23">
> Status as of September 10, 2026, 10:00 UTC … block production has resumed without transactions … Peg operations, including PAK-authorized peg-outs, remain suspended while work continues on the final recovery stage: restoring the BTC/LBTC reserve is in progress.
> Purported white-hat hackers have withdrawn ~4,000 BTC (~$320 million) from the Liquid Federation wallet. … withdrawn via the SideSwap PAK (Peg-out Authorization Key), but that key was not compromised, nor were any others.
> Other Liquid assets such as USDT, DePix, and RWAs are unaffected by this security incident. Bridge nodes have been temporarily disabled … Effectively, the Liquid sidechain is paused
</untrusted-source>

### [116] 'Return the bitcoin': Blockstream refuses ransom demand for remaining 600 BTC from Liquid exploit (The Block)
URL: https://www.theblock.co/news/ecosystems/2026-09-11-return-the-bitcoin-blockstream-refuses-ransom-demand-for-remaining-600-btc-from-liquid-exploit-414247
Retrieved: 2026-09-23
Status: verified
Found via: perplexity → web-researcher/scrape_page
<untrusted-source url="https://www.theblock.co/news/ecosystems/2026-09-11-return-the-bitcoin-blockstream-refuses-ransom-demand-for-remaining-600-btc-from-liquid-exploit-414247" retrieved="2026-09-23">
> Liquid's Sept. 8 incident report said the vulnerability was in the caching of range proof verifications in Elements … About 4,000 LBTC was created without backing by bitcoin held in reserve.
> The exploiter then used … SideSwap, which, as a Liquid Federation member, holds a peg-out authorization key, to convert the unbacked LBTC to BTC through a standard peg-out.
> A new Elements release, v23.3.4, was deployed on Sept. 9. … peg-outs remain disabled as a precautionary measure
</untrusted-source>

### [117] Tether Add Support For Liquid Network
URL: https://tether.io/news/tether-add-support-for-liquid-network/
Retrieved: 2026-09-23
Status: verified
Found via: perplexity → web-researcher/scrape_page
<untrusted-source url="https://tether.io/news/tether-add-support-for-liquid-network/" retrieved="2026-09-23">
> it is with great pleasure that we announce the support for Tether on Liquid Network.
> "It has been a natural decision to deploy Tether on the Liquid Network …" Paolo Ardoino, Chief Technology Officer at Tether.
</untrusted-source>
(Page carries no visible date in the scrape; the 29 July 2019 date comes from Perplexity's metadata for this URL and the Blockstream PRWeb release. The PRWeb release is a lead only, not read.)

### [118] SideSwap API documentation
URL: https://sideswap.io/docs/
Retrieved: 2026-09-23
Status: verified
Found via: perplexity → web-researcher/scrape_page
<untrusted-source url="https://sideswap.io/docs/" retrieved="2026-09-23">
> Testnet API server - wss://api-testnet.sideswap.io/json-rpc-ws
> "asset_id": "b612eb46313a2cd6ebabd8b7a8eed5696e29898b87a43bff41c94f51acef9d73", "contract": { "entity": { "domain": "pegx.io" }, … "name": "PEGx USDt Testnet", "precision": 8, "ticker": "USDt"
</untrusted-source>

### [119] Multichain USDC (Circle)
URL: https://www.circle.com/multi-chain-usdc
Retrieved: 2026-09-23
Status: verified
Found via: perplexity → web-researcher/scrape_page
<untrusted-source url="https://www.circle.com/multi-chain-usdc" retrieved="2026-09-23">
> USDC is natively supported across 38 blockchain networks, … On EVM-compatible chains, USDC is deployed as a smart contract. On non-EVM chains, USDC uses built-in token primitives.
> Bridged USDC Standard … Circle's Bridged USDC Standard gives EVM blockchain and rollup teams a way to reduce liquidity fragmentation
</untrusted-source>

### [120] USDC — Powering global finance (Circle)
URL: https://www.circle.com/usdc
Retrieved: 2026-09-23
Status: verified
Found via: perplexity → web-researcher/scrape_page
<untrusted-source url="https://www.circle.com/usdc" retrieved="2026-09-23">
> USDC is natively supported on 38 blockchain networks as of September 16, 2026: Algorand, Aptos, Arbitrum, Arc, Avalanche, Base, Celo, Codex, Cronos, EDGE Chain, Ethereum, Hedera, HyperEVM, Injective, Ink, Linea, Monad, Morph, NEAR, Noble, OP Mainnet, Pharos, Plasma, Plume, Polkadot, Polygon PoS, Sei, Solana, Sonic, Starknet, Stellar, Sui, the XRPL, Unichain, World Chain, X Layer, XDC, and ZKsync
</untrusted-source>

### [121] Blockstream LWK and rust-elements (GitHub and crates.io)
URL: https://github.com/Blockstream/lwk
Retrieved: 2026-09-23
Status: verified
Found via: github (`gh api repos/Blockstream/lwk/contents/LICENSE`) + crates.io API
<untrusted-source url="https://github.com/Blockstream/lwk" retrieved="2026-09-23">
> Except where noted in an individual source file, for sub-projects under the subprojects/ directory, and noted below, this code is covered by the following (BSD-MIT) license: Copyright (c) Blockstream, Inc 2024
> lwk_wollet 0.19.0 2026-08-18 Liquid Wallet Kit - Watch-only wallet based on CT Descriptors
> elements 0.27.0 2026-08-04 https://github.com/ElementsProject/rust-elements/
</untrusted-source>

### [122] AMP2 Use cases (Blockstream Enterprise docs)
URL: https://enterprise.blockstream.com/docs/amp/intro/use-cases
Retrieved: 2026-09-23
Status: verified
Found via: perplexity → web-researcher/scrape_page
<untrusted-source url="https://enterprise.blockstream.com/docs/amp/intro/use-cases" retrieved="2026-09-23">
> Set `useToWhitelist: true` on the restriction group so the HSM only cosigns transfers to approved wallets.
> Use lock/unlock to freeze an asset during corporate actions or regulatory holds.
> Stablecoins … Issue the asset with a reissuance token (set `satoshi_token > 0`) … When users redeem, call the burn endpoint to permanently destroy tokens.
</untrusted-source>

## Open questions

1. **USD₮ on Taproot Assets production status.** Is there a Tether or Lightning Labs primary statement of go-live, and what are Tether's canonical asset ID and group key? The 21 March 2026 date and the "USDT-L / Cantor Fitzgerald custody" claim rest on secondary sites only [110].
2. **Tether's control over Liquid USDt.** Does Tether hold reissuance tokens, and does it have any freeze capability on plain (non-AMP) Liquid USDt? This matters for the bridge's reserve risk.
3. **Liquid peg-out restoration date** after the September 2026 incident, and whether the 598.5 BTC shortfall has been covered. Status was last confirmed at 10 September 2026 [115].
4. **Operators of bridged USDC on Taproot Assets** (Speed, LnFi, Joltz): the reserve custodian, attestation and redemption terms are not documented in what I read.
5. **Testnet4 universe contents.** The testnet4 and signet universes respond [108], but I did not enumerate whether any issuer publishes stable test assets there. A mock issuer of our own appears to be the only reliable option.
6. **Rust tapd client.** The 0.0.2 crates [109] are pre-release and from an individual account. Decision needed: generate a tonic client from tapd's protos in-estate (per the house rule, a clean-room module could become a published crate), or wait for an official Rust SDK [103].
