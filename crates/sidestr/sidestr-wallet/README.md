# sidestr-wallet

A wallet for [sidestr](https://github.com/sidestr/spec) sidechains, in Rust:
the coin set for a script, the reference coin selection, taproot key-path
spends and peg-out burns signed behind a signer port, the parent-side peg-in
transaction shape, and delivery as a `POST /tx` body or a kind-23500 event.

A wallet needs a chain id and a relay, and nothing of the producer's (SPEC 11).
It reads `chain.json` from a mirror, asks a producer `/coins/<script hex>` — or
folds the block file with [`sidestr-core`](https://crates.io/crates/sidestr-core)
and gets the same list — builds a transaction Bitcoin's rules accept with the
fee at the document's `minFeeRate`, and hands it over. The transaction
authorises itself; a producer includes what validates.

```toml
[dependencies]
sidestr-wallet = "0.1"
sidestr-core = "0.1"
```

```rust
use sidestr_wallet::{build_spend, coins, Permissive, PlainKey, SpendRequest};

let chain = sidestr_core::ChainDocument::from_json(&chain_json)?;   // from a mirror
let listed = coins::from_json(&coins_json)?;                        // GET /coins/<my script>
let me = PlainKey::from_hex(&std::fs::read_to_string(key_file)?)?;  // a derived role key, never the identity key
let paid = build_spend(&SpendRequest { chain: &chain, coins: &listed, tip_height, to: "drm1p…", amount: 25_000, fee: None }, &me, &Permissive)?;
let post = sidestr_wallet::deliver::tx_post(producer_url, &paid.hex);   // POST post.body to post.url
```

## Attribution

This crate is a port of **siding**, the reference implementation of sidestr by
Melvin Carvalho — [github.com/sidestr/spec](https://github.com/sidestr/spec),
AGPL-3.0 — ported from commit `2de40bdac4cba01be0864156a553d8287c22e279`:
`siding/lib/spend.mjs` (`buildSpend`, `resolveTo`, `deliver`),
`lib/address.mjs`, the transaction and marker construction of
`lib/parent.mjs` (`scanPegins`, `payPegout`) and `lib/checkpoint.mjs`
(`sendCheckpoint`), and the `send` and `faucet` commands of `bin/siding.mjs`.
The mempool policy it builds to — maturity, `pegoutMin`, `minFeeRate`, the
key-path signature check — is `siding/lib/chain.mjs Siding.submit()`, which
`sidestr-core` carries as `State::submit`. `SPEC.md` in the sidestr repository
is the design; the crate documentation cites its sections, and every ported
function names its original. Consensus types, markers, addresses and the chain
document come from `sidestr-core` and are not duplicated.

## What changed in the port

- **Plain BIP 341 signatures.** `spend.mjs` signs with the schema kernel's
  *unified* sighash (hash type `0x21`, a 65-byte witness), which only that
  kernel verifies and `sidestr-core` refuses. This crate signs
  `SIGHASH_DEFAULT` (64 bytes), which siding's own verifier also accepts, so
  a transaction from here is accepted by both engines. Byte equality with
  `siding send` is therefore not a goal; acceptance by both is
  (`tests/oracle.rs`).
- **Keys behind a port.** A builder computes the sighash and asks a
  `SpendSigner` for the signature; it never holds a secret. `PlainKey` is the
  in-memory implementation (siding's model), and `key::derive_spend_key` is the
  HMAC-SHA256 domain-separated role-key derivation of agentbox ADR-2101, with
  a known-answer vector cross-checked against Node.js.
- **A policy hook.** Every builder consults a `SpendPolicy` (chain, kind,
  script, amount, fee, inputs) before signing. `Permissive` is the default and
  must be named to be used.
- **Dust is refused**, and change under the dust threshold goes to the fee
  rather than into an unspendable coin. siding does not check.
- **A fixed fee is checked against `minFeeRate`** before signing rather than
  by the producer.
- **Zero BIP 340 auxiliary randomness** in `PlainKey`: a spend is a pure
  function of its inputs and the key.
- **No I/O by default.** `deliver` returns URLs, bodies and unsigned event
  templates; feature `client` adds the HTTP calls over `ureq`. Signing and
  publishing a Nostr event is `sidestr-nostr`'s. Nothing here talks to a
  parent node: `pegin` produces the outputs, the unsigned transaction, and
  the `[{address: btc}, {data: hex}]` argument Bitcoin Core's `send` takes,
  as `parent.mjs` does.
- **Parent records are bounded before they are built.** `pegoutMarkerData`
  and the checkpoint go on the parent inside its 80-byte `OP_RETURN` policy,
  and every marker push must fit the one length byte the shared grammar reads
  (255 bytes); `pegin::pegout_payment_outputs` returns
  `Error::MarkerTooLong` past either bound rather than a well-formed
  `OP_PUSHDATA2` output that `parse_pegout_marker` would never read back
  (audit F4, 0.2.1; the checkpoint's 80-byte bound is `sidestr-core`'s
  `checkpoint_data`). The reference does not check; its `send` fails at the
  node.
- **Not carried:** the `--evm` deposit branch (ADR-2096 excludes the `evm`
  rule), assets (SPEC 12, reserved), the faucet's relay loop and rate state
  (its payment is `build_spend`; the request template is `deliver::faucet_request`).

## Status — 0.2.1

Spend, burn, peg-in shape, delivery data, coin listing and selection, the
signer and policy ports. Proven:

- a two-input spend and a burn built here on a throwaway chain are accepted by
  `sidestr-core`'s `State::submit` and mined, **and** by siding's
  `Siding.submit()` and mined, with the same txid, fee and vsize; a tampered
  signature is refused by both (`tests/oracle.rs`, `tests/xcheck-wallet.mjs`,
  needs the reference checkouts);
- a peg-in transaction round-trips through rust-bitcoin and its marker parses
  with `sidestr_core::marker`;
- accept and reject for every builder: insufficient funds, dust, below
  `pegoutMin`, wrong parent network, fee below `minFeeRate`, policy refusal
  (`tests/builders.rs`).

Not yet: a PSBT for the parent-side peg-in, the peg holders' descriptor
(`and_v(v:pk(refund), older(refundBlocks))`) and refund sweep, script-path
spends, hardened BIP-32 custody roles (ADR-2101), a relay client, the
level-2 view.

## Running the checks

```sh
cargo test -p sidestr-wallet                       # unit, builders, doctests; the oracle's Rust half
SIDESTR_SIDING=<sidestr/spec>/siding SCHEMA=<bitcoin-desktop/schema> BLAKETESTNODE=<bitcoin-blake/blaketestnode> \
  cargo test -p sidestr-wallet --test oracle       # and siding's verdict on the same transactions
RUSTDOCFLAGS="-D warnings" cargo doc -p sidestr-wallet --no-deps
cargo clippy -p sidestr-wallet --all-targets -- -D warnings && cargo fmt -p sidestr-wallet -- --check
```

Keys are files, never arguments; nothing here prints one. The test keys are
derived from fixed strings and seal throwaway chains whose coins carry no value.

## Licence

AGPL-3.0-only, as the work it derives from. Not dual-licensed. A crate that
links this one is AGPL-3.0 in effect and should say so (agentbox ADR-2106).
