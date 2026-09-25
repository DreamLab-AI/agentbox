Backends: github (gh api + crates.io API, primary), web-researcher/scrape_page + search_and_scrape (page reads), perplexity_search (leads), ceramic (leads; 3 of 5 queries returned results, the rgb-lib/testnet4 and split queries returned zero). web-researcher news_search returned nothing (freshness filter). Native WebSearch/WebFetch not used.

# Researcher A — USD₮ on RGB, and the Tether / RGB / UTEXO partnership

Slug: `stablecoin-wrap-experiment` · Retrieved: 2026-09-23 · Dimension: USD₮-on-RGB status, test networks, rgb-lib, the RGB split, Tether's terms

## Findings

### 1. Is USD₮ on RGB live on Bitcoin mainnet? **No. As of 2026-09-23 there's no public evidence that it is.**

- **Announcement:** Tether's own press release is dated **28 August 2025**. It announces *plans* to launch USD₮ on RGB and cites the RGB 0.11.1 mainnet release [1]. Our prior note is correct.
- **No launch post from Tether.** The "latest news" list on Tether's newsroom page, read today, runs to 23 September 2026. It has no RGB launch item: the entries are QVAC Genesis III (23 Sep), the DOJ acknowledgement (11 Sep) and StableFund (9 Sep) [1]. Tether's *Supported Protocols* page doesn't list RGB or Bitcoin among the currently supported USD₮ protocols. It lists ERC-20 chains, Tron, Liquid, Solana, Polkadot AssetHub, Tezos, Near, Ton and Aptos. Omni is listed only as "no longer issuing" [2]. (verified; the absence is inferred from two Tether-owned pages.)
- **The UTEXO window has passed without a launch.** On the 30 July 2026 community call, UTEXO's CTO gave "end of summer to mid-September 2026" as a "realistic, not committed" window [3]. Bitfinex (17 July 2026) says "Tether itself has yet to confirm an official launch date" [16]. On 4 September 2026 UTEXO named UniSat as "next launch partner", but "No release date has been given yet" [13].
- **UTEXO's own docs, read today from GitHub, say mainnet isn't open.** The mint's "only tested and available route is Arbitrum (mainnet) to Bitcoin (Utexo signet). Bitcoin mainnet is not available yet" [4]. On-chain RGB is supported on mainnet, but "Lightning is beta and testnet-only" [5].
- **Issuer contract ID:** none published. UTEXO's docs say explicitly that "no canonical ID is committed in the SDK repositories" [7]. Tether's supported-protocols page has no RGB entry [2]. **Unresolved.**
- **Protocol line:** **rgb-protocol v0.11.1**, not RGB-WG v0.12. This appears in Tether's release [1] and UTEXO's materials [3]. Five core crates (rgb-aluvm, rgb-consensus, rgb-ops, rgb-schemas, rgb-api) dropped the `-rc` suffix and tagged plain `0.11.1` on **16 September 2026** [22]. GitHub confirms the `rgb-protocol/rgb-ops` release `0.11.1` at 2026-09-16T15:22Z.
- **Pre-launch, bridged, not Tether-issued:** KaleidoSwap did a mainnet Lightning atomic swap in September 2025 of "a USDt-backed RGB20 token bridged through UTEXO", on alpha software [16]. That is a UTEXO bridge token, not Tether-issued USD₮.
- **Wallets and nodes (all rgb-protocol v0.11.1 line):**
  - Live on RGB mainnet since July 2025: Iris Wallet, Bitcoin Tribe, BitMask (DIBA), LNFI, and ThunderLink (now UTEXO) [15].
  - Integrating UTEXO's SDK, per the call: Tribe, KaleidoSwap (beta), Iris, Layer Z, Xverse and UniSat [3].
  - Tether WDK has two modules. The on-chain RGB module shipped February 2026. The `wdk-rgb-lightning` Lightning module shipped August 2026, described as "early beta" and shown on a test network [14]. The GitHub repos `UTEXO-Protocol/wdk-wallet-rgb` and `UTEXO-Protocol/wdk-rgb-lightning` are both Apache-2.0; the Lightning module was last pushed on 2026-09-23 [27].
  - RGB Lightning Node: `RGB-Tools/rgb-lightning-node` is MIT, has no published GitHub releases, and was last pushed on 2026-09-17. UTEXO's docs name `UTEXO-Protocol/rgb-lightning-node` as their canonical fork [5].

