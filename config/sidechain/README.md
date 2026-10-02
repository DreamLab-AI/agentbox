# Sidechain documents

One directory per sidestr chain the estate has sealed. The chain document is the chain's
identity: its `genesisHash` is what a validator refuses to proceed past, so the document is
committed here and never edited in place (PRD-024 D2, ADR-2101, ADR-2103). Changing any
sealed field is a new chain with a new genesis, never a configuration edit.

| chain | parent | prefix | signer | genesis | sealed |
|---|---|---|---|---|---|
| `sidestr:dreamlab` | `tbtc4` (Bitcoin testnet4, the estate's own node) | `drm` | `7092810a…4c76d62` | `4db37517…d453dbc0` | 2026-09-22 |
| `sidestr:dreamlab-txbt4` | `txbt4` (BLAKE2b testnet4, Knots 29.4.2 on the Dell VM) | `drt` | `5e05b5ba…c6665f2f` | `1009aa29…8b82d108` | 2026-10-02 |

**Neither chain is anchored.** No producer writes checkpoints into its parent, so every block of
either chain is the single signer's word, nothing more. For `sidestr:dreamlab-txbt4` that is
owner decision SC5 (2026-10-02, cost), recorded Open in ADR-2103 with the switch that ends it.
Whether a checkpoint exists is what `<state>/checkpoints.json` says;
`scripts/sidechain/preflight-liquidity.sh` prints it before any balance. No demo, page or
narration may say otherwise.

## What is where

| thing | path | durability |
|---|---|---|
| chain document | `config/sidechain/<name>/chain.json` (this repo) | git |
| signer key | `/var/lib/agentbox/secrets/sidestr-<name>.key`, mode 0400, 32 bytes hex | the `agentbox-secrets` named volume; survives rebuilds; never in `identity.env`, never derived from the identity key (ADR-2101 D3) |
| block file and index | `$WORKSPACE/sidestr/<name>/blocks.dat`, `blocks.json` | host bind; reproducible from document plus key while the chain is at genesis |
| parent node | Bitcoin Core testnet4 on the LAN node, RPC `:48332`, wallet `sidestr-peg` | PRD-024 §node access |

`sidestr:dreamlab-txbt4` keeps the same layout under its own name: signer
`/var/lib/agentbox/secrets/sidestr-dreamlab-txbt4.key` (0400), block file
`$WORKSPACE/sidestr/dreamlab-txbt4/`, treasury `$WORKSPACE/sidestr/agents/treasury-dreamlab-txbt4.key`
(public half in `treasury-dreamlab-txbt4.json`). Its parent is Knots 29.4.2 on the BLAKE2b testnet4
fork, `http://192.168.2.27:48342/`, LAN only (nftables), rpcauth users with method whitelists and
`rpcwhitelistdefault=0`; there is no peg wallet, so peg-outs are recorded and not paid (`cashOut`
is false anyway).

The genesis mints no pegs (`pegs: []`): it is sealed by the signer key alone and needs no
parent funds. Coins enter by peg-in (SPEC 6) and are claimed by the producer at
`pegConfirmations`.

## Fields beyond upstream's document

`depth`, `containment` and `containmentDigest` are estate fields (ADR-2103 D3). Upstream's
genesis commits to the chain id, the pegs, `genesisTime` and the signer's witness
(`siding/lib/chain.mjs` `buildGenesis`), and to nothing else in the document, so these
fields do not alter `genesisHash` and are **not yet bound on-seal**: the coinbase `pin:`
record that would commit `containmentDigest` is unbuilt. Until it is, the binding of parent
and containment to this chain is the committed document itself. `containmentDigest` is the
SHA-256 of the JCS form of `containment`, the value the `pin:` record will carry.

## The BLAKE2b family

A chain beside `txbt4` or `xbt` inherits the parent's header family (SPEC 3.2): block 0 is 418
bytes with Knots' 164-byte v2 header (version `0xa0000000`, committed height, txCount), its hash
is Knots' BLAKE2b construction rather than SHA-256d, and transaction signatures use the unified
sighash (`SIGHASH_UNIFIED`, `0x21` on the wire). The pinned engine (`upstream-pins`) does all of this
already: the reference chains upstream are all beside `txbt4`. Engine-free,
`tests/config/knots_header_v2.py` reproduces Knots' own hashes of live txbt4 headers and then
hashes this chain's block 0 to its `genesisHash`.

## Replaying the genesis

The reference engine needs two checkouts and no npm install:

```sh
SCHEMA=<bitcoin-desktop/schema checkout> BLAKETESTNODE=<bitcoin-blake/blaketestnode checkout> \
  node <sidestr/spec checkout>/siding/bin/siding.mjs genesis \
    --chain config/sidechain/dreamlab/chain.json \
    --dir "$WORKSPACE/sidestr/dreamlab" \
    --key-file /var/lib/agentbox/secrets/sidestr-dreamlab.key
```

`open()` refuses a block file whose block 0 does not hash to the document's `genesisHash`.
Without the engine, `tests/config/sidechain-genesis.test.sh` checks the document's
invariants and, when the block file is present, the header hash in the parent's family against
the document.

## Supervised producer, mirror and faucet

`[sidechain]` in `agentbox.toml` bakes three supervised programs (REBUILD-class). They ran
in a tmux window from 2026-09-22 until a container restart on 2026-09-25 stopped the chain
for four days with nothing to bring it back.

| program | gate | runs | does |
|---|---|---|---|
| `sidestr-producer` | `enabled` | `run-producer.sh --announce-mirror <announce_mirror>` | the upstream JS engine from the durable checkouts under `$WORKSPACE/sidestr/upstream`: port `:3450` on loopback, a block every 600 s (10 s with transactions), the five default public relays, peg-ins scanned on the estate's testnet4 node from the funding height and paid from wallet `sidestr-peg` |
| `sidestr-mirror` | `mirror` | `mirror-sync.sh <mirror_checkout> 120` | copies `chain.json`, `blocks.dat` and `blocks.json` into a GitHub Pages checkout and pushes on change |
| `sidestr-faucet` | `faucet` | `run-faucet.sh` | `sidestr-agent faucet` (baked, `lib/sidestr-agent.nix`): 100 DREAM and 1,000 sats per script per 24 h, 20 grants an hour, paid from `faucet_key_file` |

`mirror` and `faucet` apply only with `enabled`. Logs are `/var/log/sidestr-*.log`.

`--announce-mirror` publishes the kind-33333 tip after every block; the relays are the
registry (SPEC 11): any client asking for kind 33333 tagged `t=sidestr` lists every chain
that has announced, and `play-grounds.github.io/sidestr` is one such client. Without it the
producer makes blocks that no wallet can find. GitHub Pages serves the mirror with open
CORS and Range requests, which is all a mirror is.

The producer refuses to start unless each checkout is at the commit recorded in
`upstream-pins`, so the upstream code the chain runs is a fact of this repository, not of
the host; supervisord gives up after five attempts (FATAL), because the fix is a pin, not
a retry. `SIDESTR_ALLOW_UNPINNED=1` overrides the check for an upgrade test.

### Further chains: `[sidechain.<name>]`

Each further sealed chain is a table of its own (`[sidechain.dreamlab-txbt4]` is the first; the
schema names each chain, so a new one lands with its seal). flake.nix bakes
`sidestr-producer-<name>`, `sidestr-mirror-<name>` and `sidestr-faucet-<name>` from it, all three
runners keyed by `SIDESTR_CHAIN`. `[sidechain].enabled` dominates every table, and a table's
`enabled` dominates its own mirror and faucet. The runner refuses to start when the table's
`parent` disagrees with the sealed document (ADR-2103 D3), when a BLAKE2b parent's block at the
fork height is not the fork hash (D3a: the fork shares genesis, magic and port with the stock
chain, so a wrong-branch node looks healthy), and when `checkpoint_every > 0` names no
`checkpoint_wallet` (the engine would skip every checkpoint without a word).

| `sidestr:dreamlab-txbt4` | value |
|---|---|
| producer | `:3451`, 600 s blocks, parent scan from 152,225 (the tip at the seal) |
| parent credential | `knots-txbt4.rpc` (`txbt4read`) today; `sidestr-txbt4.rpc` once `scripts/sidechain/dell-txbt4-open-rpc.sh` has run (adds `decoderawtransaction`, so parent transactions relayed over kind 23503 can be judged; `txbt4read` gets 403) |
| mirror | its own Pages repository, `DreamLab-AI/sidestr-dreamlab-txbt4`, checkout `$WORKSPACE/sidestr/mirror-dreamlab-txbt4`. Not a path in the `sidestr-dreamlab` repository: `mirror-sync.sh` never pulls, so two loops pushing one repository wedge each other on non-fast-forward |
| faucet | sats only (no asset on this chain), from its own treasury key and grant ledger (`faucet-dreamlab-txbt4.json`) |
| checkpoints | off (`checkpoint_every = 0`, owner SC5) |
| liquidity | none at the seal: `pegs: []`, and coins enter only by peg-in (SPEC 2, no subsidy), which needs txbt4 coins the estate does not hold. A claimed peg-in is a coinbase output and waits 100 sidechain blocks |

The table ships `enabled = false`: flipping it bakes the three programs on the next rebuild.

## Not yet built (PRD-024 P1)

A native `sidestr-node` (the producer is still upstream's JS engine), the mirror on
loopback `:9097` behind the nip98 proxy at `/chain/`, the `chain` and `asset` URN kinds,
and the kind-38420 account binding.
