# colloquy-core

A clean-room Rust implementation of the [cq](https://github.com/mozilla-ai/cq)
shared-agent-learning standard: knowledge units, the pitfall → workaround →
tool-recommendation → gap-signal ladder, diversity-weighted confidence over
authorising principals, and per-kind staleness decay.

Agents that work alone rediscover the same failures independently. cq is an open
standard for stopping that: agents **query** a shared store before acting,
**propose** what they learned, **confirm** what held, **flag** what rotted, and
graduate durable knowledge upward through a human gate.

```toml
[dependencies]
colloquy-core = "0.1"
```

## Pure by construction

No clock, no I/O, no network, no store. Every time-dependent function takes
`now` as an argument, so the crate drives a native agent runtime and a
`wasm32-unknown-unknown` edge worker while both compute byte-identical
confidence for the same evidence.

```rust
use colloquy_core::{
    confidence::Ledger, kind::UnitKind, principal::Attestation,
    time::Timestamp, unit::{Insight, KnowledgeUnit, UnitStatus},
};

let t0 = Timestamp::parse_rfc3339("2026-01-01T00:00:00Z").unwrap();

let mut unit = KnowledgeUnit::propose(
    "did:nostr:scribe",
    UnitKind::Workaround,
    ["http", "retry-semantics"],
    Insight::new(
        "A regenerated idempotency key turns one retry into two charges",
        "The client mints a fresh key per attempt, so the provider sees distinct requests.",
        "Derive the key from the order id, never from the attempt counter.",
    ),
    t0,
);

// Proposing is not confirming: an agent cannot bootstrap its own confidence.
assert_eq!(unit.lifecycle.status, UnitStatus::Draft);

let mut ledger = Ledger::default();
ledger.confirm(Attestation::agent("auditor", "did:nostr:bob", t0.plus_secs(3_600)));
ledger.confirm(Attestation::human("did:nostr:alice", 0.9, t0.plus_secs(7_200)));
ledger.apply(&mut unit, &Default::default(), &Default::default(), t0.plus_secs(7_200));

assert_eq!(unit.lifecycle.status, UnitStatus::Active);
assert_eq!(unit.evidence.contributing_orgs, 2);
```

## The two rules worth knowing

**Confidence follows principals, not confirmations.** cq's trust model says
three confirmations from three independent parties outrank eight hundred from
two. Implemented over *accounts*, that rule is defeated by anyone who can create
accounts — and in an agent estate, creating an account is a command. So every
attestation is folded onto its **authorising principal** before it is weighed: an
operator's fifty agents count once.

```rust
# use colloquy_core::principal::{collapse, Attestation, ConfirmationPolicy};
# use colloquy_core::time::Timestamp;
# let t = Timestamp::from_secs(0);
let swarm: Vec<_> = (0..50)
    .map(|i| Attestation::agent(format!("agent-{i}"), "did:nostr:one", t))
    .collect();
let independent: Vec<_> = ["a", "b", "c"]
    .iter()
    .map(|p| Attestation::agent(*p, format!("did:nostr:{p}"), t))
    .collect();

let policy = ConfirmationPolicy::default();
assert_eq!(collapse(&swarm).len(), 1);
assert!(policy.weigh(&collapse(&independent)) > policy.weigh(&collapse(&swarm)));
```

**A flag suppresses nothing.** Flagging lowers a unit's standing and marks it
`Disputed`, which is still served. Only a signed decision retires a unit, so no
single member can remove knowledge from the store by objecting to it.

## Relationship to cq

The wire schema is cq's, and the crate is tested against cq's own published
`knowledge_unit.json` example: it parses, and a round trip rewrites nothing.

Two fields are additions, and both are additive so interoperability holds:

| Addition | Why |
|---|---|
| `Graduation::authorising_event` | cq records an approver as a string (`"human:alice@acme.dev"`). An identifier for the *signed* decision behind the promotion makes the same claim checkable by a third party. Omitted entirely when absent, so a cq-written unit round-trips byte-identically. |
| `UnitStatus::Disputed` | Separates "contested" from "withdrawn", so a flag can lower standing without any one member being able to suppress knowledge. |

An implementation that does not model dispute will refuse to parse a disputed
unit rather than silently read it as active — which is the correct failure.

## Licence

Apache-2.0, matching cq.