### 2. Test networks and rgb-lib

- **Can a third party test USD₮-on-RGB? Yes, but only on UTEXO-operated test infrastructure, and not with a Tether-issued contract.**
  - UTEXO's default development network is the `utexo` profile, a **UTEXO-operated signet**. It has its own proxy (`rpcs://rgb-proxy.utexo.com/json-rpc`) and Esplora (`https://esplora-api.utexo.com`). A testnet3 profile also exists [6].
  - A Telegram faucet bot (`@Utexo_RLN_bot`, `/getbtc`) hands out test BTC [8]. On the call it was also shown sending test assets by asset ID [3].
  - The bridge demo moved USDT from Arbitrum **mainnet** into a signet RGB wallet [3][4]. That implies a real-USDT lock with a test-network mint. We haven't verified how the mint's backing is treated on this path.
  - The quickstarts treat the test "usdt" as an **NIA** (Non-Inflatable Asset) schema asset [7].
  - The mint API has a dev base URL (`transfer.gateway.dev.utexo.com/api/v0`). It uses network IDs 91/95 for testnet RGB and RGB-Lightning, and 36/94 for mainnet [7]. (Mint API reference, same docs repo.)
- **rgb-lib (github.com/RGB-Tools/rgb-lib):**
  - Latest published version: **`0.3.0-beta.7`**, released 2026-07-17 [10].
  - Licence: **MIT**, on both the repository and the crate [10]. This matches our earlier review.
  - **MSRV:** the published beta.7 declares **`rust-version = 1.88.0`** [10]. Current `master` declares **`1.94.0`** [9], so expect the bump in the next release.
  - Pins: rgb-lib still pins `rgb-ops`, `rgb-schemas` and `rgb-invoicing` to **`=0.11.1-rc.11`**, not the final `0.11.1` [9]. It uses `bdk_wallet =3.1.0`.
  - **Networks:** the `BitcoinNetwork` enum at the `0.3.0-beta.7` tag has **Mainnet, Testnet (testnet3), Testnet4, Signet, Regtest and SignetCustom**. `Testnet4` maps to `bitcoin::Network::Testnet4` [11]. **So testnet4 is supported.**
  - Indexers: blockchain access comes only through the **Electrum** (default) or **Esplora** cargo features [9]. The crate exposes no Bitcoin Core RPC backend (inferred from the feature set). A bitcoind for testnet4 therefore needs an electrs or Esplora in front of it.
  - Public testnet4 endpoints are listed in UTEXO's docs: Electrum `ssl://electrum.iriswallet.com:50053` and proxy `rpcs://proxy.iriswallet.com/0.2/json-rpc` [6].
  - The integration tests spin up regtest bitcoind + electrs + Esplora + RGB proxy [12].
  - Supported schemas are "NIA, CFA, IFA and …" [10]. The line was truncated at our grep, so the full list is unresolved.

### 3. The RGB split

- There are two incompatible lines.
  - **rgb-protocol v0.11.1** is backed by the RGB Protocol Association (founded 14 July 2025 by Bitfinex, Fulgur, Plan B, Boosty Labs, KaleidoSwap, ThunderStack/UTEXO, Tribe and LNFI) [15]. Bitfinex's R&D team, led by Federico Tenga, builds rgb-lib, the RGB Lightning Node and Iris [16].
  - **RGB-WG v0.12** is backed by LNP/BP and Maxim Orlovsky.
- rgb-protocol explains the fork as organisational and technical [17][18]. Its org profile calls v0.12 an "unfinished proposal to rewrite the protocol" [18].
- RGB-WG's rgb.tech replies that v0.11.1 is "a fork … with heavily modifications to the consensus". It advises users "NOT to use products built with version v0.11.1 … for any assets or purposes with any real value", and to check `cargo tree -i rgb-consensus` [19].
- Activity on GitHub:
  - `RGB-WG/rgb` and `RGB-WG/rgb-std`: last pushed July 2025. Their newest listed release is `v0.12.0-rc.2` (3 June 2025) [20].
  - `rgb-protocol/rgb-ops`: pushed 16 September 2026 [22].
  - The v0.11.1 side is where the active shipping is.
