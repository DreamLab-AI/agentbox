# colloquy-nostr

The Nostr binding for [`colloquy-core`](https://crates.io/crates/colloquy-core)
knowledge units: six event kinds, a tag grammar, content-authoritative decoding,
and ledger reconstruction that counts *authorising principals* rather than
accounts.

```toml
[dependencies]
colloquy-nostr = "0.2"
```

## What it does not do

It does not sign, and it does not verify signatures. Both belong to whoever
holds the key — pass verified events in, get templates out, and hand those to
your own signer. That keeps this crate free of key material and free of crypto
to get wrong. The NIP-01 event structs are defined here (`event::NostrEvent`,
`event::UnsignedEvent`) and serialise identically to any other implementation's,
so a caller with its own Nostr library converts at the boundary.

## Kinds

| Kind | Name | Shape | `d` tag |
|---|---|---|---|
| 38210 | KnowledgeUnit | addressable (NIP-33) | unit id hex |
| 38211 | Confirmation | regular, append-only | — |
| 38212 | Flag | regular, append-only | — |
| 38213 | Supersession | regular | — |
| 38214 | Graduation | regular | — |
| 38215 | ToolGapSignal | addressable (NIP-33) | cluster tag |

The replaceable/append-only split is load-bearing. A unit is replaceable so its
proposer can fix their own wording without forking its identity; confirmations,
flags and graduations are regular events, so evidence accretes and **the
proposer of a unit cannot rewrite what others said about it**.

## Content is authoritative; tags are an index

Every fact a consumer acts on is read from the event's JSON content, which the
signature covers as a whole. Tags exist so a relay can filter cheaply. A tag that
disagrees with the content is an error, never a silently preferred value:

```rust
use colloquy_nostr::{unit_from_event, DecodeError, event::NostrEvent};
# use colloquy_core::{kind::UnitKind, time::Timestamp, unit::{Insight, KnowledgeUnit}};
# use colloquy_nostr::unit_event;
# let t = Timestamp::from_secs(0);
# let unit = KnowledgeUnit::propose("did:nostr:a", UnitKind::Pitfall, ["wire"], Insight::new("s","d","a"), t);
# let u = unit_event(&unit, &"ab".repeat(32), t);
# let mut ev = NostrEvent { id: "e1".into(), pubkey: u.pubkey, created_at: u.created_at,
#     kind: u.kind, tags: u.tags, content: u.content, sig: "0".repeat(128) };
// A `d` tag that disagrees with the content's own id:
ev.tags[0][1] = "ffffffffffff".into();
assert!(matches!(unit_from_event(&ev), Err(DecodeError::IdentifierMismatch { .. })));
```

A unit whose content does not hash to the id it claims is refused the same way.

## An unregistered pubkey is dropped, not self-authorising

`ledger::reconstruct` folds a subscription's worth of events into per-unit
evidence, and resolving a pubkey to its authorising principal is the one place
the trust model could be defeated. The tempting default — "if we don't know who
authorises them, they authorise themselves" — hands an attacker unlimited
principals for the cost of generating keys, so unknown members are dropped and
the drops are *reported*: "nobody confirmed this" and "three people confirmed
this and the registry is stale" are different situations.

```rust
use colloquy_nostr::ledger::{PrincipalResolver, StaticRegistry};

let mut registry = StaticRegistry::default();
registry.register_agent("aa".repeat(32), "did:nostr:operator");

assert!(registry.resolve(&"aa".repeat(32)).is_some());
assert!(registry.resolve(&"bb".repeat(32)).is_none());
```

## Changelog

### 0.2.0 (2026-09-21) — breaking, wire

The six kinds moved from `38100`-`38105` to `38210`-`38215`. The original block
sat inside `38100`-`38199`, which agentbox ADR-009 and PRD-004 had already
reserved for agent-response events and which a live consumer still reads as a
range, so a reader could not tell a knowledge unit from an agent response. The
new block sits in the agentbox second allocation band `38202`-`38299`, which no
record reserves (agentbox ADR-2105). Nothing else changed: the tag grammar,
content encoding and ledger reconstruction are identical. Any event published
under the old kinds must be republished.

## Licence

Apache-2.0, matching [cq](https://github.com/mozilla-ai/cq) and `colloquy-core`.
