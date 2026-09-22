# sidestr-core

[sidestr](https://github.com/sidestr/spec) user-activated sidechains beside a
Bitcoin-family parent, in Rust: the chain document, the parents table, signed
blocks in either header family (a BIP 325 challenge, no subsidy), the peg-in
claim and peg-out burn rules, the block file, and an in-memory validating
chain with a producer's mempool.

A sidestr chain runs beside a Bitcoin-family chain with Bitcoin's transaction
rules, blocks that are valid because they are *signed* rather than mined, no
subsidy, and every coin on it a coin locked on the parent. Signers decide the
order of blocks; they do not decide the rules.

```toml
[dependencies]
sidestr-core = "0.2"
# and, for a chain beside a BLAKE2b parent (xbt, txbt4):
sidestr-header = "0.2"
```

The rules, state and chain are generic over the header family
(`sidestr_core::block::HeaderFamily`): `State` / `Chain` are the stock
instantiation (`btc`, `tbtc4`), and `StateOf<Blake2bV2>` / `ChainOf<Blake2bV2>`
with `sidestr_header::Blake2bV2` validate a chain beside Knots' BLAKE2b fork.
The dependency edge runs from `sidestr-header` to this crate, never back.

## Attribution

This crate is a port of **siding**, the reference implementation of sidestr by
Melvin Carvalho — [github.com/sidestr/spec](https://github.com/sidestr/spec),
AGPL-3.0 — ported from commit `2de40bdac4cba01be0864156a553d8287c22e279`
(`siding/lib/{parents,block,chain,overlay,marker,records,address,checkpoint}.mjs`,
`bin/siding.mjs`, and the tests in `siding/test/`). Two parts come from the
engine siding loads, by the same author and under the same licence:

- the block, header and spending checks, and Knots' unified sighash, from
  [bitcoin-desktop/schema](https://github.com/bitcoin-desktop/schema)
  (`codec/blocks.js`, `codec/headers.js`, `codec/interpreter.js`
  `sighashUnified`, `schema/validate.jsonld`);
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
- The solution's witness decoder refuses truncation, trailing bytes, non-minimal
  sizes and more than 256 items; the reference reads what it can.
- The mempool judges a spend's sighash type by the family's block rule (unified
  only beside a BLAKE2b parent); the reference mempool accepts unified on every
  family while its block rule does not.
- Claim and burn records commit only when a block is applied, not while it is
  being judged.
- Blocks are a pure function of their inputs and the key: BIP 340 auxiliary
  randomness is zero for every block, as siding sets it for the genesis.
- A document naming the `assets`, `pool` or `evm` rules is refused, because
  this version does not carry them.
- Level 2 carries the pure parts of `federation.mjs` and not the round: the
  script path is verified for exactly the `multi_a(k, …)` leaf, an unknown
  leaf version is refused rather than skipped, and `template_id` names what
  signers authorise separately from the sealed hash (ADR-2101 review).
- No I/O in the rules: the filesystem and the clock are behind the `std`
  feature (`blockfile`, `chain`).
- The genesis is judged, not trusted: `from_genesis` runs every rule that
  applies at height 0 (the family's header rules, the signature against the
  challenge, the pegs as the one subsidy, `sidestr:rule-genesis-document`)
  before the hash is held to the document's `genesisHash`; siding applies
  block 0 on the hash alone. There is no trusted import.
- A stock header with version bit 31 set is refused at decode and, on the
  typed path, by `btc:rule-header-version` — the rule the kernel names, which
  reads a stock version as `i32le`.
- A mirror's `blocks.dat` record framing (`[u32 height][u32 size]`) is held to
  `blocks.json` and to the file's length on every read (`Error::BlockFile`).
- Markers are written with a canonical push (`OP_PUSHDATA1` above 75 bytes)
  and read exactly as siding's `opReturnData` reads them — a bare length byte
  or an `OP_PUSHDATA1` prefix, minimal or not — because that is the burn
  rule's grammar and a burn a reference wallet wrote must be paid.

## Status — 0.2.1

Level 1 (one signer), both header families, end to end: genesis from the
document, block production, validation, the mempool policy, the block file.
Proven against the reference:

- the genesis of a throwaway chain rebuilt from its document and key is
  byte-identical to the one siding wrote (`tests/oracle.rs`);
- the estate's sealed `sidestr:dreamlab` genesis replays to its documented hash;
- blocks produced here are accepted by siding and blocks siding produces are
  accepted here (`tests/interop.rs`, needs the reference checkouts);
- with `sidestr-header`'s `Blake2bV2`, Melvin Carvalho's live
  `sidestr:txbt4-siding` chain replays from its genesis to its tip with every
  rule on, spends signed with Knots' unified sighash included
  (`sidestr-header/tests/core_family.rs`);
- a 2-of-3 federation's challenge, its genesis and two blocks sealed by three
  different pairs are byte-identical to siding's (`tests/federation.rs`,
  `fixtures/fedtest`), every subset and both parities are property-tested
  (`tests/federation_prop.rs`), and Bitcoin Core's interpreter agrees with the
  `multi_a` verifier on 161 differential cases
  (`cargo test --features consensus-oracle`);
- the five counter-examples of the independent 0.2 audit (an unsigned genesis
  accepted on its hash, a stock block with version bit 31 replayed, a corrupt
  record prefix replayed, a `u32` overflow in `claimable`, and the typed v2
  genesis bypassing the family rules) are fixed and pinned as regressions
  (`tests/audit_regressions.rs`, both crates).

0.2 made the rules, state and chain generic over `HeaderFamily` (with an
associated header and block type), added Knots' unified sighash and the
family's own rules, tightened the witness decoder, and added level 2's pure
parts (`federation`: NUMS key, leaf, partial signatures, witness assembly,
sealing, the `multi_a` verifier, `template_id`, `Chain::open_sealed`).
`State`, `Chain` and every 0.1 name keep their meaning as the stock
instantiation. The parent view (`parent`) is behind two traits — the chain
read-only, the peg wallet — with every decision pure (peg-ins found in
decoded blocks, what to claim and lock, the burn payment and the checkpoint
as `send` outputs, reconciliation) and Bitcoin Core's JSON-RPC as the one
implementation behind the `rpc` feature; `tests/parent_live.rs` (ignored,
`SIDESTR_PARENT_RPC`) finds the estate's peg-wallet funding on a testnet4
node without sending anything.

Not yet: the level-2 consensus round (a separate crate, per the ADR-2101
review), the assets and pool rules, tips and transactions over Nostr
(`sidestr-nostr`), a full script interpreter.

## Running the checks

```sh
cargo test                                   # unit, ported siding suites, fixtures, doctests
cargo test --features consensus-oracle       # plus Bitcoin Core's interpreter as a differential oracle (needs a C++ toolchain)
SIDESTR_PARENT_RPC=http://<node>:48332/ cargo test --features rpc --test parent_live -- --ignored   # a testnet4 node, read-only
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
