# sidestr-round

Level 2 of [sidestr](https://github.com/sidestr/spec) sidechains, usable now:
the `k`-of-`n` co-signing round as a pure state machine that interoperates on
the wire with the reference signer as it runs today, the peg-out PSBT round
over rust-bitcoin, a durable vote journal, and `cosign`, a runnable signer.

The proposer for a height is signer `height mod n`; after `proposeAfter`
seconds the next in the ring may propose too. A proposal is a kind-23510
event, a partial signature a 23511, the sealed block a 23514; a peg-out is a
PSBT round on 23512/23513. All of it as `round.mjs` and `pegoutround.mjs` put
it on the wire, so a Rust signer co-signs with JS signers and the reverse —
proven by the tests, three signers on one box, in both mixes and both
directions.

```toml
[dependencies]
sidestr-round = "0.1"
```

```rust
use sidestr_core::block::pubkey_of;
use sidestr_core::federation::{seal_federated, partial_signature, Federation};
use sidestr_core::state::State;
use sidestr_core::document::ChainDocument;
use sidestr_round::journal::MemoryJournal;
use sidestr_round::round::{Action, Round, RoundConfig};
use sidestr_round::signer::LocalKey;

// a 2-of-3 document beside a stock parent, its genesis sealed by two keys
let keys: Vec<_> = (1u8..=3).map(|i| bitcoin::secp256k1::SecretKey::from_slice(&[i; 32]).unwrap()).collect();
let pubs: Vec<_> = keys.iter().map(pubkey_of).collect();
let fed = Federation::new("sidestr:doc", pubs.clone(), 2).unwrap();
let doc = ChainDocument::from_json(&format!(r#"{{"id":"sidestr:doc","name":"doc","parent":"tbtc4","challenge":"{}",
  "powLimit":"7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","addressPrefix":"dc","genesisTime":1790000000,
  "pegs":[],"signers":["{}","{}","{}"],"threshold":2}}"#, fed.challenge().to_hex_string(), pubs[0], pubs[1], pubs[2])).unwrap();
let genesis = State::build_genesis_for(&doc).unwrap();
let mut sigs = std::collections::BTreeMap::new();
for i in [0, 1] { sigs.insert(pubs[i], partial_signature(&sidestr_core::block::Stock, &genesis, &fed, &keys[i], &[0u8; 32]).unwrap()); }
let genesis = seal_federated(&sidestr_core::block::Stock, &genesis, &fed, &sigs).unwrap();

// three signers, each with its own chain and journal; the time is an argument, I/O is an action
let mut chains: Vec<State> = (0..3).map(|_| State::from_genesis(doc.clone(), &genesis, None).unwrap()).collect();
let mut rounds: Vec<Round<sidestr_core::block::Stock>> = (0..3)
    .map(|i| Round::new(&chains[i], Box::new(LocalKey::new(keys[i])), Box::new(MemoryJournal::new()), RoundConfig::upstream(30)).unwrap())
    .collect();
let now = 1_790_000_100_000; // the round's clock is unix milliseconds, as Date.now()
// height 1 is slot 1's turn: a block is due, so it proposes
let actions = rounds[1].tick(now, &mut chains[1], true);
let proposal = actions.iter().find_map(|a| match a { Action::Publish(e) => Some(e.clone()), _ => None }).unwrap();
assert_eq!(proposal.kind, 23510);
// slot 0 checks it against its own chain and answers with a partial
let partial = rounds[0].on_event(now + 1_000, &mut chains[0], &proposal).into_iter().find_map(|a| match a { Action::Publish(e) => Some(e), _ => None }).unwrap();
assert_eq!(partial.kind, 23511);
// with k the proposer seals, adds the block through its validator, and publishes it
let sealed = rounds[1].on_event(now + 2_000, &mut chains[1], &partial);
assert!(sealed.iter().any(|a| matches!(a, Action::Sealed(s) if s.height == 1)));
assert_eq!(chains[1].height(), 1);
```

## What the crate does not claim

This is upstream's protocol: it tolerates `n − k` signers being *down*, not
any being *wrong*. A faulty proposer can strand a height until the timeout
relaxation; two subsets of `k` seal one template to two hashes; entitlement
is clock-based. The vote journal stops a restart from turning into a double
signature and is not anti-rollback. Byzantine tolerance is a separate
protocol above the signature (the estate's ADR-2101), in a separate crate
that replaces `Round`, not the codecs, the federation or the journal.

## Hardening, behind options with upstream's behaviour as default

- Two journal records per authorisation: the intent is written and synced
  before the custody signer is invoked (a failed write means the signer is
  not called), the signature after it answers and before the `Publish`
  action is returned (a failed write means nothing is published). `FileJournal`
  is append-only and `fsync`ed, validated on open, a torn tail cut back to the
  last record; on restart the one-signature rule applies against every entry.
- `resign_after`: `Some(propose_after)` is upstream's relaxation; `None`
  never re-signs a height, nor a burn — co-signing, proposing, or moving from
  the one to the other are one durable guard per burn.
- The round's clock is milliseconds, as `Date.now()`: the reference's
  timing holds at the millisecond (re-signing relaxes at 30 001 ms, a
  proposal of mine is dropped at 90 001 ms); only `created_at` is seconds.
- `wss://` is rustls with the Mozilla root store (feature `relay`).
- A sealed block from another signer is a candidate for the validator, never
  final.
- A proposal is judged by the chain's deterministic rules before its
  transactions reach the mempool's policy.
- A co-signer refuses a peg-out payment whose fee is over a cap, and counts a
  co-signature only after verifying it.

## Running a signer

`cargo install sidestr-round --features bin`, then:

```text
cosign --chain chain.json --dir ~/.sidestr/fed --key-file ~/.sidestr/fed.key \
       --port 3461 --propose-after 30 --relay wss://nos.lol,wss://relay.primal.net \
       --announce-mirror https://mirror.example/fed
```

The key is a file, never an argument. The block directory must already hold
the chain's `blocks.dat` and `blocks.json` from a mirror. With
`--parent-rpc`, `--parent-cookie` and `--parent-wallet` (the federation's
descriptor imported with this key private, as `siding peg-wallet` does),
peg-ins are claimed and peg-outs paid through the PSBT round.

## Status

0.1.0: interoperates with siding at commit
`2de40bdac4cba01be0864156a553d8287c22e279`. Tested against the reference
engine as an oracle: three signers on one box in {Rust, JS, JS} and
{Rust, Rust, JS}, both header families, peg-outs proposed by either engine.
Not yet: a signer on another machine, changing the signer set. Audited
independently (GPT-6 Astra, 2026-09-22); the six findings are closed and
kept as `tests/audit_regressions_*.rs`, and a second pass the same evening
found one more (a failed append rolled the journal back to a cached length
and could destroy acknowledged votes; now measured, and one writer per file
under an exclusive lock); the checklist is in the crate docs'
limits section.

## Attribution

This crate is a port of **siding**, the reference implementation of sidestr by
Melvin Carvalho — [github.com/sidestr/spec](https://github.com/sidestr/spec),
AGPL-3.0 — `siding/lib/round.mjs`, `lib/pegoutround.mjs`, the level-2 parts of
`bin/siding.mjs produce`, `test/round-test.sh`, and `proposals/level-2.md`,
whose description of the round the crate documentation adapts. It carries
the same licence, AGPL-3.0-only. Every ported function names its original.
