# Wrapping USD₮ or USDC into sidestr as an experiment

Slug: `stablecoin-wrap-experiment` · Date: 2026-09-23 · Tier: deep (five researchers plus lead verification, one round) · Decision record: `ADR-2113` (proposed)

## Bottom line

No issuer-backed USD₮ or USDC exists on any Bitcoin test network the estate could use, and USD₮ on RGB is not yet live on Bitcoin mainnet: UTEXO's own documentation says the only tested route runs from Arbitrum mainnet into UTEXO's private signet [4], and Tether's supported-protocols page lists no RGB entry [2]. The experiment should therefore wrap a clearly labelled, valueless test dollar-unit that the estate issues itself, first as a mock asset on a new sidestr chain using the upstream `assets` rule (days) [321]. The second step is our own RGB20 asset on testnet4, bridged through an isolated rgb-lib process into a chain carrying a new `bridge` rule (weeks) [312]. Real USD₮ on RGB and Liquid USDt stay watch items with explicit revisit triggers; nothing in this plan locks a real stablecoin.

## 1. What exists today, and what changed since 21 September

**USD₮ on RGB is announced, bridged and not live.** Tether's release of 28 August 2025 announces plans to launch USD₮ on RGB on the RGB 0.11.1 line [1]. Tether's supported-protocols page, read on 23 September 2026, lists ERC-20 chains, Tron, Liquid, Solana and others but no RGB or Bitcoin entry [2]. UTEXO's CTO gave a "realistic, not committed" window of end of summer to mid-September 2026 on the 30 July community call [3]. That window has passed: on 4 September UTEXO named UniSat as the next launch partner with no release date [13]. UTEXO's mint documentation states: "For now, the only tested and available route is Arbitrum (mainnet) to Bitcoin (Utexo signet). Bitcoin mainnet is not available yet." [4]. The route locks USDT on an EVM chain and mints on RGB, with signing distributed across three federated signer nodes in AWS Nitro enclaves [4]. So what is called USD₮ on RGB today is a bridge-backed representation redeemed against locked EVM USDT, not a direct Tether mint (inference from [4]). No canonical issuer contract ID has been published [7].

**The RGB line matters.** The ecosystem is split between rgb-protocol v0.11.1, which Tether and UTEXO build on [1][3][17], and RGB-WG v0.12 [18][20]. RGB-WG's own site says: "We also advise users NOT to use products built with version v0.11.1 and modified consensus for any assets or purposes with any real value." [19]. The five rgb-protocol core crates dropped their release-candidate tag on 16 September 2026 [22], but rgb-lib 0.3.0-beta.7 still pins `=0.11.1-rc.11` [9].

**USD₮ on Taproot Assets is announced; go-live is unconfirmed.** Tether and Lightning Labs announced it on 30 January 2025 [100][101]. The only claim of a 21 March 2026 go-live is a secondary site that cites no primary source [110]. The mainnet universe lists at least eight distinct assets named USDT, which shows a name is no authority [108].

**Liquid USDt is real, and Liquid had a peg exploit on 6 September 2026.** Tether has supported Liquid since 2019 [117]. The Block reports that the bug lay in "the caching of range proof verifications in Elements", that about 4,000 LBTC was created without backing and pegged out through SideSwap's peg-out authorisation key, that no keys were compromised, that roughly 3,400 BTC came back on 7 September and about 598.5 BTC did not, and that peg-outs remain disabled [600]. Halborn, independently, describes the same mechanism: unbacked L-BTC minted and then swapped for BTC through the legitimate peg-out process [601]. Liquid published its own incident report [602]. Blockstream's status page calls USDT unaffected by the exploit itself but says bridge nodes were disabled and the sidechain effectively paused [115].

**Circle issues USDC natively on no Bitcoin layer.** Its list of 38 native chains, dated 16 September 2026, contains no Bitcoin, Lightning, Liquid, Taproot Assets or RGB entry [120]. Circle's multichain page gives the same count of 38 networks [119]. USDC reaches Taproot Assets only as a third-party bridged asset [102].

**No issuer test asset exists on a Bitcoin test network.** No Tether test USD₮ was found on testnet4, signet or Liquid testnet; the "PEGx USDt Testnet" asset on Liquid testnet is a third party's, not Tether's [118]. Anyone can issue their own test asset with tapd on testnet4 or signet [107] or on Liquid testnet [114], and rgb-lib supports testnet4 [11][305].

**What changed since the PRD-024 fact base of 21 September** [603]: the UTEXO launch window lapsed without a launch [13]; the rgb-protocol core crates went final while rgb-lib stayed on the release candidate [22][9]; UTEXO's route was confirmed as lock-and-mint into its own signet [4]; the Liquid peg exploit happened [600][601]; a licence flag appeared in rgb-lib's dependency graph (section 5) [421]; the upstream `assets` rule has run on `sidestr:tally` since 18 September [319]; electrs v0.12.0 shipped testnet4 support on 13 September [311]; the FCA finalised its perimeter guidance on 16 September [403]; and the sidestr crates moved to DreamLab-AI/sidestr-rs with the bridge crate still unplaced [605]. The research pack's R1 to R4 treated RGB as a spec gap and a re-sequencing question rather than a route; none of them checked test-network availability (inference from [603]).

