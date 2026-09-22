# sidestr-header

Block headers for [sidestr](https://github.com/sidestr/spec) sidechains, in
both families the parent table allows: the stock 80-byte SHA-256d header
(beside `btc` / `tbtc4`) and Bitcoin Knots' 164-byte v2 header with the
tagged-hash-plus-BLAKE2b proof of work (beside `xbt` / `txbt4`). Compact
targets, the `powLimit` check siding applies, the BIP-325 block data over
each family's serialisation, the version-bit-31 rule, and the fork
activation constants of SPEC 3.2.

`#![no_std]`, no allocator, every primitive from RustCrypto (`sha2`,
`blake2`), no `bitcoin` crate dependency.

```rust
use sidestr_header::{HeaderFamily, Target};

let bytes = hex::decode(
    "0000002000000000000000000000000000000000000000000000000000000000000000003a87d59ecf60ab58ee75948cc39d1bb44ac4285747e64b5a1e7a960d37764cb40e67b26affff7f2002000000",
).unwrap();
let header = HeaderFamily::Stock.decode(&bytes).unwrap();
assert_eq!(header.hash().to_string(),
           "4db37517728bd509c0cb96ee5a2e3e2a77f9e965a092e9f67948b413d453dbc0");
let pow_limit = Target::from_hex("7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff").unwrap();
assert!(header.check_pow(&pow_limit).is_ok());
```

## Why two families

SPEC 3: "everything the overlay does not set is inherited from the parent:
header format and proof-of-work hash … Nothing in the document names a
header format or a hash; the parent decides both." So a chain's header is
the parent's header, and the parent table (SPEC 3.2) has two of them.

## Status

0.1.0 — both families decode, encode, hash and check proof of work against
the reference to the byte; the BIP-325 block data matches siding's
`blockData` on the live `sidestr:dreamlab` block 0. Not yet here: the
header-chain rules that need a previous header (prev link, committed height,
median time past) and the coinbase's BIP 34 height for the stock family —
those belong to `sidestr-core`.

## Attribution

This crate is a port, under the same licence, of:

- [bitcoin-desktop/schema](https://github.com/bitcoin-desktop/schema)
  (AGPL-3.0), commit `b8cbf6337c7450fe14ddc5bce00c7280059aab5d`:
  `codec/pow/knots-header-v2.js` (the v2 proof-of-work pipeline),
  `codec/pow/blake2b.js` and `codec/hash.js` (replaced by RustCrypto),
  `codec/codec.js` (`expandCompact`, the header codec), `codec/headers.js`
  (`compactFromTarget`), `schema/overlays/knots-blake2b.jsonld` (the v2
  layout and its field comments, adapted in the rustdoc), and the test
  vectors under `test/vectors/knots/` — Bitcoin Knots' own
  `block_header_v2.json` and real fork headers captured from a Knots 29.4.1
  node on 2026-09-05.
- [sidestr/spec](https://github.com/sidestr/spec) (AGPL-3.0), Melvin
  Carvalho, commit `2de40bdac4cba01be0864156a553d8287c22e279`:
  `siding/lib/block.mjs` (`buildBlock`'s header shape per family,
  `blockData`), `siding/lib/parents.mjs` (the family per parent),
  `siding/lib/chain.mjs` (`bits = compactFromTarget(powLimit)`), and
  `SPEC.md` §3, §3.2, §4.
- [bitcoin-blake/blaketestnode](https://github.com/bitcoin-blake/blaketestnode)
  (AGPL-3.0) is the kernel's reference for the fork chains; nothing was
  ported from it directly.

What changed in the port: the two hand-written hash functions are replaced
by `sha2` and `blake2`; the header is a typed struct per family rather than
a schema-driven object; compact targets that Bitcoin Core rejects (negative,
overflow) are rejected here where the JS kernel is lenient — unreachable on
a valid sidestr chain, where `bits` is pinned to `powLimit`.

## Licence

AGPL-3.0-only. See `LICENSE`. This crate is a derivative of AGPL-3.0 code
and is not dual-licensed (agentbox ADR-2106).
