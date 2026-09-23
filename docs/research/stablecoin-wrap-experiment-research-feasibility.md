Backends: local (file reads, upstream test run), rpc (read-only testnet4 Core), github (gh api: RGB-Tools/rgb-lib, lightninglabs/taproot-assets, romanz/electrs, lightningnetwork/lnd), crates.io API, perplexity, ceramic (one round: nothing relevant returned), websearch not used

# Stablecoin wrap experiment — what runs end to end on our stack in weeks (researcher D)

Retrieved 2026-09-23. Status tags: **verified** = read in code/docs/RPC/test output; **inferred** = reasoned from verified facts; **unresolved** = not established.

## Findings

### 0. Parent and indexer facts

- **verified** Our parent is Bitcoin Core `/Satoshi:30.3.0/`, `chain: testnet4`, height 153720, not pruned, `txindex` synced [300][301]. The public mempool.space testnet4 Esplora API reported the same tip (153720) and the testnet4 genesis hash at the same moment [310].
- **verified** No Electrum/Esplora indexer answers on the node host: TCP 40001 (the electrs testnet4 Electrum default), 50001, 3002 and 60001 are all closed on 192.168.2.27 [301].
- **verified** electrs v0.12.0 (2026-09-13) supports `testnet4`, with daemon RPC default 48332 (our port) and Electrum default 40001 [311]. **inferred** A local electrs against our Core node is a small add-on (a new process, no Core change; `txindex` is not needed by electrs). A public testnet4 Esplora/Electrum can stand in for it during a first experiment.

### 1. rgb-lib

- **verified** Latest crate: `rgb-lib 0.3.0-beta.7` (2026-07-17). Every 0.3.0 release is a pre-release (alpha/beta); the repository is `RGB-Tools/rgb-lib` (a `gh api` call to `rgb-protocol/rgb-lib` returned 404) [302]. It pins the RGB v0.11.1 line (`rgb-ops`/`rgb-schemas`/`rgb-invoicing = "=0.11.1-rc.11"`) and `bdk_wallet =3.1.0` [303].
- **verified** Networks: `BitcoinNetwork::{Mainnet, Testnet, Testnet4, Signet, Regtest, SignetCustom}` [304]. There is a `testnet4_success` test that goes online against `ssl://electrum.iriswallet.com:50053` [305].
- **verified** Indexer is **required** for online operations: Cargo features `default = ["electrum"]`, `esplora` optional; `OnlineOptions.indexer_url` [303][306]. The `rust_only` module declares both Electrum and Esplora indexer protocols [306].
- **verified** Transport: an invoice can carry up to three JSON-RPC proxy endpoints (`rpc://`/`rpcs://`). **An empty list selects out-of-band exchange** via `provide_out_of_band_consignment`/`provide_out_of_band_ack`, and `accept_transfer_consignment` accepts a consignment from a file path [307]. **inferred** So an RGB proxy server is optional. The bridge process can take consignments as files, or as Nostr payloads it writes to disk.
- **verified** Issuance: `Wallet::issue_asset_nia(ticker, name, precision, amounts)` issues an RGB20 NIA asset onto UTXOs that must already exist (`create_utxos`) [308]. The flow `go_online → create_utxos → issue_asset_nia → blind_receive/witness_receive → send → refresh` is all public Rust API on `singlesig::Wallet` [308].
- **verified** The upstream integration suite runs on **regtest**: bitcoind + three electrs + esplora + three RGB proxies [309].
- **inferred** Nothing in the API is network-gated, so NIA issuance on testnet4 should work: the network enum and a live testnet4 online test exist [304][305]. **unresolved:** I found no upstream test that runs issue→send→validate on testnet4 itself. A testnet4 issuance needs a few thousand tBTC4 sats for the colour UTXOs (a funding cost the owner authorises; none was spent here).
- **inferred** Scriptable from Rust end to end: issue, create receive UTXOs in a second wallet (two DIDs = two rgb-lib wallets), send, and accept/validate the consignment (the consignment is validated inside `accept_transfer_consignment`/`refresh`). This is a `publish = false` binary of a few hundred lines. It fits ADR-2102 §3's isolated process exactly [312].

### 2. tapd (Taproot Assets)