## 2. Our stack, as it stands

- **`sidestr:dreamlab` cannot carry assets.** Its chain document names no `rules` and has `pegs: []` [324]. A change to a sealed field is a new chain with a new genesis [325]. The experiment needs a new chain (inference).

- **The upstream `assets` rule works, but cannot wrap.** It issues with `issue:<TICKER>:<decimals>`, conserves per asset and destroys what a spend fails to tally [319]. The upstream rules test passed 31 of 31 locally at 722ad42 [321]. An issued asset's identity is its issuing txid and its supply is fixed at issue, so a second deposit cannot mint more of the same asset [312]. The only spend builder makes plain, peg-out and EVM spends, with no `issue` or `tally` verb [323]. Issuance is a raw transaction posted to the producer [322].

- **The Rust crates refuse any rule-bearing chain.** `ChainDocument::validate` rejects a chain naming a rule [326]. The crate docs say a document naming `assets`, `pool` or `evm` is refused [327]. The extension point for a port is the `BlockRule` trait [329].

- **rgb-lib fits the isolated-process design.** Its network enum includes testnet4 [304]. It ships a testnet4 online test against a public Electrum server [305]. It exposes NIA issuance and transfer as public Rust API [308]. It accepts consignments out of band with no proxy server [307]. It needs an Electrum or Esplora indexer [303]. None answers on the estate's testnet4 node [301], which runs Bitcoin Core 30.3 with `txindex` [300]. electrs v0.12.0 supports testnet4 [311].

- **tapd needs LND.** Taproot Assets requires lnd v0.20.0-beta or later [316]. The estate runs Core Lightning, so this route adds two daemons (inference from [316]).

## 3. Routes compared

| Route | What it wraps | Time to first result (researcher D estimate) | Proves | Cannot prove | Blockers |
|---|---|---|---|---|---|
| A. Mock asset, upstream `assets` rule, new chain | A unit we issue on the sidechain itself | 2 to 4 days | Consensus issue, transfer and burn of a labelled dollar-unit; wallet, URN and Nostr surfaces | Backing, bridging, RGB or reissuance | A new chain is needed; Rust followers refuse it |
| B. Own RGB20 NIA asset on testnet4, isolated rgb-lib bridge, `bridge` rule | An RGB asset we issue on testnet4, held in bridge custody | 2 to 3 weeks | The `ADR-2102` ratification path end to end; burn before release; the supply invariant | That validators check RGB state (they check attestations); anything about Tether's terms | An indexer for the node; the `bridge` rule is a spec fork or an upstream proposal; rgb-lib is pre-release |
| C. Own Taproot Asset on testnet4 via tapd | A Taproot Asset we mint | 3 to 4 weeks or more | The bridge rule is origin-agnostic | Anything about USD₮ on RGB | LND plus tapd plus a Core ZMQ change |
| D. Liquid testnet asset | A Liquid test asset we issue | not scoped | Wrapping from an Elements chain | Nothing about our testnet4 parent | Liquid peg operations suspended |
| E. Real USD₮ on RGB | Tether's asset | not available | The owner's original question | | Not live on mainnet; no test asset; the legal gate |

Sources for the table, one per claim. Route A: the rules test proves issue, transfer and burn by omission [321]. The `assets` rule cannot reissue [312]. The estate chain `sidestr:dreamlab` is sealed without rules [324]. Rust followers refuse a rule-bearing chain [326].

Route B: rgb-lib issues NIA assets through public API [308]. No indexer answers on the node [301]. The rgb-lib crate is a pre-release beta [9]. On-chain RGB transfers expose no token or amount, so validators check attestations, not RGB state [234].

Route C: tapd needs lnd [316]. Its configuration offers testnet4 as a network [314]. Tether's announcement takes USD₮ to RGB [1].

Route D: anyone can issue on Liquid testnet [114]. Peg operations were suspended as of 10 September [115].

Route E: UTEXO's route does not reach Bitcoin mainnet [4]. No canonical test asset ID is published [7]. Wrapped tokens are not Tether Tokens [410].

Routes A and B are the ones that fit the owner's constraints: own sidestr chains as the only instrument, assets bridged in, testnet first [604].

## 4. The `bridge` rule: what the design research supports

`ADR-2102` already commits to a versioned `bridge` rule, asset identity equal to the origin contract id, unique reserve allocations, burn first and release second after `ADR-2101` finality, and wrapped supply equal to held reserve with pending redemptions as liabilities [200]. Its review amendments leave the attestation format, the signer and what validators check open [201]. The prior art narrows those choices (all design points below are inferences from the cited sources).