- **Tether and UTEXO build on rgb-protocol v0.11.1** [1][3].
- **Consequences for a third party bridging USD₮:**
  - Use the rgb-protocol crate family (rgb-lib / rgb-ops `0.11.1`, Apache-2.0 core, MIT rgb-lib). Assets and consignments are not interoperable with v0.12 tooling such as Bitlight [18][21].
  - Expect the rgb.tech camp to call the stack unsafe for real value [19]. That matters little for a testnet experiment.
  - rgb-lib's rc pin [9] means we'd depend on a pre-final consensus crate until rgb-lib moves to the final release.
  - Permissive licences (MIT / Apache-2.0) are compatible with depending on them from our AGPL `sidestr-*` crates. This is an inference; it needs the usual licence check.

### 4. Tether's terms for USD₮ on RGB

- **Tether has published no RGB-specific terms.**
  - The release [1] says nothing about freezing, redemption or KYC.
  - The general Token Terms (last updated 26 Feb 2026) govern purchase and redemption. They restrict services to eligible "Persons" and allow confiscation for ineligible users [28].
  - The supported-protocols page lists no RGB redemption rail [2].
- **Freeze capability is unresolved at the protocol level.**
  - The rgb-protocol `rgb-schemas` include a **PermissionedFungibleAsset (PFA)** schema. Every transfer must carry a signature checked against an issuer pubkey in global state. It is flagged "(!) Not safe to use in a production environment!" [23]. A PFA-type schema *could* give an issuer veto power; nothing says USD₮ uses it.
  - UTEXO's test "usdt" is an NIA asset [7]. NIA has no issuer control over transfers (inferred from the schema family).
  - UTEXO mentioned a new **"Bridged Fungible Asset"** standard "expected to ship as part of an upcoming RGB Lightning update" [3]. Its semantics, including any freeze feature, are unpublished.
  - A third-party comparison claims RGB issuers "can refuse transitions" [25]. That is secondary and inferred; the issuer can't block a client-side-validated transfer unless the schema requires its signature.
- **Redemption and compliance path in practice:**
  - The only documented path is UTEXO's **lock-and-mint bridge**. USDT (routed via USDT0/LayerZero to Arbitrum) is locked in an EVM contract and minted on RGB. Release requires an RGB **burn**, which three TEE federated signers (AWS Nitro) verify with in-enclave consignment validation and SPV [3][4][24].
  - So "USD₮ on RGB" as currently built is a bridge-backed representation redeemed against locked EVM USDT, not a direct Tether mint/redeem rail. Direct Tether redemption presumably happens on the EVM side under the general Terms (inferred).
  - For compliance, UTEXO cites a **Crystal Intelligence** integration; the remaining legal work was "in its final stage" [3]. We found no KYC requirement specific to minting through the bridge.

## Sources

### [1] Tether to Launch USD₮ on RGB, Expanding Native Bitcoin Stablecoin Support
URL: https://tether.io/news/tether-to-launch-usdt-on-rgb-expanding-native-bitcoin-stablecoin-support/
Retrieved: 2026-09-23
Status: verified
Found via: web-researcher/search_and_scrape
<untrusted-source url="https://tether.io/news/tether-to-launch-usdt-on-rgb-expanding-native-bitcoin-stablecoin-support/" retrieved="2026-09-23">
> 28 August, 2025 – Tether, the largest company in the digital assets industry, today announced plans to launch USD₮ on RGB, a next-generation protocol for issuing digital assets on Bitcoin.
> RGB recently reached mainnet with its 0.11.1 release …
> 23 September 2026 – Tether AI Research* today released QVAC Genesis III … 11 September, 2026 – Tether … acknowledged by the United States Department of Justice … 9 September 2026 – Tether … and Fasanara Capital … StableFund
</untrusted-source>

