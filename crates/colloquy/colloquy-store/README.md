# colloquy-store

One `KnowledgeStore` contract over cq's three tiers: a local append-only file,
shared vector memory, and a Nostr relay.

```toml
[dependencies]
colloquy-store = "0.2"
```

| Tier | Implementation | Retrieval | Backed by |
|---|---|---|---|
| Local | `LocalStore` | keywords | a JSON-lines file, or nothing |
| Shared | `SharedStore` | vectors | your `VectorBackend` |
| Public | `RelayStore` | tag filters | your `RelayBackend` |

The retrieval underneath differs; nothing above the trait knows that. A
deployment moves a namespace between tiers by changing configuration, which is
the property cq's tier architecture exists for.

## Transports are traits

`VectorBackend` is four methods; `RelayBackend` is three. This crate owns the
*mapping* — which is where the mistakes live — and your deployment owns the
transport, so the mapping is testable without a database or a network, and this
crate holds no credentials and no key material.

```rust
use colloquy_store::{KnowledgeStore, LocalStore, Query};
use colloquy_core::{kind::UnitKind, principal::Attestation, time::Timestamp};
use colloquy_core::unit::{Insight, KnowledgeUnit, UnitStatus};

# tokio::runtime::Runtime::new().unwrap().block_on(async {
let t = Timestamp::from_secs(0);
let store = LocalStore::in_memory();

let unit = KnowledgeUnit::propose(
    "did:nostr:scribe", UnitKind::Workaround, ["http"],
    Insight::new("Retries double-post", "The key is regenerated per attempt.",
                 "Derive it from the order id."),
    t,
);
store.put(&unit, t).await.unwrap();

// Proposing is not confirming. Someone else has to.
let a = store.confirm(&unit.id, Attestation::agent("auditor", "did:nostr:bob", t)).await.unwrap();
assert_eq!(a.status, UnitStatus::Active);

let hits = store.query(&Query::text("idempotency retries"), t).await.unwrap();
assert_eq!(hits.len(), 1);
# });
```

## Three behaviours worth knowing

**Rewriting a unit preserves the evidence against it.** Evidence belongs to the
unit's identity, not to a particular wording of it, so a proposer correcting a
typo cannot discard the flags others filed.

**Ranking needs both halves.** `Hit::rank` is relevance × evidence. Relevance
alone serves confident nonsense that happens to share words with the question;
evidence alone serves the store's best-established unit regardless of what was
asked.

**Gap signals are withheld from agents by default.** A level-4 tooling-gap
signal is a message to whoever decides what to build, not advice to act on.
Serving them into retrieval is how a store starts answering "how do I do X" with
"several people wish X were easier".

## Changelog

### 0.2.1 (2026-09-22)

Documentation only: `missing_docs` is denied. The full history is in
`CHANGELOG.md`.

### 0.2.0 (2026-09-21) — breaking, wire

Follows `colloquy-nostr` 0.2: the relay store's kinds moved from `38100`-`38105`
to `38410`-`38415`, out of the agent-response range agentbox ADR-009 reserved
and into the second allocation band `38400`-`38499` (agentbox ADR-2105). The
`KnowledgeStore` trait and every local/shared behaviour are unchanged.

## Licence

Apache-2.0, matching [cq](https://github.com/mozilla-ai/cq) and `colloquy-core`.