1. **Records keyed by origin network and reserve outpoint.** Upstream already binds each peg-in claim to one parent outpoint and treats a second claim of it as invalid [202]; Circle's CCTP does the same with a used-nonce map keyed by source domain [215]. A `bmint` record keyed by origin network plus reserve `txid:vout` gives replay protection with no new nonce space. UTEXO's own mint does the equivalent on its side, extracting a burn id from each consignment before signing [24].
2. **A declared confirmation depth.** Liquid waits 102 Bitcoin confirmations before a peg-in claim [111][218], Rootstock 100 [220], WBTC 6 [223]. A `bridgeConfirmations` parameter in the chain document plays that role for the RGB anchoring transaction.
3. **Mint authority as a coin.** Liquid gates reissuance on a reissuance token that can itself be multisig [219][113]; Taproot Assets orders supply commitments by spending each prior output [226]. An authority coin whose key is the k-of-n attestation key makes every mint, halt and rejection spend and recreate it, so script validation checks the threshold, mints are totally ordered and replay needs a double-spend. Wormhole minted 120,000 wETH after its verifier accepted a forged input [208], which is why the rule must check the signature itself against a key pinned in the chain document.
4. **Burn, pending, release or reject.** WBTC burns, waits for finality and then releases [224]; sBTC keeps a non-transferable pending placeholder and has an explicit reject path that returns the funds [221]. `bburn` moves units to pending; `brelease` closes the redemption only after `ADR-2101`'s `FINALISE_BLOCK` certificate [207]; `breject` re-credits the burner; validators publish any burn not settled within a declared window, as upstream does for peg-outs [203].
5. **A halt switch.** A signed `bhalt` stops new mints and releases for an asset while leaving wrapped units transferable and visibly impaired. Multichain showed that an issuer freeze protects the issuer's token, not the wrapper's holders [232][233].
6. **Supply identity checked by every validator.** Circulating plus pending equals minted minus released, checked at every block, fail-closed. A validator without an origin view can still check this bookkeeping; only a level-2 validator can check depth and unspentness of reserve outpoints, and none can check RGB amounts without client-side validation, because an RGB transfer shows no token, amount or recipient on chain [234].
7. **Independent attesters, not one bridge key.** Ronin fell when five of nine validator keys were taken, and nobody noticed for six days [211][213]; 65.8% of stolen bridge value came from permissioned networks with unsecured key operations [213]. Attestation should be k-of-n over independently operated attesters, each running its own rgb-lib validation, with periodic reserve snapshots proved by an unspendable PSBT in the style of Blockstream's proof-of-reserves tool [219][235].
8. **The Liquid lesson.** No Liquid key was compromised; unbacked supply was minted by a validation bug and then paid out through the legitimate peg-out path [600][601]. Key security is therefore not enough: an independent reserve-versus-supply check has to pass before any payout (inference).

## 5. Naming, disclaimers, regulation and licences

**Naming.** Tether's terms forbid use of its marks without prior written permission, "in meta data or code, or in any other manner" [410]. Circle's terms forbid use of its marks without prior written consent [411]. Circle's documentation labels a non-Circle bridged token with a different ticker, `USDC.e` [412]. The test asset's ticker and contract metadata should contain none of USDT, USD₮, Tether or USDC (inference from [410][411][412]).

**Disclaimer model.** Circle's testnet wording is: "Testnet tokens have no financial value." [412]. A disclaimer on the same pattern belongs in the README, the chain document comment and the wallet UI: testnet only, no value, not redeemable, not USD₮ or USDC, not issued, backed or endorsed by Tether or Circle, do not send mainnet assets (drafted by researcher E, inference).

**Issuer terms already disclaim wrappers.** Tether says wrapped or bridged tokens "are not Tether Tokens" and cannot be redeemed with Tether [410]. Circle says "Bridged USDC is not USDC" and that Circle does not issue or redeem it [413].

**UK regime.** The FCA regime starts on 25 October 2027 and its application window runs from 30 September 2026 to 28 February 2027 [400]. The regulations were passed by Parliament on 4 February 2026, and PS26/10 covers stablecoin issuance [401]. A cryptoasset is a cryptographically secured digital representation of value or contractual rights [404], and a qualifying stablecoin involves holding backing assets to maintain its value [403]. PERG 18 gives no guidance on test tokens [403]. A token that is unbacked, unredeemable, unpriced and held inside the estate arguably represents no value and cannot be a qualifying stablecoin; locking even a nominal amount of real USD₮ or USDC changes that analysis (inference from [403][404][406], for counsel). The financial-promotion restriction reaches communications that are capable of having an effect in the UK, and a breach is a criminal offence [407]. The FCA sandbox is not regulatory exempt and is closed to new crypto applications [409].

**EU.** MiCA Art. 48 lets only the issuer, or others with its written consent, offer an e-money token to the public [415]; USDC is issued as an EMT by Circle France [416]. Publishing code is not an offer to the public (inference from [415], for counsel).