### [2] Supported Protocols and Integration Guidelines — Tether
URL: https://tether.to/en/supported-protocols/
Retrieved: 2026-09-23
Status: verified
Found via: web-researcher/search_and_scrape
<untrusted-source url="https://tether.to/en/supported-protocols/" retrieved="2026-09-23">
> Please note that Tether is no longer issuing or obligated to redeem Tether Tokens on the Kusama, Bitcoin Cash SLP, Omni Layer, EOS and Algorand blockchains.
> - TRC20 Token via Tron Blockchain - Liquid Asset via Liquid Blockchain - Solana Token via Solana Blockchain - Polkadot AssetHub (formerly Statemint) - Tezos Token via Tezos Blockchain - Near Token via Near Blockchain - Ton Jetton via Ton Blockchain - Fungible Asset via Aptos Blockchain
</untrusted-source>

### [3] UTEXO update: SDK, Bridge, Wallets & Live Demo (rgb.info, published 2026-08-07)
URL: https://rgb.info/utexo-rgb-sdk-bridge-community-call-demo/
Retrieved: 2026-09-23
Status: verified
Found via: perplexity (lead) → web-researcher/scrape_page
<untrusted-source url="https://rgb.info/utexo-rgb-sdk-bridge-community-call-demo/" retrieved="2026-09-23">
> This article is based on the RGB community call held on July 30, 2026 … with Renat Skitsan, CTO of Utexo
> A realistic, not committed, launch window for USDT on Bitcoin: end of summer to mid-September 2026.
> The bridge mints USDT on RGB using a trusted execution environment (TEE), not federation trust
> The browser-based RGB Lightning wallet: created live on signet … using a Telegram bot built for the dev experience, Renat requested test assets by asset ID
> Compliance: a recently announced Crystal Intelligence integration checks this box; remaining legal work is described as in its final stage.
> A new token standard, "Bridged Fungible Asset": developed primarily by the RGB Protocol team, expected to ship as part of an upcoming RGB Lightning update
> Unisat: … integration complete and currently in testing, expected to be a launch partner.
</untrusted-source>

### [4] UTEXO docs — Mint: Getting Started
URL: https://github.com/UTEXO-Protocol/docs/blob/main/mint/getting-started.mdx
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/UTEXO-Protocol/docs/blob/main/mint/getting-started.mdx" retrieved="2026-09-23">
> USDT from EVM, Tron, and Solana is supported — under the hood, it is routed through the USDT0 / LayerZero protocol to Arbitrum before being locked and minted as RGB USDT on Bitcoin.
> For now, the only tested and available route is Arbitrum (mainnet) to Bitcoin (Utexo signet). Bitcoin mainnet is not available yet.
> Signing authority is distributed across three independent Federated Signer Nodes, each running inside an AWS Nitro Enclave, using a threshold scheme
</untrusted-source>

