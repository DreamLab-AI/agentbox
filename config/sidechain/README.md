# Sidechain documents

One directory per sidestr chain the estate has sealed. The chain document is the chain's
identity: its `genesisHash` is what a validator refuses to proceed past, so the document is
committed here and never edited in place (PRD-024 D2, ADR-2101, ADR-2103). Changing any
sealed field is a new chain with a new genesis, never a configuration edit.

| chain | parent | prefix | signer | genesis | sealed |
|---|---|---|---|---|---|
| `sidestr:dreamlab` | `tbtc4` (Bitcoin testnet4, the estate's own node) | `drm` | `7092810a…4c76d62` | `4db37517…d453dbc0` | 2026-09-22 |

## What is where

| thing | path | durability |
|---|---|---|
| chain document | `config/sidechain/<name>/chain.json` (this repo) | git |
| signer key | `/var/lib/agentbox/secrets/sidestr-<name>.key`, mode 0400, 32 bytes hex | the `agentbox-secrets` named volume; survives rebuilds; never in `identity.env`, never derived from the identity key (ADR-2101 D3) |
| block file and index | `$WORKSPACE/sidestr/<name>/blocks.dat`, `blocks.json` | host bind; reproducible from document plus key while the chain is at genesis |
| parent node | Bitcoin Core testnet4 on the LAN node, RPC `:48332`, wallet `sidestr-peg` | PRD-024 §node access |

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
invariants and, when the block file is present, the SHA-256d of its 80-byte header against
the document.

## Interim producer and mirror (2026-09-22)

Until the supervised programs exist, `run-producer.sh` runs the upstream JS producer from
the durable checkouts under `$WORKSPACE/sidestr/upstream` (spec, schema kernel,
blaketestnode) in tmux window `sidestr`: port `:3450` on loopback, a block every 600 s
(10 s with transactions), the five default public relays, peg-ins scanned on the estate's
testnet4 node from the funding height and paid from wallet `sidestr-peg`. Pass
`--announce-mirror <https url>` to publish the kind-33333 tip after every block; the
relays are the registry (SPEC 11): any client asking for kind 33333 tagged `t=sidestr`
lists every chain that has announced, and `play-grounds.github.io/sidestr` is one such
client. `mirror-sync.sh <pages checkout>` copies `chain.json`, `blocks.dat` and
`blocks.json` into a GitHub Pages checkout and pushes on change; Pages serves them with
open CORS and Range requests, which is all a mirror is.

## Not yet built (PRD-024 P1)

`[sidechain]` in `agentbox.toml` and its schema entry, the `sidestr-node` and
`sidestr-producer` supervised programs, the mirror on loopback `:9097` behind the nip98
proxy at `/chain/`, the `chain` and `asset` URN kinds, and the kind-38420 account
binding.