**Licences.** rgb-lib is MIT and the RGB protocol crates are Apache-2.0 [419][420], but `base85` 2.0.0 in rgb-lib's graph is declared `MPL-2.0-no-copyleft-exception` on crates.io [421]. Exhibit B of the MPL removes the route that lets MPL code join a GPL-family larger work [422][423], and the sidestr crates are AGPL-3.0-only, whose section 13 source offer covers network users of a modified version [425]. `ADR-2102` already keeps rgb-lib in its own process [312]; that boundary now has a licence reason as well as an engineering one (inference).

**Ontology.** The estate's corpus models a wrapped token as requiring a mint-burn mechanism and a custodian [501]. It models proof of reserves as requiring custody and transparency [504]. Its USDT class lists Tron, Solana and Ethereum and no Bitcoin layer [510]. The stablecoins-on-Bitcoin class, by contrast, names Taproot Assets, Liquid and RGB [500]. That is a candidate governed enrichment, not made in this run.

## 6. Recommended phased experiment

**Phase 0: mock asset on route A (2 to 4 days).** Create a new chain rather than editing the sealed `sidestr:dreamlab` [325]. Give it `rules: ["assets"]` and a comment stating the asset is unbacked and not USD₮ or USDC [319]. Issue a test dollar-unit with a neutral ticker such as `TDLUSD`, transfer it between two did:nostr-held keys, show an over-assignment refused and a burn by omission, and reopen from the block file (the shape of the upstream test [321]). This exercises wallets, agents, the asset URN and Nostr announcements without any bridge. Rust followers refuse such a chain today [326]. The port is a `BlockRule` implementation [329].

**Phase 1: real RGB wrap on route B (2 to 3 weeks).** Build an unpublished `sidestr-bridge` binary on rgb-lib against testnet4, and issue our own NIA asset from an issuer wallet [308]. Send it to a bridge wallet with out-of-band consignment [307]. Have attesters validate and sign, mint the wrapped unit on a chain carrying the `bridge` rule of section 4, and transfer it. Then burn, wait for the `FINALISE_BLOCK` certificate [207], and send the RGB asset back for the issuer wallet to validate. This is `ADR-2102`'s ratification evidence [312]. It needs an indexer, and a public testnet4 Electrum server is enough to start [305]. A local electrs can follow if the owner approves a new process beside the testnet4 node [311].

**Watch items, with revisit triggers.**

| Watch item | Revisit when |
|---|---|
| USD₮ on RGB | Tether lists RGB on its supported-protocols page [2], or a canonical issuer contract ID is published [7], or a Tether or UTEXO test asset appears on testnet4 or signet [6] |
| rgb-lib line | An rgb-lib release pins final 0.11.1 [9][22], or rgb-lib adopts the v0.12 line [18] |
| Liquid USDt | Liquid peg-outs are restored and a post-mortem is published [115][600] |
| USD₮ on Taproot Assets | Tether or Lightning Labs publishes a primary go-live statement with an asset ID or group key [101][103] |
| USDC | Circle lists a Bitcoin layer among its native chains [120] |

## 7. Risks

- **A bridge that mints without backing.** Wormhole and Nomad both minted against inputs the verifier should have refused [208][210], and Liquid's exploit was a validation bug, not a key theft [600]. The supply identity and the authority-coin signature check are the controls (inference).
- **Operator concentration.** Ronin's threshold was met by keys largely under one company's control [211][213]; with one estate operating every attester, k-of-n buys process isolation, not independence (inference).
- **Pre-release dependencies.** rgb-lib's 0.3.0 line is pre-release and pins a release-candidate consensus crate [9][303]; the other RGB camp warns against v0.11.1 for real value [19].
- **Label leakage.** On-chain metadata is permanent and indexers copy it; a ticker that mimics USDT cannot be withdrawn later (inference from [410]).
- **Scope creep into custody.** Accepting a real deposit, from anyone, moves the activity towards safeguarding and possibly issuance [404][403] (inference, for counsel).
- **Testnet reorgs.** A reorg after mint on a test parent is a declared failure mode, handled by `bhalt` and the visible shortfall (inference from [202][218]).

## 8. What is not known

- Whether production USD₮ on RGB will use NIA, a permissioned schema such as PFA, or the unpublished "Bridged Fungible Asset" standard, and so whether an issuer freeze exists on RGB [3][23][7].
- Whether rgb-lib's Esplora client works against mempool.space's testnet4 API; nothing here tested it [310].
- Whether upstream would accept a `bridge` rule or a non-coinbase mint path, given the `assets` rule's coinbase restriction [205][206].
- How the on-chain asset id should reconcile `ADR-2102`'s URN with upstream's `<origin chain id>:<origin asset id>` form [200][205].
- Whether a full `bmint` record fits the 255-byte record limit [206].
- Liquid's peg-out restoration date and whether the shortfall is covered [115][600].
- Whether `base85`'s SPDX declaration has legal effect without per-file Exhibit B notices [421].

## 9. Questions for counsel

From researcher E's legal pass [410][411][403][404][407][415][421][425]:

