# sidestr-core

[sidestr](https://github.com/sidestr/spec) user-activated sidechains beside a
Bitcoin-family parent, in Rust: the chain document, the parents table, signed
stock-header blocks (a BIP 325 challenge, no subsidy), the peg-in claim and
peg-out burn rules, the block file, and an in-memory validating chain with a
producer's mempool.

A sidestr chain runs beside a Bitcoin-family chain with Bitcoin's transaction
rules, blocks that are valid because they are *signed* rather than mined, no
subsidy, and every coin on it a coin locked on the parent. Signers decide the
order of blocks; they do not decide the rules.

```toml
[dependencies]
sidestr-core = "0.1"
```

## Attribution

This crate is a port of **siding**, the reference implementation of sidestr by
Melvin Carvalho — [github.com/sidestr/spec](https://github.com/sidestr/spec),
AGPL-3.0 — ported from commit `2de40bdac4cba01be0864156a553d8287c22e279`
(`siding/lib/{parents,block,chain,overlay,marker,records,address,checkpoint}.mjs`,
`bin/siding.mjs`, and the tests in `siding/test/`). Two parts come from the
engine siding loads, by the same author and under the same licence:

- the block, header and spending checks from
  [bitcoin-desktop/schema](https://github.com/bitcoin-desktop/schema)
  (`codec/blocks.js`, `codec/headers.js`, `schema/validate.jsonld`);
- the block file format and the chain state machine from
  [bitcoin-blake/blaketestnode](https://github.com/bitcoin-blake/blaketestnode)
  (`lib/blockfile.mjs`, `lib/node.mjs`).

`SPEC.md` in the sidestr repository is the design; the crate documentation
cites its sections, and every ported function names its original.

## What changed in the port

- Bitcoin's consensus serialisation, hashes, merkle roots, the taproot sighash
  and BIP-340 Schnorr come from [`rust-bitcoin`](https://crates.io/crates/bitcoin)
  and its `secp256k1`; bech32 from the [`bech32`](https://crates.io/crates/bech32)
  crate. Nothing cryptographic is hand-rolled.
- Script verification fails closed: taproot key-path spends are verified, every
  other script type is refused rather than skipped. The reference lets a witness
  version it cannot verify through.
- Claim and burn records commit only when a block is applied, not while it is
  being judged.
- Blocks are a pure function of their inputs and the key: BIP 340 auxiliary
  randomness is zero for every block, as siding sets it for the genesis.
- A document naming the `assets`, `pool` or `evm` rules, a level-2 federation,
  or a BLAKE2b parent is refused, because this version does not carry them.
- No I/O in the rules: the filesystem and the clock are behind the `std`
  feature (`blockfile`, `chain`).

## Status — 0.1.0

Level 1 (one signer), the stock header family (parents `btc`, `tbtc4`), end
to end: genesis from the document, block production, validation, the mempool
policy, the block file. Proven against the reference:

- the genesis of a throwaway chain rebuilt from its document and key is
  byte-identical to the one siding wrote (`tests/oracle.rs`);
- the estate's sealed `sidestr:dreamlab` genesis replays to its documented hash;
- blocks produced here are accepted by siding and blocks siding produces are
  accepted here (`tests/interop.rs`, needs the reference checkouts).

Not yet: the BLAKE2b v2 header family (`sidestr-header`), level 2 (several
signers, the co-signing round), the assets and pool rules, a parent view
(peg-in scanning, paying burns), tips and transactions over Nostr
(`sidestr-nostr`), a full script interpreter.

## Running the checks

```sh
cargo test                                   # unit, ported siding suites, fixtures, doctests
cargo run --example siding -- replay --chain fixtures/dreamlab/chain.json --dir <dir with blocks.dat>
cargo run --example siding -- genesis --chain chain.json --dir state --key-file signer.key
# the JS interop test, with the reference checkouts:
SIDESTR_SIDING=<sidestr/spec>/siding SCHEMA=<bitcoin-desktop/schema> BLAKETESTNODE=<bitcoin-blake/blaketestnode> \
  cargo test --test interop
RUSTDOCFLAGS="-D warnings" cargo doc --no-deps
cargo clippy --all-targets -- -D warnings && cargo fmt --check
```

`fixtures/trial` is a throwaway chain with its disposable signer key, carried
for the byte-for-byte test. `fixtures/dreamlab` is a sealed genesis without its
key. Keys are files, never arguments; nothing here prints one.

## Licence

AGPL-3.0-only, as a derivative work of siding. See [LICENSE](LICENSE). This
crate is **not dual-licensed**: a crate that links it is AGPL-3.0 in effect and
should say so.
