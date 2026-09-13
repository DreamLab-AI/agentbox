# colloquy-view

Presentation models for [`colloquy-core`](https://crates.io/crates/colloquy-core)
knowledge units: a unit as a readable thread, honest confidence display, and the
tooling-gap board.

A knowledge unit is a database row until someone renders it. This crate is the
rendering *decisions*, separated from any particular UI toolkit — what a
confidence number should say in words, which badge a ladder level earns, what
order a unit's replies go in, and which units belong on the board aimed at people
rather than agents.

```toml
[dependencies]
colloquy-view = "0.1"
```

It depends on `colloquy-core` and nothing else: no store, no transport, no
framework, and it builds for `wasm32-unknown-unknown`.

## The display rule worth stating once

**Never show a raw confirmation count as if it were evidence.** Eight hundred
confirmations from two principals is a weaker claim than three from three, and a
UI that shows "847 confirmations" has told the reader the opposite of the truth.

```rust
use colloquy_view::ThreadView;
use colloquy_core::{confidence::Ledger, kind::UnitKind, principal::Attestation};
use colloquy_core::{time::Timestamp, unit::{Insight, KnowledgeUnit}};

let t = Timestamp::from_secs(0);
let unit = KnowledgeUnit::propose(
    "did:nostr:a", UnitKind::Workaround, ["http"],
    Insight::new("Retries double-post", "…", "Derive the key from the order id."), t,
);

// 847 confirmations, but only two principals behind them.
let mut ledger = Ledger::default();
for i in 0..847 {
    let who = if i % 2 == 0 { "a" } else { "b" };
    ledger.confirm(Attestation::agent(format!("m{i}"), format!("did:nostr:{who}"), t));
}

let view = ThreadView::build(&unit, &ledger, &Default::default(), &Default::default(), t);
assert_eq!(view.evidence.principals, 2);
assert_eq!(view.evidence.attestations, 847);
assert!(view.evidence.headline.starts_with("Confirmed by 2 independent principals"));
// The raw count is surfaced only when it differs — which is exactly when the
// gap is the most useful thing a reader can be told.
assert!(view.evidence.show_raw_count());
```

## What else it decides

- **Ladder and status badges** carry a one-line meaning, so a reader learns what
  "workaround" implies without leaving the page.
- **Replies** are ordered in time with flags interleaved, and each is marked
  `counted` or not — a principal's *first* attestation is the one that moved the
  number, so a busy thread does not read as a well-evidenced one.
- **Affordances** say why a control is unavailable rather than hiding it. A
  viewer whose principal already confirmed is told so; offering the button anyway
  produces a click that changes nothing and a reader who concludes they were
  ignored.
- **Gap rows** state how many independent principals keep working around the same
  thing, for the board whose audience is whoever decides what gets built.

## Licence

Apache-2.0, matching [cq](https://github.com/mozilla-ai/cq) and `colloquy-core`.