1. Is a token that is unbacked, unredeemable and testnet-anchored, issued by DreamLab only to itself or to invited testers, a cryptoasset under FSMA s.417 or MLR reg. 14A? Does inviting external testers change the answer [404]?
2. At what point does backing with real mainnet USD₮ or USDC, even a nominal amount, make DreamLab a custodian wallet provider now, or a person safeguarding or issuing a qualifying stablecoin [403]? Should DreamLab file in the window that opens on 30 September 2026 as a precaution [400]?
3. Would public README, blog or Nostr material describing the experiment be a financial promotion, and what wording keeps it outside [407]?
4. Can USDT, USD₮, Tether or USDC appear in tickers, metadata or documentation, including nominatively, and should written consent be sought [410][411]?
5. Is Tether's automatic-assignment clause for "Prohibited Assets" enforceable under English law against a UK entity [410]?
6. Does DreamLab bear MiCA exposure if EU parties run its open-source bridge [415]?
7. Is the `base85` declaration effective without per-file notices, and is process separation between rgb-lib and the AGPL crates a sufficient boundary [421][422]?
8. Under AGPL section 13, which users interact with a federation bridge remotely, and what source offer is adequate for a containerised deployment [425]?

## Appendix A: integrity gates

Command: `node skills/deep-research/scripts/research-gates.mjs --slug stablecoin-wrap-experiment --strict`, run in the agentbox worktree on 2026-09-23 over this brief and the seven `stablecoin-wrap-experiment-research-*.md` evidence files. Receipt: `docs/research/stablecoin-wrap-experiment-gates.json`.

| Run | Result |
|---|---|
| First draft | `19 fail, 0 warn` (strict). All `R030`: sentences whose citations all sat on one registrable domain, mostly github.com, where rgb-lib, sidestr and agentbox all live. No `R010`, `R011`, `R020`, `R021`, `R040` or `R050` finding. |
| After surgical splits | `7 fail`: four `R022` (listed sources left uncited after the splits) and three `R030`. |
| Final | `PASS, 0 fail, 0 warn` (strict), `104 sources, 7 notes, 164 per-source excerpts`. |

The `R030` fixes split compound citations so that each sentence cites the one source for its fact; no source was added to manufacture corroboration. The routes table carries no citations; the sentences below it cite each cell's claim.

**Single-source claims, flagged honestly.** Each of these rests on one origin and is marked as such where it appears: UTEXO's route and signer model (UTEXO's own documentation, `[4]`); the absence of RGB from Tether's supported protocols (Tether's own page, `[2]`); the 21 March go-live claim for Taproot Assets (one secondary site, `[110]`, treated as unresolved); the Liquid incident's cause and figures rest on two independent publishers (`[600]`, `[601]`) plus the operator's status page (`[115]`), so that finding is not single-source.

## Appendix B: live quote spot-checks

`web-researcher` `verify_citation` with the quoted text as the claim, 2026-09-23:

| Source | Quote checked | Result |
|---|---|---|
| `[4]` UTEXO mint docs | the Arbitrum-to-signet route sentence | live, addressed |
| `[19]` rgb.tech | the advice against v0.11.1 for real value | live, addressed |
| `[412]` Circle docs | Testnet tokens have no financial value | live, addressed |
| `[413]` Circle bridged terms | Bridged USDC is not USDC | live, addressed |
| `[600]` The Block | the range-proof caching cause | addressed (tool saw HTTP `403` on the liveness probe but fetched the text; the writer also read it with WebFetch) |
| `[410]` Tether terms | not Tether Tokens; the marks clause | tool reported partial coverage on a very long page; a direct `curl` and grep found both phrases verbatim, once each |

Retraction check: no cited source is a journal article with a DOI except the SoK papers (`[213]`, and arXiv material in the evidence files), which are not load-bearing for the recommendation; not run.

## Sources

