# sidestr-nostr

The Nostr plane of [sidestr](https://github.com/sidestr/spec) sidechains, in
Rust: an owned NIP-01 event with BIP-340 verification and a sealed signer port,
the tip announcement (kind 33333) with the mirror trust rule, transactions and
faucet requests over a relay (23500, 23501), rule and genesis documents (33500,
33501), the dual-schema 33502 record decoded as peg record, pledge or
ambiguous, the level-2 round envelopes (23510–23514), and agentbox's account
binding and settlement events (38420–38425).

A sidestr chain has no peer-to-peer network: blocks are served as a file from
any mirror, and everything else travels as signed events on public relays. The
one rule that makes a relay's answer worth acting on is the announcement's: a
client accepts a mirror when the mirror's `chain.json` names the announcer as
the chain's signer, and then holds the mirror to the announced tip — it may be
behind, never ahead. A chain id is a name, not a proof.

```toml
[dependencies]
sidestr-nostr = "0.2"
```

```rust
use sidestr_nostr::event::SecretKeySigner;
use sidestr_nostr::tip::{parse_tip, sign_tip, TipTemplate};

let signer = SecretKeySigner::from_hex(&"07".repeat(32)).unwrap();
let header = format!("{:02x}", 1).repeat(80);            // one stock 80-byte header, as hex
let tip = TipTemplate::new("sidestr:example", 0, vec![header], vec!["https://mirror.example/x".into()]).unwrap();
let ev = sign_tip(&signer, &tip, 1_790_100_000).unwrap();
ev.verify().unwrap();
assert_eq!(parse_tip(&ev).unwrap().mirrors, ["https://mirror.example/x"]);
```

## Attribution

This crate is a port of **siding**, the reference implementation of sidestr by
Melvin Carvalho — [github.com/sidestr/spec](https://github.com/sidestr/spec),
AGPL-3.0 — ported from commit `2de40bdac4cba01be0864156a553d8287c22e279`
(the tip parser follows `announce.mjs` at `e457737`, spec 0.0.3)
(`siding/lib/{announce,relay,pledge,round,pegoutround,spend}.mjs`,
`bin/siding.mjs`, `test/announce-test.mjs`). The event id and signature rule
comes from the schema kernel siding loads, by the same author and under the
same licence: [bitcoin-desktop/schema](https://github.com/bitcoin-desktop/schema)
(`codec/nostr.js verifyNostrEvent`). `SPEC.md` in the sidestr repository is
the design; the crate documentation cites its sections, and every ported
function names its original. The announcement and mirror rule in the crate
docs is Melvin Carvalho's wording from `announce.mjs` and SPEC 11, adapted.

The agentbox kinds 38420–38425 are this estate's own (ADR-2098, DDD-022),
not upstream's.

## What changed in the port

- SHA-256 is RustCrypto `sha2`; BIP-340 Schnorr is `secp256k1` through
  `rust-bitcoin`, sharing `sidestr-core`'s context. Nothing cryptographic is
  hand-rolled. The in-memory signer uses zero auxiliary randomness, so an
  event is a pure function of its fields and the key (siding draws random aux;
  both are valid on the wire).
- Keys sit behind a `Signer` port that is driven only through named
  constructors (`sign_tip`, `sign_transaction_event`, `sign_rule`,
  `sign_pledge`, `sign_proposal`, `sign_account_binding`, …); the request type
  has no public constructor, so there is no generic "sign this payload" path.
  siding passes a raw hex key to every function.
- **Both header families parse** (upstream matched at spec 0.0.3). Before
  sidestr/spec PR #7, siding's `parseTip` accepted only content whose length
  divides by 328 (the 164-byte Knots v2 header) and therefore returned `null`
  for every announcement of a chain beside a stock Bitcoin parent (80-byte
  headers, 160 hex characters) — including the live `sidestr:dreamlab`
  announcement carried in `fixtures/live-33333.json`. Since 0.0.3
  `headerWidth` reads the width from the content, bounded to `TIP_HEADERS`
  headers and hex-checked before slicing; this crate applies the same bound.
  The kernel's own NIP-333 reader (`schema/codec/nostr.js`) uses 160. Here the
  family is inferred from the length, or taken from the chain's parent; a
  length that fits both is refused rather than guessed.
- Refusals are typed errors with the reason, not `null`.
- Kind 33502 is decoded by structure into `PegRecord | Pledge | Ambiguous`,
  never guessed; siding reads every 33502 as a pledge.
- Kinds 33500 and 33501 are conformant to SPEC prose only: upstream has no
  implementing code or wire example for either.
- No socket: siding uses the platform's `WebSocket`. Here the NIP-01 messages,
  the two subscriptions and the on-receipt checks are pure, and I/O is a
  `RelayClient` port the caller implements.

## Status — 0.2.2

Every codec has encode → decode round-trip tests and rejecting tests. Proven
against the reference:

- events built and signed here for the disposable `sidestr:trial` key are
  byte-identical — tags, content, id and signature — to siding's `tipEvent`
  and `makeEvents` output over the kernel's hash and curve
  (`tests/oracle.rs`, `fixtures/oracle-vectors.json`; the key is
  `sidestr-core`'s `fixtures/trial/trial.key`, read from the sibling crate when
  present, verify-only otherwise);
- sixteen live kind-33333 announcements from nine chains, fetched read-only
  from public relays, verify and parse (`tests/live.rs`,
  `fixtures/live-33333.json`, each with the relay and time it was received).
  Nothing was published to any relay;
- the level-2 envelopes (23510–23514) carry a co-signing round between a
  Rust signer and the reference's JS signers on one chain, in both
  directions (`sidestr-round`'s `tests/interop_round.rs` and
  `tests/interop_pegout.rs`).

Elsewhere in the stack: relay I/O (a tokio websocket client behind
`sidestr-round`'s `relay` feature) and the round logic itself — entitlement,
one signature per height, the seal — are `sidestr-round`'s. Not yet: pledge
verification against a parent view, NIP-333's bulk `u`-tag channels, the
assets and pool records.

## Running the checks

```sh
cargo test                                   # unit, oracle vectors, live fixture, doctests
RUSTDOCFLAGS="-D warnings" cargo doc --no-deps
cargo clippy --all-targets -- -D warnings && cargo fmt --check
```

## Licence

AGPL-3.0-only, as a derivative work of siding. See [LICENSE](LICENSE). This
crate is **not dual-licensed**: a crate that links it is AGPL-3.0 in effect and
should say so.