- **verified** Latest `v0.8.4` (2026-09-16) [313]. Networks: `mainnet, regtest, testnet, testnet4, simnet, signet`, plus a custom signet via `signetchallenge` [314]. A default testnet4 universe/proof courier `testnet4.universe.lightning.finance:443` is configured [314][315].
- **verified** tapd **requires LND**: "Taproot Assets require lnd version v0.20.0-beta or later", with the chain `Bitcoin blockchain backend <-> lnd <-> tapd`. `LndConfig` is a mandatory group, and the connection is via `lndclient`, with a minimum LND 0.19 and the build tags `signrpc, walletrpc, chainrpc, invoicesrpc` [314][316].
- **verified** LND v0.21.3-beta / v0.20.4-beta (2026-09-02) exist, and lnd source references testnet4 in `chainreg/chainparams.go` and `lncfg/chain.go` [317].
- **inferred** Our Core Lightning node **cannot** back tapd. No standalone tapd exists: minting on testnet4 would need a new LND (bitcoind backend = our Core node over RPC + ZMQ) plus tapd. That is two new daemons plus a ZMQ config change on the Core node (a running-service change), versus none for rgb-lib. tapd is therefore a later route.

### 3. Our side: sidestr assets today

- **verified** SPEC §12 reserves assets in the core and points to `proposals/assets-and-pools.md` [318]. The proposal has **been running on `sidestr:tally` since 18 September 2026** [319]. The records are `issue:<TICKER>:<decimals>` (the asset id is the issuing txid) and `tally:<asset|self>:<vout>=<amount>,…` [319]. The rule is conservation per asset, where "what the inputs carry is at least what the tallies assign" and the difference is destroyed, and issuance is the one exception [319]. The siding overlay implements exactly that [320].
- **verified** I ran the upstream rules test at 722ad42 locally (scratch copy, `SCHEMA`/`BLAKETESTNODE` set, no installs): **31 passed, 0 failed**. It covers issuing 1,000,000 SHELL, refusing unbacked tallies, a 600k+300k transfer with 100k burned by omission, pools, validator refusal and reopen-from-block-file determinism [321].
- **verified** `siding new … [--parent … tbtc4 …] [--rules assets,pool]` creates an assets chain [322]. **There is no `issue`/`tally` CLI verb**: `siding send` builds only plain/peg-out/EVM spends (`buildSpend({… to, amount, fee, pegout, evmDeposit})`) [323]. Issuance is a raw transaction POSTed to the producer's `POST /tx` [322]. **inferred** A ~50-line Node or Rust script is needed. The shape is the rules-test's `mk([...], [..., recordScript('issue:…'), recordScript('tally:self:0=…')])` [321].
- **verified** **`sidestr:dreamlab` cannot carry assets as sealed**: its document names no `rules` and has `pegs: []` [324]. The README says a change to a sealed field is "a new chain with a new genesis, never a configuration edit" [325]. The genesis commits to the chain id, pegs, `genesisTime` and signer witness [325]. **inferred** `rules` is not one of the fields the genesis commits to, but adding it to a live chain would make validators disagree from genesis (SPEC §8 wants activation heights via rule documents). Treat it as a new chain, e.g. `sidestr:dreamlab-assets`.
- **verified** Coins on a `pegs: []` chain enter only by peg-in [325]. **inferred** A first asset experiment on a fresh chain needs sats to pay for the issuing transaction's outputs, since a tallied output needs ≥1 sat [319]. So either a small real tBTC4 peg-in (6 confirmations) or a genesis `pegs` entry. The upstream test uses a fake genesis peg (`txid: 'a'.repeat(64)`) [321]; a sealed estate chain must not do this, because it would mint unbacked sats.
- **verified** **sidestr-rs does not support assets**: `ChainDocument::validate` refuses any chain naming a rule ("sidestr-core carries the core rules only") [326]. The crate docs say a document naming `assets`, `pool` or `evm` is refused [327]. `sidestr-wallet` excludes assets [328]. The extension point is `trait BlockRule { fn id(&self)->&str; fn check(&self, ctx:&BlockContext<F>)->Option<bool>; }` [329]. `marker.rs` already round-trips `issue:` record text [330], and `sidestr-nostr`'s estate event has an `asset: Option<Urn>` amount field [331].
- **inferred** So the Rust validator (the `sidestr-agent`, anything built on sidestr-core) **cannot follow** an assets chain today. Route A therefore runs on the JS producer only, and Rust parity is a port of the 76-line `assets.mjs` as a `BlockRule` (plus a carried-amount map in `State`).

**What a minimal `bridge` rule needs** (from ADR-2102 §1 [312] and the assets proposal §4 [319], **inferred**):
1. A record, e.g. `wrap:<origin-contract-id>:<vout>=<amount>` plus `attest:<bridge-event-id>`, allowed only in a transaction signed by the bridge key named in the chain document. That covers authorised reissuance under a fixed asset identity, which the upstream `assets` rule structurally cannot do, because its id is the issuing txid and supply is fixed at issue [319][312].
2. A validator-side ledger: wrapped supply per origin id ≤ attested reserve. Each attestation references origin `txid:vout` (the RGB seal), and a seal is used at most once (replay protection).
3. `unwrap:` burn records bound to asset, recipient and origin seal, with pending redemptions counted as liabilities.
4. Everything else is reused from `assets`: the tally conservation for transfers, destruction by omission, and the "coinbase carries no records" rule [320].
In JS that is about one overlay beside `assets.mjs`. In Rust it is a second `BlockRule` [329].