### [5] UTEXO docs — Node Overview
URL: https://github.com/UTEXO-Protocol/docs/blob/main/overview.mdx
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/UTEXO-Protocol/docs/blob/main/overview.mdx" retrieved="2026-09-23">
> Utexo supports **on-chain RGB on mainnet** today. **Lightning is beta and testnet-only** for now.
> Canonical source repository: [UTEXO-Protocol/rgb-lightning-node](https://github.com/UTEXO-Protocol/rgb-lightning-node)
</untrusted-source>

### [6] UTEXO docs — SDK networks table, and endpoint list
URL: https://github.com/UTEXO-Protocol/docs/blob/main/product-suite/sdk.mdx (also product-suite/untitled-page.mdx)
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/UTEXO-Protocol/docs/blob/main/product-suite/sdk.mdx" retrieved="2026-09-23">
> | Mainnet | `mainnet` | `rpcs://rgb-proxy-mainnet.utexo.com/json-rpc` | `ssl://electrum.iriswallet.com:50003` |
> | Testnet | `testnet` | `rpcs://rgb-proxy-testnet3.utexo.com/json-rpc` | `ssl://electrum.iriswallet.com:50013` |
> | Utexo (Signet) | `utexo` | `rpcs://rgb-proxy.utexo.com/json-rpc` | `https://esplora-api.utexo.com` |
> The `utexo` identifier maps to the Utexo-operated signet environment. It is the default network for development and testing.
> (untitled-page.mdx) - **Testnet4:** `rpcs://proxy.iriswallet.com/0.2/json-rpc` … - **Testnet4:** `ssl://electrum.iriswallet.com:50053`
</untrusted-source>

### [7] UTEXO docs — Quickstart overview (asset IDs, network selection) and Mint API reference
URL: https://github.com/UTEXO-Protocol/docs/blob/main/getting-started/quickstart/overview.mdx
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/UTEXO-Protocol/docs/blob/main/getting-started/quickstart/overview.mdx" retrieved="2026-09-23">
> `listAssets()` returns assets grouped by schema. NIA assets are in `listAssets().nia`, and the identifier field is `assetId`.
> The documentation does not publish a hard-coded test asset ID because no canonical ID is committed in the SDK repositories.
> The hosted Web and React Native examples use the `utexo` network profile, which resolves to Utexo's signet infrastructure.
> (product-suite/mint-api-reference.mdx) **Base URL (testnet / dev):** `https://transfer.gateway.dev.utexo.com/api/v0` … Use `36` (mainnet) or `91` (testnet) for plain RGB, and `94` (mainnet) or `95` (testnet) for RGB Lightning.
</untrusted-source>

### [8] UTEXO docs — Quickstart (faucet)
URL: https://github.com/UTEXO-Protocol/docs/blob/main/getting-started/quickstart.mdx
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/UTEXO-Protocol/docs/blob/main/getting-started/quickstart.mdx" retrieved="2026-09-23">
> Get testnet BTC from the Utexo Telegram faucet bot [@Utexo_RLN_bot](https://t.me/Utexo_RLN_bot) — send `/getbtc` followed by your Bitcoin address.
</untrusted-source>

### [9] rgb-lib Cargo.toml (master)
URL: https://github.com/RGB-Tools/rgb-lib/blob/master/Cargo.toml
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/RGB-Tools/rgb-lib/blob/master/Cargo.toml" retrieved="2026-09-23">
> version = "0.3.0-beta.7"
> rust-version = "1.94.0"
> bdk_wallet = { version = "=3.1.0" …
> rgb-ops = { version = "=0.11.1-rc.11" …
> default = ["electrum", "bdk_file_store_migration"]
> all = ["electrum", "esplora", "bdk_file_store_migration"]
</untrusted-source>

### [10] crates.io — rgb-lib
URL: https://crates.io/api/v1/crates/rgb-lib
Retrieved: 2026-09-23
Status: verified
Found via: github (crates.io API)
<untrusted-source url="https://crates.io/api/v1/crates/rgb-lib" retrieved="2026-09-23">
> "max": "0.3.0-beta.7" … { "num": "0.3.0-beta.7", "created_at": "2026-07-17T14:11:24Z", "rust_version": "1.88.0", "license": "MIT" }
</untrusted-source>
(Also github: repo licence `MIT`, pushed 2026-09-18. `src/lib.rs` line 9: "They allow to create and operate RGB wallets that can issue and operate on NIA, CFA, IFA and"; truncated at our grep.)

### [11] rgb-lib src/utils.rs at tag 0.3.0-beta.7 — BitcoinNetwork
URL: https://github.com/RGB-Tools/rgb-lib/blob/0.3.0-beta.7/src/utils.rs
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/RGB-Tools/rgb-lib/blob/0.3.0-beta.7/src/utils.rs" retrieved="2026-09-23">
> /// Bitcoin's testnet4
> Testnet4,
> /// Bitcoin's default signet
> Signet,
> /// Bitcoin's custom signet
> SignetCustom,
> "testnet4" => BitcoinNetwork::Testnet4,
> BitcoinNetwork::Testnet4 => bitcoin::Network::Testnet4,
</untrusted-source>

### [12] rgb-lib README
URL: https://github.com/RGB-Tools/rgb-lib
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/RGB-Tools/rgb-lib" retrieved="2026-09-23">
> This command will run a [bitcoind] node, three [electrs] nodes, one [esplora] node and three [RGB proxy] instances, in order to perform integration tests in a regtest environment.
> N.B.: this library is still a work in progress and in its testing phase.
</untrusted-source>

### [13] UniSat Is the Next Launch Partner for USDT on Bitcoin (rgb.info, 2026-09-04)
URL: https://rgb.info/unisat-usdt-bitcoin-launch-partner/
Retrieved: 2026-09-23
Status: verified
Found via: perplexity (lead) → web-researcher/scrape_page
<untrusted-source url="https://rgb.info/unisat-usdt-bitcoin-launch-partner/" retrieved="2026-09-23">
> What's coming: sending, receiving and swapping USDT on Bitcoin inside UniSat Wallet. No release date has been given yet.
> As of this writing, neither Utexo's nor UniSat's own documentation reference the integration yet.
</untrusted-source>

### [14] RGB Lightning Is Now in Tether's WDK (rgb.info, 2026-08-28)
URL: https://rgb.info/rgb-lightning-tether-wdk/
Retrieved: 2026-09-23
Status: verified
Found via: perplexity (lead) → web-researcher/scrape_page
<untrusted-source url="https://rgb.info/rgb-lightning-tether-wdk/" retrieved="2026-09-23">
> Utexo added on-chain RGB support to WDK in February 2026, and this module adds the Lightning side. A demo video shows it working between two test wallets
> The module is still an early beta.
</untrusted-source>

### [15] RGB v0.11.1 Goes Live on Bitcoin Mainnet (rgb.info, 2025-07-16)
URL: https://rgb.info/rgb-v0-11-1-bitcoin-mainnet-launch/
Retrieved: 2026-09-23
Status: verified
Found via: perplexity (lead) → web-researcher/scrape_page
<untrusted-source url="https://rgb.info/rgb-v0-11-1-bitcoin-mainnet-launch/" retrieved="2026-09-23">
> ThunderLink — A REST API for RGB asset transfers … (ThunderStack has since rebranded as Utexo.)
> Iris Wallet — A privacy-focused wallet for managing Bitcoin and RGB tokens locally
> Bitmask by DIBA — a non-custodial RGB wallet and marketplace … (now live on mainnet)
> On July 14, 2025, the RGB Protocol Association was officially founded … Founding members include Bitfinex, Fulgur Ventures, Plan B Network, Boosty Labs, Kaleidoswap, ThunderStack (now Utexo), Bitcoin Tribe, and LNFI.
</untrusted-source>

### [16] Will USDt-on-RGB accelerate RGB Adoption? (Bitfinex blog, 2026-07-17)
URL: https://blog.bitfinex.com/industry-news/will-usdt-on-rgb-accelerate-rgb-adoption/
Retrieved: 2026-09-23
Status: verified
Found via: perplexity (lead) → web-researcher/scrape_page
<untrusted-source url="https://blog.bitfinex.com/industry-news/will-usdt-on-rgb-accelerate-rgb-adoption/" retrieved="2026-09-23">
> While Tether itself has yet to confirm an official launch date, Viktor Ihnatiuk, co-founder of UTEXO … recently suggested that moment could now be imminent.
> Bitfinex has a dedicated RGB development team led by Federico Tenga … These include rgb-lib, the RGB Lightning Node, Iris Wallet
> KaleidoSwap … executed the first atomic swap of an RGB asset on Lightning mainnet in September 2025, trading a USDt-backed RGB20 token bridged through UTEXO. The software remains in alpha
</untrusted-source>

### [17] The rgb-protocol organization and RGB 0.11.1 (MOTIVATIONS.md)
URL: https://github.com/rgb-protocol/.github/blob/main/MOTIVATIONS.md
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/rgb-protocol/.github/blob/main/MOTIVATIONS.md" retrieved="2026-09-23">
> A decision to join efforts and focus on the completion of version 0.11.1 has been made but unfortunately collaboration turned out to be harder than expected … a new organization called rgb-protocol has been created in order to provide access to the completed work on version 0.11.1.
</untrusted-source>

### [18] v0.11.1 vs v0.12 - Don't trust, verify (WHY_v0.11.1.md) and org profile
URL: https://github.com/rgb-protocol/.github/blob/main/WHY_v0.11.1.md
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/rgb-protocol/.github/blob/main/WHY_v0.11.1.md" retrieved="2026-09-23">
> Date: **2025-07-23**
> essential features critical for **schema expressiveness and privacy** capabilities, such as multiple transitions per contract and concealed transitions, were removed in v0.12
> (profile/README.md) RGB v0.12 (unfinished proposal to rewrite the protocol, promoted by the owner of the RGB-WG organization)
</untrusted-source>

### [19] rgb.tech — statement on the v0.11.1 fork
URL: https://rgb.tech/blog/on-rgb-fork-by-bitfinex/
Retrieved: 2026-09-23
Status: verified
Found via: web-researcher/search_and_scrape
<untrusted-source url="https://rgb.tech/blog/on-rgb-fork-by-bitfinex/" retrieved="2026-09-23">
> runs a fork of RGB v0.11 from unreleased last year codebase, with heavily modifications to the consensus, affecting its security.
> the only version recommended by us for the production is v0.12 from https://github.com/RGB-WG organization.
> Companies may check … by running cargo tree -i rgb-consensus
> We also advise users NOT to use products built with version v0.11.1 and modified consensus for any assets or purposes with any real value.
</untrusted-source>

### [20] RGB-WG repositories — activity and releases
URL: https://github.com/RGB-WG/rgb/releases
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/RGB-WG/rgb/releases" retrieved="2026-09-23">
> RGB-WG/rgb: licence Apache-2.0, pushed_at 2025-07-20T18:33:28Z; releases: v0.12.0-rc.2 (2025-06-03), v0.12.0-rc.1.1 (2025-05-27)
> RGB-WG/rgb-std: pushed_at 2025-07-15T12:03:51Z; releases: v0.12.0-rc.2 (2025-06-03)
</untrusted-source>
(gh api output, not page prose. A perplexity snippet says `RGB-WG/rgb-core` tagged a final `v0.12.0` on 2025-07-10; we haven't checked that tag.)

### [21] RGB v0.12 consensus release (rgb.tech) and the two-line comparison (X, @zijing)
URL: https://rgb.tech/blog/release-v0-12-consensus/ ; https://x.com/zijing/status/2084244643231711262
Retrieved: 2026-09-23
Status: inferred
Found via: perplexity (snippets only; pages not opened)
<untrusted-source url="https://rgb.tech/blog/release-v0-12-consensus/" retrieved="2026-09-23">
> LNP/BP Standards Association presents the final production-ready release of the consensus layer for the new generation of RGB smart contracts (version 0.12).
</untrusted-source>
(The X post, per snippet, names Bitlight Labs / Bitlight Wallet / Bitlight RLN as the v0.12-side products. We couldn't open it; treat as a lead.)

### [22] RGB Protocol v0.11.1 update: Core Libraries Drop the RC Tag (rgb.info)
URL: https://rgb.info/rgb-protocol-v0-11-1-core-libraries-update/
Retrieved: 2026-09-23
Status: verified
Found via: web-researcher/search_and_scrape; corroborated by github (`rgb-protocol/rgb-ops` release `0.11.1`, 2026-09-16T15:22:37Z)
<untrusted-source url="https://rgb.info/rgb-protocol-v0-11-1-core-libraries-update/" retrieved="2026-09-23">
> Five core libraries (rgb-aluvm, rgb-consensus, rgb-ops, rgb-schemas, rgb-api) are now at 0.11.1, no longer marked as test versions (September 16, 2026).
</untrusted-source>

### [23] rgb-schemas — Permissioned Fungible Assets (PFA) schema
URL: https://github.com/rgb-protocol/rgb-schemas/blob/master/src/pfa.rs
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/rgb-protocol/rgb-schemas/blob/master/src/pfa.rs" retrieved="2026-09-23">
> //! Permissioned Fungible Assets (PFA) schema.
> //! (!) Not safe to use in a production environment!
> // Check transition signature
> ldc     GS_PUBKEY,a32[0],s16[0];  // get global pubkey
> vts     s16[0];  // verify signature
</untrusted-source>

### [24] UTEXO docs — Mint (security model)
URL: https://github.com/UTEXO-Protocol/docs/blob/main/product-suite/mint.mdx
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/UTEXO-Protocol/docs/blob/main/product-suite/mint.mdx" retrieved="2026-09-23">
> Before co-signing any `FundsOut` transaction, each Federated Signer Node validates the RGB consignment inside the enclave — confirming the burn amount and commission against the calldata.
> Burn replay protection. The TEE extracts a `burnId` from each RGB consignment before signing.
</untrusted-source>

### [25] ERC-20, SPL, Taproot Assets, and RGB Compared (Spark research)
URL: https://www.spark.money/research/stablecoin-token-standard-comparison
Retrieved: 2026-09-23
Status: inferred
Found via: perplexity (snippet only; page not opened)
<untrusted-source url="https://www.spark.money/research/stablecoin-token-standard-comparison" retrieved="2026-09-23">
> |Address freezing|On-chain mapping|Freeze authority|Issuer can refuse proofs|Issuer can refuse transitions|Issuer-level controls|
</untrusted-source>

### [27] UTEXO-Protocol GitHub — WDK RGB modules
URL: https://github.com/UTEXO-Protocol/wdk-rgb-lightning
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/UTEXO-Protocol/wdk-rgb-lightning" retrieved="2026-09-23">
> WDK module for RGB Lightning — wraps rgb-lightning-node via @utexo/rgb-lightning-node-bare, integrates with WDK secret-manager + external-signer. (licence Apache-2.0, pushed 2026-09-23T05:34:45Z)
> UTEXO-Protocol/wdk-wallet-rgb (licence Apache-2.0, pushed 2026-08-10T16:56:13Z)
</untrusted-source>

### [28] Tether — Legal (Token Terms of Sale and Service)
URL: https://tether.to/en/legal/
Retrieved: 2026-09-23
Status: verified
Found via: web-researcher/search_and_scrape
<untrusted-source url="https://tether.to/en/legal/" retrieved="2026-09-23">
> Last updated: February 26, 2026
> Only Persons (as defined below) who meet the requirements of these Terms are permitted to access the Site or use the Services. Any Person who is not eligible that utilizes the Services … may have any Fiat, Digital Tokens … confiscated.
</untrusted-source>

## Open questions

1. **No Tether-issued mainnet USD₮ RGB contract ID exists publicly.** Watch tether.io/news, tether.to/en/supported-protocols and the `UTEXO-Protocol/docs` repo for the first canonical asset ID and schema.
2. **Which schema will production USD₮ use?** Options are NIA, PFA-style permissioned, or the unreleased "Bridged Fungible Asset". The answer decides whether freeze/blacklist exists on RGB. We found no primary spec for BFA.
3. **Is the RGB side issued by Tether or by UTEXO?** On the current lock-and-mint design [4][24], the RGB token is a UTEXO-bridge claim on locked EVM USDT0. Whether Tether will treat it as its own redeemable USD₮ (and list it at [2]) is unconfirmed.
4. **Test-network mint economics:** the demo route locks real Arbitrum-mainnet USDT and mints on UTEXO signet [4]. Is there a pure-testnet EVM → testnet RGB route (network IDs 91/95 on the dev gateway [7]) that needs no real funds? Not verified end to end.
5. **rgb-lib version pinning:** rgb-lib still pins `=0.11.1-rc.11` [9]. When does a release move to final `0.11.1` with the MSRV bump to 1.94 [9]?
6. **testnet4 USD₮ test asset:** rgb-lib and public Iris infrastructure support testnet4 [6][11]. UTEXO's USDT test flow, however, targets its own signet [6][7]. A testnet4 experiment would issue its own NIA stand-in rather than use a UTEXO test asset.
7. **Full list of schemas rgb-lib supports** (UDA? PFA?): truncated in our read of `src/lib.rs` [10].