[1] Tether, Tether to Launch USD₮ on RGB, Expanding Native Bitcoin Stablecoin Support. https://tether.io/news/tether-to-launch-usdt-on-rgb-expanding-native-bitcoin-stablecoin-support/
[2] Tether, Supported Protocols and Integration Guidelines. https://tether.to/en/supported-protocols/
[3] rgb.info, UTEXO update: SDK, Bridge, Wallets and Live Demo. https://rgb.info/utexo-rgb-sdk-bridge-community-call-demo/
[4] UTEXO docs, Mint: Getting Started. https://github.com/UTEXO-Protocol/docs/blob/main/mint/getting-started.mdx
[6] UTEXO docs, SDK networks table. https://github.com/UTEXO-Protocol/docs/blob/main/product-suite/sdk.mdx
[7] UTEXO docs, Quickstart overview and Mint API reference. https://github.com/UTEXO-Protocol/docs/blob/main/getting-started/quickstart/overview.mdx
[9] RGB-Tools, rgb-lib Cargo.toml (master). https://github.com/RGB-Tools/rgb-lib/blob/master/Cargo.toml
[11] RGB-Tools, rgb-lib src/utils.rs at 0.3.0-beta.7. https://github.com/RGB-Tools/rgb-lib/blob/0.3.0-beta.7/src/utils.rs
[13] rgb.info, UniSat Is the Next Launch Partner for USDT on Bitcoin. https://rgb.info/unisat-usdt-bitcoin-launch-partner/
[17] rgb-protocol, MOTIVATIONS.md. https://github.com/rgb-protocol/.github/blob/main/MOTIVATIONS.md
[18] rgb-protocol, WHY_v0.11.1.md. https://github.com/rgb-protocol/.github/blob/main/WHY_v0.11.1.md
[19] rgb.tech, statement on the v0.11.1 fork. https://rgb.tech/blog/on-rgb-fork-by-bitfinex/
[20] RGB-WG, rgb releases. https://github.com/RGB-WG/rgb/releases
[22] rgb.info, RGB Protocol v0.11.1 update: Core Libraries Drop the RC Tag. https://rgb.info/rgb-protocol-v0-11-1-core-libraries-update/
[23] rgb-protocol, rgb-schemas PFA schema. https://github.com/rgb-protocol/rgb-schemas/blob/master/src/pfa.rs
[24] UTEXO docs, Mint security model. https://github.com/UTEXO-Protocol/docs/blob/main/product-suite/mint.mdx
[100] Lightning Labs, A New Era for Stablecoins: Tether Is Coming to Bitcoin and Lightning. https://lightning.engineering/posts/2025-01-30-Tether-on-Lightning/
[101] Tether, Tether Brings USDt to Bitcoin's Lightning Network. https://tether.io/news/tether-brings-usdt-to-bitcoins-lightning-network-ushering-in-a-new-era-of-unstoppable-technology/
[102] Lightning Labs, Announcing Taproot Assets v0.6. https://lightning.engineering/posts/2025-6-24-tapd-v0.6-launch/
[103] Lightning Labs, Announcing Taproot Assets v0.8 and SDK. https://lightning.engineering/posts/2026-06-23-tapd-0.8-launch/
[107] Lightning Labs, Taproot Assets First Steps. https://docs.lightning.engineering/lightning-network-tools/taproot-assets/first-steps
[108] Lightning Labs universe servers, REST query for assets named USDT. https://universe.lightning.finance/v1/taproot-assets/universe/stats/assets?asset_name_filter=USDT&limit=20
[110] HOGE Wire, Taproot Assets in 2026: Dollars Return to Bitcoin (secondary, unresolved). https://hoge.gg/taproot-assets-2026-dollars-return-to-bitcoin/
[111] Liquid docs, Technical Overview. https://docs.liquid.net/docs/technical-overview
[113] Liquid docs, Features and Benefits. https://docs.liquid.net/docs/liquid-features-and-benefits
[114] Liquid docs, Liquid Assets. https://docs.liquid.net/docs/support-liquid-assets
[115] Blockstream, Liquid Security Incident status page. https://status.blockstream.com/incidents/b8b719f3-db70-4487-9cff-946e69509228
[117] Tether, Tether Add Support For Liquid Network. https://tether.io/news/tether-add-support-for-liquid-network/
[118] SideSwap, API documentation. https://sideswap.io/docs/
[119] Circle, Multichain USDC. https://www.circle.com/multi-chain-usdc
[120] Circle, USDC. https://www.circle.com/usdc
[200] agentbox, ADR-2102 Decision. https://github.com/DreamLab-AI/agentbox/blob/52eab13734e96361f9fcb4dad7f652256a9c1cdb/docs/adr/ADR-2102-assets-are-bridged-in-rgb-as-a-wrapped-asset.md
[201] agentbox, ADR-2102 Amendments after adversarial review. https://github.com/DreamLab-AI/agentbox/blob/52eab13734e96361f9fcb4dad7f652256a9c1cdb/docs/adr/ADR-2102-assets-are-bridged-in-rgb-as-a-wrapped-asset.md
[202] sidestr SPEC section 6, Peg-in. https://github.com/jjohare/spec/blob/722ad42d3271efccfdfaf57c3c6943f58fc168f8/SPEC.md
[203] sidestr SPEC section 7, Peg-out. https://github.com/jjohare/spec/blob/722ad42d3271efccfdfaf57c3c6943f58fc168f8/SPEC.md
[205] sidestr proposal, Assets and pools section 4. https://github.com/jjohare/spec/blob/722ad42d3271efccfdfaf57c3c6943f58fc168f8/proposals/assets-and-pools.md
[206] sidestr proposal, Assets and pools sections 1 and 2. https://github.com/jjohare/spec/blob/722ad42d3271efccfdfaf57c3c6943f58fc168f8/proposals/assets-and-pools.md
[207] agentbox, ADR-2101 Federation topology and key separation. https://github.com/DreamLab-AI/agentbox/blob/04fc80f0715cbb7d2b4bf22b474b413fa3060110/docs/adr/ADR-2101-federation-topology-and-key-separation.md
[208] CertiK, Wormhole Bridge Exploit Incident Analysis. https://www.certik.com/resources/blog/wormhole-bridge-exploit-incident-analysis
[210] CertiK, Nomad Bridge Exploit Incident Analysis. https://www.certik.com/resources/blog/nomad-bridge-exploit-incident-analysis
[211] Elliptic, Lazarus Group identified behind Ronin bridge theft. https://www.elliptic.co/blog/analysis/north-korea-s-lazarus-group-identified-as-exploiters-behind-540-million-ronin-bridge-theft
[213] Augusto et al., SoK: Security and Privacy of Blockchain Interoperability. https://oaklandsok.github.io/papers/augusto2024.pdf
[215] Circle, EVM CCTP contracts: Message Lifecycle. https://circlefin-evm-cctp-contracts.mintlify.app/concepts/message-flow
[218] Liquid docs, Technical Overview (bridge-design read). https://docs.liquid.net/docs/technical-overview
[219] Blockstream, Liquid: A Bitcoin Sidechain (whitepaper). https://blockstream.com/assets/downloads/pdf/liquid-whitepaper.pdf
[220] Rootstock, PowPeg. https://dev.rootstock.io/concepts/foundations/powpeg/
[221] Stacks, SIP-028 sBTC peg. https://github.com/stacksgov/sips/blob/main/sips/sip-028/sip-028-sbtc_peg.md
[223] WBTC, Whitepaper. https://www.wbtc.network/whitepaper
[224] WBTC, Mint/Burn Mechanism. https://docs.wbtc.network/how-wbtc-works/mint-burn-mechanism
[226] Lightning Labs, Announcing Taproot Assets v0.7. https://lightning.engineering/posts/2025-12-16-tapd-0.7-launch/
[232] Pharos, Multichain USDC: the bridge died, not the dollar. https://pharos.watch/learn/case-studies/multichain-usdc-2023/
[233] The Block, $63 million in USDC frozen by Circle following Multichain breach. https://www.theblock.co/news/ecosystems/2023-07-07-63-million-in-usdc-frozen-by-circle-following-multichain-breach-238459
[234] Spark, ERC-20, SPL, Taproot Assets, and RGB Compared (secondary). https://www.spark.money/research/stablecoin-token-standard-comparison
[235] ElementsProject, reserves (Blockstream proof-of-reserves tool). https://github.com/ElementsProject/reserves
[300] Estate testnet4 Bitcoin Core node, read-only RPC getblockchaininfo. http://192.168.2.27:48332/
[301] Estate testnet4 Bitcoin Core node, getindexinfo and indexer port probe. http://192.168.2.27:48332/
[303] RGB-Tools, rgb-lib Cargo.toml at 0.3.0-beta.7. https://github.com/RGB-Tools/rgb-lib/blob/0.3.0-beta.7/Cargo.toml
[304] RGB-Tools, rgb-lib BitcoinNetwork enum. https://github.com/RGB-Tools/rgb-lib/blob/0.3.0-beta.7/src/utils.rs#L66-L78
[305] RGB-Tools, rgb-lib testnet4_success test. https://github.com/RGB-Tools/rgb-lib/blob/0.3.0-beta.7/src/wallet/test/new.rs#L125-L135
[307] RGB-Tools, rgb-lib out-of-band transport. https://github.com/RGB-Tools/rgb-lib/blob/0.3.0-beta.7/src/wallet/singlesig.rs#L498-L511
[308] RGB-Tools, rgb-lib singlesig Wallet API. https://github.com/RGB-Tools/rgb-lib/blob/0.3.0-beta.7/src/wallet/singlesig.rs#L360-L372
[310] mempool.space, testnet4 Esplora API. https://mempool.space/testnet4/api/blocks/tip/height
[311] romanz, electrs src/config.rs and releases. https://github.com/romanz/electrs/blob/master/src/config.rs
[312] agentbox, ADR-2102 (local read). https://github.com/DreamLab-AI/agentbox/blob/bfda4d4e4/docs/adr/ADR-2102-assets-are-bridged-in-rgb-as-a-wrapped-asset.md
[314] Lightning Labs, taproot-assets tapcfg/config.go. https://github.com/lightninglabs/taproot-assets/blob/main/tapcfg/config.go
[316] Lightning Labs, taproot-assets README. https://github.com/lightninglabs/taproot-assets/blob/main/README.md
[319] sidestr proposal, assets-and-pools.md at 722ad42. https://github.com/jjohare/spec/blob/722ad42/proposals/assets-and-pools.md
[321] sidestr, siding/test/rules-test.mjs at 722ad42 (local run). https://github.com/jjohare/spec/blob/722ad42/siding/test/rules-test.mjs
[322] sidestr, siding/bin/siding.mjs. https://github.com/jjohare/spec/blob/722ad42/siding/bin/siding.mjs
[323] sidestr, siding/lib/spend.mjs. https://github.com/jjohare/spec/blob/722ad42/siding/lib/spend.mjs
[324] agentbox, sidestr:dreamlab chain document. https://github.com/DreamLab-AI/agentbox/blob/bfda4d4e4/config/sidechain/dreamlab/chain.json
[325] agentbox, config/sidechain/README.md. https://github.com/DreamLab-AI/agentbox/blob/bfda4d4e4/config/sidechain/README.md
[326] sidestr-rs, sidestr-core/src/document.rs. https://github.com/DreamLab-AI/sidestr-rs/blob/main/sidestr-core/src/document.rs
[327] sidestr-rs, sidestr-core/src/lib.rs. https://github.com/DreamLab-AI/sidestr-rs/blob/main/sidestr-core/src/lib.rs
[329] sidestr-rs, sidestr-core/src/rules.rs BlockRule. https://github.com/DreamLab-AI/sidestr-rs/blob/main/sidestr-core/src/rules.rs
[400] FCA, Cryptoassets regime information. https://www.fca.org.uk/firms/cryptoassets-information
[401] FCA, Overview of our cryptoassets regime policy statements. https://www.fca.org.uk/publications/policy-statements/cryptoasset-regime
[403] FCA Handbook, PERG 18.4 New specified investments. https://handbook.fca.org.uk/handbook/perg18/perg18s4
[404] legislation.gov.uk, MLR 2017 reg. 14A. https://www.legislation.gov.uk/uksi/2017/692/regulation/14A
[406] Freshfields, Drawing the Line: Navigating the FCA's New Cryptoasset Perimeter Guidance (secondary). https://www.freshfields.com/en/our-thinking/blogs/risk-and-compliance/drawing-the-line-navigating-the-fcas-new-cryptoasset-perimeter-guidance-102mv4u
[407] FCA, Cryptoasset financial promotions. https://www.fca.org.uk/firms/cryptoasset-financial-promotions-and-fiat-crypto-ramp-services
[409] FCA, Regulatory Sandbox. https://www.fca.org.uk/firms/innovation/regulatory-sandbox
[410] Tether, Terms of Service. https://tether.to/en/legal
[411] Circle, USDC Terms. https://www.circle.com/legal/usdc-terms
[412] Circle Docs, USDC contract addresses. https://developers.circle.com/stablecoins/usdc-contract-addresses
[413] Circle, Third-Party Bridged USDC Terms. https://www.circle.com/legal/bridged-usdc-terms
[415] EUR-Lex, Regulation (EU) 2023/1114 (MiCA). https://eur-lex.europa.eu/eli/reg/2023/1114/oj/eng
[416] Circle, Written Consent under MiCA. https://www.circle.com/legal/obtaining-written-consent-under-mica
[419] RGB-Tools, rgb-lib licence and resolved dependency licences. https://github.com/RGB-Tools/rgb-lib
[420] rgb-protocol, rgb-consensus licence. https://github.com/rgb-protocol/rgb-consensus
[421] crates.io, base85 2.0.0 licence metadata. https://crates.io/api/v1/crates/base85
[422] Mozilla, Mozilla Public License 2.0. https://www.mozilla.org/en-US/MPL/2.0/
[423] FSF, Various Licenses and Comments about Them. https://www.gnu.org/licenses/license-list.html
[425] GNU, AGPL v3. https://www.gnu.org/licenses/agpl-3.0.txt
[500] Loom corpus, class stablecoins-on-bitcoin. https://narrativegoldmine.com/class/stablecoins-on-bitcoin
[501] Loom corpus, class wrapped-token. https://narrativegoldmine.com/class/wrapped-token
[504] Loom corpus, class proof-of-reserves. https://narrativegoldmine.com/class/proof-of-reserves
[510] Loom corpus, class usdt. https://narrativegoldmine.com/class/usdt
[600] The Block, Blockstream refuses ransom demand for remaining 600 BTC from Liquid exploit (re-read). https://www.theblock.co/news/ecosystems/2026-09-11-return-the-bitcoin-blockstream-refuses-ransom-demand-for-remaining-600-btc-from-liquid-exploit-414247
[601] Halborn, Explained: The Liquid Network Hack (September 2026). https://www.halborn.com/blog/post/explained-the-liquid-network-hack-september-2026
[602] Liquid Network, incident report on X (lead). https://x.com/Liquid_BTC/status/2097404704028545175
[603] agentbox, PRD-024 research pack fact base. https://github.com/DreamLab-AI/agentbox/blob/bfda4d4e4/docs/proposals/sovereign-settlement-research/BRIEF-fact-base.md
[604] agentbox, PRD-024 Sovereign settlement. https://github.com/DreamLab-AI/agentbox/blob/bfda4d4e4/docs/proposals/sovereign-settlement.md
[605] agentbox, ADR-2112. https://github.com/DreamLab-AI/agentbox/blob/bfda4d4e4/docs/adr/ADR-2112-sidestr-crates-live-in-sidestr-rs.md