## Ranked experiment routes

### Route A — mock wrapped asset with the upstream `assets` rule (time to first result: ~2–4 days)
- **Steps:** `siding new --name dreamlab-assets --parent tbtc4 --rules assets …`, with a comment that says "unbacked test asset, not USDT" (SPEC principle 6 [318]). Seal the genesis. Peg in a small amount of tBTC4 (or run it as a throwaway chain that is never sealed into `config/sidechain/`). A script issues `issue:TUSDX:6` + `tally:self:0=…`. Transfer between two DID-held keys with `tally:<id>:…`. Show a failed over-assign and a burn by omission. Reopen from the block file.
- **Components to add:** the issue/transfer script (~50 lines), a second producer supervisor block, and the chain document.
- **Proves:** consensus-validated issue/transfer/burn of a USD-labelled test unit on an estate chain with a testnet4 parent. It also exercises wallet UX, the estate URN (`urn:agentbox:asset:…`) and Nostr announcements. The upstream test shows the rule is correct (31/31) [321].
- **Cannot prove:** anything about backing, a bridge or RGB. A second deposit cannot mint more of the same asset [319]. It is not a wrap.
- **Blockers:** `sidestr:dreamlab` is sealed without `rules` [324][325], so a new chain is needed. sidestr-rs refuses the chain [326], so Rust followers are out until `assets` is ported.

### Route B — RGB20 test asset on testnet4 via isolated rgb-lib, operator-attested wrap (~2–3 weeks)
- **Steps:**
  1. A `publish = false` `sidestr-bridge` binary on `rgb-lib 0.3.0-beta.7`. Use the Esplora feature against a testnet4 indexer: public mempool.space first [310], then a local electrs on our Core node [311].
  2. Wallet I (issuer) runs `issue_asset_nia("TUSD","Test USD — not USDT",6,[…])`. Label it **not USDT**: no issuer asset exists on testnet4 (**unresolved**; nothing found, see [332]).
  3. Wallet B (bridge) makes `blind_receive` with **empty transport endpoints** (out-of-band). I sends and the consignment file is handed over. B accepts it, validates it and settles it [307].
  4. B signs an attestation (origin contract id, seal txid:vout, amount) and posts a `wrap:` transaction to a new chain carrying the minimal `bridge` rule (above).
  5. Transfer the wrapped units between two DIDs under `tally:`.
  6. Unwrap: burn on the sidechain, then B sends RGB back to I, and I's rgb-lib validates it.
- **Components to add:** the bridge binary, the `bridge` overlay in JS siding (a fork of upstream at 722ad42, or an upstream proposal), an indexer (public, then electrs), a new chain document, and tBTC4 dust for the colour UTXOs.
- **Proves:** ADR-2102's ratification path end to end on testnet4 [312], with RGB kept outside consensus. It also proves the burn-before-release ordering and a supply ≤ attested-reserve invariant at level 1.
- **Cannot prove:** that validators can check RGB reserves (they check the bridge's signature, not RGB state). It says nothing about USDT's issuer terms or rgb-lib stability (a pre-release crate [302]), and nothing about v0.12 compatibility.
- **Blockers:** there is no local indexer [301]. A real-issuer asset is absent on testnet → use our own labelled asset. The `bridge` rule needs a spec fork. Rust followers are refused until they carry `assets` + `bridge` [326].

### Route C — Taproot Assets on testnet4 (≥3–4 weeks; not recommended first)
- **Steps:** deploy LND ≥0.20 on our Core node (needs ZMQ), deploy tapd `--network=testnet4`, mint, prove via the testnet4 universe [314][315], then feed the same `bridge` rule with the asset id and outpoint.
- **Components to add:** LND, tapd, a Core ZMQ config change, and LND channel/wallet funding.
- **Proves:** that the bridge rule is origin-agnostic, which is ADR-2102's "later Taproot Assets" [312].
- **Cannot prove:** anything about USDT (Tether chose RGB, not Taproot Assets [332]).
- **Blockers:** Core Lightning is unsupported, since tapd needs LND via lndclient [316]. The Core ZMQ change touches a running service.

**Recommendation (inferred):** run A first. It is days of work and validates the tally/wallet/URN surface. Start Route B's bridge binary in parallel, because B is the one that answers the owner's question. Drop C unless the Taproot Assets origin becomes a requirement.

## Sources

### [300] Read-only RPC getblockchaininfo / getnetworkinfo, testnet4 Core node
URL: http://192.168.2.27:48332/ (RPC)
Retrieved: 2026-09-23
Status: verified
Found via: rpc
<untrusted-source url="rpc://192.168.2.27:48332/getblockchaininfo" retrieved="2026-09-23">
> {"result":{"chain":"testnet4","blocks":153720,"headers":153720,…,"pruned":false,"warnings":[]}
> {"result":{"version":300300,"subversion":"/Satoshi:30.3.0/",…,"connections":12,…}
</untrusted-source>

### [301] Read-only RPC getindexinfo + TCP probe for indexers on 192.168.2.27
URL: http://192.168.2.27:48332/ (RPC); TCP 192.168.2.27:{40001,50001,3002,60001}
Retrieved: 2026-09-23
Status: verified
Found via: rpc
<untrusted-source url="rpc://192.168.2.27:48332/getindexinfo" retrieved="2026-09-23">
> {"result":{"txindex":{"synced":true,"best_block_height":153720}},"error":null,"id":"r"}
> closed 40001 / closed 50001 / closed 3002 / closed 60001
</untrusted-source>

### [302] crates.io: rgb-lib versions
URL: https://crates.io/api/v1/crates/rgb-lib
Retrieved: 2026-09-23
Status: verified
Found via: github (crates.io API)
<untrusted-source url="https://crates.io/api/v1/crates/rgb-lib" retrieved="2026-09-23">
> 0.3.0-beta.7 2026-07-17T14:11:24.071237Z https://github.com/RGB-Tools/rgb-lib
> 0.3.0-beta.6 2026-05-19 / 0.3.0-beta.5 2026-03-30 / 0.3.0-beta.4 2025-11-20
</untrusted-source>

### [303] rgb-lib Cargo.toml at 0.3.0-beta.7 (features, RGB deps)
URL: https://github.com/RGB-Tools/rgb-lib/blob/0.3.0-beta.7/Cargo.toml
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/RGB-Tools/rgb-lib/blob/0.3.0-beta.7/Cargo.toml" retrieved="2026-09-23">
> default = ["electrum"]
> all = ["electrum", "esplora"]
> rgb-ops = { version = "=0.11.1-rc.11", default-features = false, features = [
> bdk_wallet = { version = "=3.1.0", default-features = false, features = [
</untrusted-source>

### [304] rgb-lib src/utils.rs:66-78 BitcoinNetwork
URL: https://github.com/RGB-Tools/rgb-lib/blob/0.3.0-beta.7/src/utils.rs#L66-L78
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/RGB-Tools/rgb-lib/blob/0.3.0-beta.7/src/utils.rs#L66-L78" retrieved="2026-09-23">
> pub enum BitcoinNetwork {
>     /// Bitcoin's testnet4
>     Testnet4,
>     /// Bitcoin's default signet
>     Signet,
>     /// Bitcoin's regtest
>     Regtest,
>     /// Bitcoin's custom signet
>     SignetCustom,
</untrusted-source>

### [305] rgb-lib src/wallet/test/new.rs:125-135 testnet4_success
URL: https://github.com/RGB-Tools/rgb-lib/blob/0.3.0-beta.7/src/wallet/test/new.rs#L125-L135
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/RGB-Tools/rgb-lib/blob/0.3.0-beta.7/src/wallet/test/new.rs#L125-L135" retrieved="2026-09-23">
> fn testnet4_success() {
>     let bitcoin_network = BitcoinNetwork::Testnet4;
>     let indexer_url = "ssl://electrum.iriswallet.com:50053";
>     party.go_online(false, Some(indexer_url));
</untrusted-source>

### [306] rgb-lib OnlineOptions (objects.rs:76-78) and indexer protocol (rust_only.rs:30-36)
URL: https://github.com/RGB-Tools/rgb-lib/blob/0.3.0-beta.7/src/wallet/objects.rs#L76-L78
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/RGB-Tools/rgb-lib/blob/0.3.0-beta.7/src/wallet/objects.rs#L76-L78" retrieved="2026-09-23">
> pub struct OnlineOptions {
>     /// URL of the indexer to use
>     pub indexer_url: String,
> /// Indexer protocol … /// An indexer implementing the electrum protocol … /// An indexer implementing the esplora protocol
</untrusted-source>

### [307] rgb-lib out-of-band transport (singlesig.rs:498-511) and accept_transfer_consignment (rust_only.rs:320-335)
URL: https://github.com/RGB-Tools/rgb-lib/blob/0.3.0-beta.7/src/wallet/singlesig.rs#L498-L511
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/RGB-Tools/rgb-lib/blob/0.3.0-beta.7/src/wallet/singlesig.rs#L498-L511" retrieved="2026-09-23">
> At the moment the only supported variant is JsonRpc (e.g. `rpc://127.0.0.1` or `rpcs://example.com`).
> Providing an empty list selects the out-of-band exchange: the invoice carries no transport endpoints and the consignment and ACK are exchanged out-of-band (see provide_out_of_band_consignment and provide_out_of_band_ack), without using automated transport endpoints.
> /// Accept an RGB transfer using a consignment received out-of-band.
> pub fn accept_transfer_consignment(&mut self, online: Online, consignment_path: PathBuf, txid: String, vout: u32, blinding: u64,
</untrusted-source>

### [308] rgb-lib singlesig Wallet API (issue_asset_nia :360-372; blind_receive :515; witness_receive :577; create_utxos :635; go_online :731; send :825)
URL: https://github.com/RGB-Tools/rgb-lib/blob/0.3.0-beta.7/src/wallet/singlesig.rs#L360-L372
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/RGB-Tools/rgb-lib/blob/0.3.0-beta.7/src/wallet/singlesig.rs#L360-L372" retrieved="2026-09-23">
> /// Issue a new RGB NIA asset with the provided `ticker`, `name`, `precision` and `amounts`, then return it.
> /// If `amounts` contains more than 1 element, each one will be issued as a separate allocation for the same asset (on a separate UTXO that needs to be already available).
> pub fn issue_asset_nia(
</untrusted-source>

### [309] rgb-lib README (test environment)
URL: https://github.com/RGB-Tools/rgb-lib/blob/0.3.0-beta.7/README.md
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/RGB-Tools/rgb-lib/blob/0.3.0-beta.7/README.md" retrieved="2026-09-23">
> This command will run a [bitcoind] node, three [electrs] nodes, one [esplora] node and three [RGB proxy] instances, in order to perform integration tests in a regtest environment.
</untrusted-source>

### [310] mempool.space testnet4 Esplora API (tip and genesis)
URL: https://mempool.space/testnet4/api/blocks/tip/height ; https://mempool.space/testnet4/api/block-height/0
Retrieved: 2026-09-23
Status: verified
Found via: websearch (direct fetch)
<untrusted-source url="https://mempool.space/testnet4/api/blocks/tip/height" retrieved="2026-09-23">
> 153720
> 00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043
</untrusted-source>

### [311] electrs releases and src/config.rs testnet4
URL: https://github.com/romanz/electrs/blob/master/src/config.rs
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/romanz/electrs/blob/master/src/config.rs" retrieved="2026-09-23">
> "either 'bitcoin', 'testnet', 'testnet4', 'regtest' or 'signet'"
> Network::Testnet4 => 48332,
> Network::Testnet4 => 40001,
> v0.12.0 2026-09-13T11:01:43Z
</untrusted-source>

### [312] ADR-2102 (local)
URL: /home/devuser/workspace/project/agentbox/docs/adr/ADR-2102-assets-are-bridged-in-rgb-as-a-wrapped-asset.md (Decision §1, §3, §5; Verification)
Retrieved: 2026-09-23
Status: verified
Found via: local
<untrusted-source url="file:///home/devuser/workspace/project/agentbox/docs/adr/ADR-2102-assets-are-bridged-in-rgb-as-a-wrapped-asset.md" retrieved="2026-09-23">
> the upstream `assets` rule cannot do this: an issued asset's identity is its issuing txid and its supply is fixed at issue, so a second deposit cannot mint more of the same asset
> `rgb-lib` is confined by a process boundary, not a crate feature. `sidestr-bridge` is `publish = false`
> The bridge path is proven first with a test RGB20 asset on the configured testnet parent.
> Ratification evidence: an RGB20 test asset bridged in, transferred between two DIDs on our chain, and exited to a consignment `rgb-lib` validates
</untrusted-source>

### [313] taproot-assets releases
URL: https://github.com/lightninglabs/taproot-assets/releases
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/lightninglabs/taproot-assets/releases" retrieved="2026-09-23">
> v0.8.4 2026-09-16T11:31:20Z
</untrusted-source>

### [314] taproot-assets tapcfg/config.go (networks :255, :829-840; lnd minimum :234-249)
URL: https://github.com/lightninglabs/taproot-assets/blob/main/tapcfg/config.go
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/lightninglabs/taproot-assets/blob/main/tapcfg/config.go" retrieved="2026-09-23">
> Network string `long:"network" description:"network to run on" choice:"mainnet" choice:"regtest" choice:"testnet" choice:"testnet4" choice:"simnet" choice:"signet"`
> defaultTestnet4FederationServer = "testnet4.universe.lightning.finance:443"
> // minimalCompatibleVersion is the minimum version and build tags required in lnd to run tapd.
> BuildTags: []string{ "signrpc", "walletrpc", "chainrpc", "invoicesrpc",
</untrusted-source>

### [315] taproot-assets sample-tapd.conf
URL: https://github.com/lightninglabs/taproot-assets/blob/main/sample-tapd.conf
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/lightninglabs/taproot-assets/blob/main/sample-tapd.conf" retrieved="2026-09-23">
> ; Default for testnet4:
> ;   proofcourieraddr=universerpc://testnet4.universe.lightning.finance:443
> ; Network to run on (mainnet, regtest, testnet, testnet4, simnet, signet)
> [lnd]
> ; lnd.host=localhost:10009
</untrusted-source>

### [316] taproot-assets README (LND requirement)
URL: https://github.com/lightninglabs/taproot-assets/blob/main/README.md
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/lightninglabs/taproot-assets/blob/main/README.md" retrieved="2026-09-23">
> `Bitcoin blockchain backend <-> lnd <-> tapd`
> Taproot Assets require [lnd](https://github.com/lightningnetwork/lnd/) version `v0.20.0-beta` or later to be synced and running on the
</untrusted-source>

### [317] lnd releases and testnet4 references
URL: https://github.com/lightningnetwork/lnd/releases ; https://github.com/lightningnetwork/lnd/blob/master/chainreg/chainparams.go
Retrieved: 2026-09-23
Status: verified
Found via: github
<untrusted-source url="https://github.com/lightningnetwork/lnd/releases" retrieved="2026-09-23">
> v0.21.3-beta 2026-09-02T09:47:46Z
> v0.20.4-beta 2026-09-02T09:47:31Z
> (code search "testnet4": lncfg/chain.go, chainreg/chainparams.go, lncfg/config.go)
</untrusted-source>

### [318] sidestr SPEC §12 and principle 6 (local, spec 722ad42)
URL: /home/devuser/workspace/sidestr/upstream/spec/SPEC.md:34, :263-268 — https://github.com/jjohare/spec/blob/722ad42/SPEC.md
Retrieved: 2026-09-23
Status: verified
Found via: local
<untrusted-source url="https://github.com/jjohare/spec/blob/722ad42/SPEC.md" retrieved="2026-09-23">
> 6. **No native token.** Issued assets exist for testing and say so.
> Reserved in the core. Issued assets and an automated market maker between them and the pegged coin are rules in the sense of section 8, validated by every node, and are not part of 0.0.1. An issued asset is unbacked and every document that names it says so.
</untrusted-source>

### [319] proposals/assets-and-pools.md (local, 722ad42) lines 3, 20-21, 30-39, 76-85
URL: /home/devuser/workspace/sidestr/upstream/spec-722ad42/proposals/assets-and-pools.md — https://github.com/jjohare/spec/blob/722ad42/proposals/assets-and-pools.md
Retrieved: 2026-09-23
Status: verified
Found via: local
<untrusted-source url="https://github.com/jjohare/spec/blob/722ad42/proposals/assets-and-pools.md" retrieved="2026-09-23">
> *Status: the `assets` and `pool` rules run on `sidestr:tally` since 18 September 2026; section 4 (assets between chains) is a draft for level 2.*
> | `issue:<TICKER>:<decimals>` | this transaction issues a new asset; its id is this txid; `TICKER` is 1 to 8 of `A-Z0-9`, `decimals` 0 to 8 (display only) |
> For every asset in every non-coinbase transaction: **what the inputs carry is at least what the tallies assign**; the difference is destroyed. Issuance is the one exception
> On the destination chain the signers claim it as the coinbase issuance of a wrapped asset whose id is `<origin chain id>:<origin asset id>`, paired with a `claim:` record naming the origin txid
</untrusted-source>

### [320] siding/lib/overlays/assets.mjs:46-50 (local, 722ad42)
URL: /home/devuser/workspace/sidestr/upstream/spec-722ad42/siding/lib/overlays/assets.mjs:46-50 — https://github.com/jjohare/spec/blob/722ad42/siding/lib/overlays/assets.mjs
Retrieved: 2026-09-23
Status: verified
Found via: local
<untrusted-source url="https://github.com/jjohare/spec/blob/722ad42/siding/lib/overlays/assets.mjs" retrieved="2026-09-23">
> if (asset === txid && cls.issues.length) continue;                 // issuance: created from nothing
> if (n > (inCarry.get(asset) ?? 0)) return bad(`assigns ${n} of ${asset.slice(0, 8)}… but carries ${inCarry.get(asset) ?? 0}`);
</untrusted-source>

### [321] Local run of siding/test/rules-test.mjs at 722ad42 (scratch copy)
URL: /home/devuser/workspace/sidestr/upstream/spec-722ad42/siding/test/rules-test.mjs (lines 12, 34-44)
Retrieved: 2026-09-23
Status: verified
Found via: local
<untrusted-source url="file:///home/devuser/workspace/sidestr/upstream/spec-722ad42/siding/test/rules-test.mjs" retrieved="2026-09-23">
> const chain = { ...base, id: 'sidestr:rulestest', …, rules: ['assets', 'pool'], pegs: [{ txid: 'a'.repeat(64), vout: 0, amount: 5e9, script: me }] };
> PASS  submit accepts an issuance of 1,000,000 SHELL onto output 0
> PASS  a transfer of 600k + 300k (100k burned by omission) is accepted
> PASS  validator: a block whose transaction assigns what it does not carry is refused
> 31 passed, 0 failed
</untrusted-source>

### [322] siding/bin/siding.mjs:3, :298 (CLI usage and POST /tx)
URL: /home/devuser/workspace/sidestr/upstream/spec-722ad42/siding/bin/siding.mjs — https://github.com/jjohare/spec/blob/722ad42/siding/bin/siding.mjs
Retrieved: 2026-09-23
Status: verified
Found via: local
<untrusted-source url="https://github.com/jjohare/spec/blob/722ad42/siding/bin/siding.mjs" retrieved="2026-09-23">
> //   siding new --name <name> --prefix <hrp> [--parent txbt4|xbt|tbtc4|btc] [--comment ...] [--rules assets,pool] [--interval 600] [--port N] [--out FILE]
> if (path === '/tx' && req.method === 'POST') { … const r = await s.submit(body.trim());
</untrusted-source>

### [323] siding/lib/spend.mjs:21 buildSpend signature
URL: /home/devuser/workspace/sidestr/upstream/spec-722ad42/siding/lib/spend.mjs:21
Retrieved: 2026-09-23
Status: verified
Found via: local
<untrusted-source url="https://github.com/jjohare/spec/blob/722ad42/siding/lib/spend.mjs" retrieved="2026-09-23">
> export async function buildSpend({ engine, chain, signer, key, url, to, amount, fee = null, pegout = false, evmDeposit = false }) {
</untrusted-source>

### [324] sidestr:dreamlab chain document
URL: /home/devuser/workspace/project/agentbox/config/sidechain/dreamlab/chain.json
Retrieved: 2026-09-23
Status: verified
Found via: local
<untrusted-source url="file:///home/devuser/workspace/project/agentbox/config/sidechain/dreamlab/chain.json" retrieved="2026-09-23">
> "id": "sidestr:dreamlab", "parent": "tbtc4", "comment": "… Research stage: level 1, one signer, depth 0. Coins carry no value. …",
> "pegs": [],
> (no "rules" field)
</untrusted-source>

### [325] config/sidechain/README.md:3-6, :21-23, :27-30
URL: /home/devuser/workspace/project/agentbox/config/sidechain/README.md
Retrieved: 2026-09-23
Status: verified
Found via: local
<untrusted-source url="file:///home/devuser/workspace/project/agentbox/config/sidechain/README.md" retrieved="2026-09-23">
> sealed field is a new chain with a new genesis, never a configuration edit.
> The genesis mints no pegs (`pegs: []`): it is sealed by the signer key alone and needs no parent funds. Coins enter by peg-in (SPEC 6) and are claimed by the producer at `pegConfirmations`.
> Upstream's genesis commits to the chain id, the pegs, `genesisTime` and the signer's witness
</untrusted-source>

### [326] sidestr-core/src/document.rs:224-226
URL: /home/devuser/workspace/sidestr-rs/sidestr-core/src/document.rs:224-226 — https://github.com/DreamLab-AI/sidestr-rs/blob/main/sidestr-core/src/document.rs
Retrieved: 2026-09-23
Status: verified
Found via: local
<untrusted-source url="https://github.com/DreamLab-AI/sidestr-rs/blob/main/sidestr-core/src/document.rs" retrieved="2026-09-23">
> return bad(format!("chain {} names rule \"{r}\", which this validator does not have (sidestr-core carries the core rules only)", self.id));
</untrusted-source>

### [327] sidestr-core/src/lib.rs:245-248
URL: /home/devuser/workspace/sidestr-rs/sidestr-core/src/lib.rs:245
Retrieved: 2026-09-23
Status: verified
Found via: local
<untrusted-source url="https://github.com/DreamLab-AI/sidestr-rs/blob/main/sidestr-core/src/lib.rs" retrieved="2026-09-23">
> **A document naming `assets`, `pool` or `evm` is refused** at [`document::ChainDocument::validate`], as `loadEngine` refuses a rule it does not have: those overlays are not carried
</untrusted-source>

### [328] sidestr-wallet/src/lib.rs:136
URL: /home/devuser/workspace/sidestr-rs/sidestr-wallet/src/lib.rs:136
Retrieved: 2026-09-23
Status: verified
Found via: local
<untrusted-source url="https://github.com/DreamLab-AI/sidestr-rs/blob/main/sidestr-wallet/src/lib.rs" retrieved="2026-09-23">
> the `evm` rule), nor are assets (SPEC 12, reserved).
</untrusted-source>

### [329] sidestr-core/src/rules.rs:30-31, :530-535 BlockRule
URL: /home/devuser/workspace/sidestr-rs/sidestr-core/src/rules.rs:530
Retrieved: 2026-09-23
Status: verified
Found via: local
<untrusted-source url="https://github.com/DreamLab-AI/sidestr-rs/blob/main/sidestr-core/src/rules.rs" retrieved="2026-09-23">
> Extension point: [`BlockRule`] adds a block-context rule (the assets and pool rules of SPEC 12 are rules in that sense) without touching this file.
> pub trait BlockRule<F: HeaderFamily>: core::fmt::Debug {
>     fn id(&self) -> &str;
>     fn check(&self, ctx: &BlockContext<F>) -> Option<bool>;
</untrusted-source>

### [330] sidestr-core/src/marker.rs:660-661
URL: /home/devuser/workspace/sidestr-rs/sidestr-core/src/marker.rs:660
Retrieved: 2026-09-23
Status: verified
Found via: local
<untrusted-source url="https://github.com/DreamLab-AI/sidestr-rs/blob/main/sidestr-core/src/marker.rs" retrieved="2026-09-23">
> record_text(&record_script("issue:SHELL:2").unwrap()).as_deref(),
> Some("issue:SHELL:2")
</untrusted-source>

### [331] sidestr-nostr/src/estate.rs:290-294
URL: /home/devuser/workspace/sidestr-rs/sidestr-nostr/src/estate.rs:290
Retrieved: 2026-09-23
Status: verified
Found via: local
<untrusted-source url="https://github.com/DreamLab-AI/sidestr-rs/blob/main/sidestr-nostr/src/estate.rs" retrieved="2026-09-23">
> /// The amount, sats or asset units.
> /// The asset URN, `None` for the pegged coin.
> pub asset: Option<Urn>,
</untrusted-source>

### [332] USDT on RGB — launch reporting (no testnet asset found)
URL: https://www.cryptopolitan.com/usdt-returns-to-bitcoin-via-rgb-tron/ ; https://www.rootdata.com/projects/detail/Utexo?k=MjM5MTM=
Retrieved: 2026-09-23
Status: verified (reporting); testnet availability unresolved
Found via: perplexity
<untrusted-source url="https://www.cryptopolitan.com/usdt-returns-to-bitcoin-via-rgb-tron/" retrieved="2026-09-23">
> USDT will be issued using RGB v0.11.1, a Bitcoin asset protocol developed by the software firm UTEXO, which is serving as issuer and distributor in partnership with Tether.
> Instead of using Taproot Assets, the company would opt for issuing USDT through RGB v0.11.1
</untrusted-source>
<untrusted-source url="https://www.rootdata.com/projects/detail/Utexo?k=MjM5MTM=" retrieved="2026-09-23">
> The team emphasized that the full go-to-market for USDT on Bitcoin is tied to Tether's launch timing, expected between summer and September 2026
</untrusted-source>

## Open questions

1. Is there a Tether/UTEXO-issued USDT test contract on testnet4 or signet? None was found (perplexity and ceramic). Without one, every route uses our own labelled RGB20 asset.
2. Does rgb-lib's Esplora client work against mempool.space's testnet4 API, which is Esplora-compatible but not Blockstream esplora? It is untested here. The safer path is a local electrs v0.12 on our Core node.
3. Does upstream accept a `bridge` rule proposal, or do we fork siding at 722ad42? That decides whether `sidestr:tally`-style interoperability survives.
4. Assets chain: throwaway unsealed dev chain versus a sealed `sidestr:dreamlab-assets` with a real tBTC4 peg-in. This is an owner decision under SPEC principle 6 and ADR-2103.
5. What is the attestation format and signer for reserve proofs (ADR-2102, parked)? Route B needs at least a provisional one.
6. When do sidestr-rs followers carry the `assets` rule (port `assets.mjs` as a `BlockRule`), and should that port be in the published AGPL crate or an internal one?
