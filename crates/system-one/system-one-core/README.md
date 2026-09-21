# system-one-core

The **System One** typed-decision protocol in pure Rust: wire types, validation,
token budgeting, option fitting, state windowing and window aggregation.

A System One endpoint answers three primitives about a piece of state, without
generating text:

| primitive | question | answer |
|---|---|---|
| `choice` | which of these named options applies? | one option key plus a distribution over all of them |
| `score`  | where on this ordered scale does the state sit? | a position, plus the band distribution |
| `noul`   | is this proposition true of the state? | a probability |

This crate performs **no I/O**, spawns nothing, and does not depend on an async
runtime, so it compiles to `wasm32-unknown-unknown` and suits a server, a
client, a CLI or a test harness alike. For the HTTP side, see
[`system-one-client`](https://crates.io/crates/system-one-client).

```toml
[dependencies]
system-one-core = "0.1"
```

## Two engine shapes, one protocol

The adaptations below are a response to what a *particular* engine is, not a
universal truth, so this crate models the difference explicitly rather than
hard-coding one engine's limits. `capability::EngineCapabilities` carries what
an engine declares at `GET /v1/models`; `budget::OptionCostModel` names the
structural difference (options sharing one head budget, versus each option
scored in its own sequence); `budget::offer_options` is the unbounded
counterpart to `budget::fit_options`.

Two rules keep that safe. A *missing* capability field means the engine did not
declare itself and the conservative, shared-head shape applies — silence is
never read as freedom. An explicit `null` is a declaration that the limit does
not exist. And `max_len` always binds, so state windowing stays live whatever
else an engine declares.

Where options are scored independently, declining stops competing with the
candidates for one probability mass and becomes a threshold on the best
option's absolute score: `expand::expand_choice_with_decline`.

## What it is for

Small typed-decision encoders have a context of 512–1024 tokens. Real questions
do not: a router asks one `choice` over 115 options, and a compaction judge asks
about 25,000 tokens of state. Bridging that gap naively is not a matter of
truncation, because the truncation an encoder does on your behalf is *silent*:

* every option is hard-cut to 48 tokens, tail-first, mid-sentence;
* if the options still do not fit, each is squeezed to
  `max(4, (head_max_len - 16) / n)` tokens — four tokens apiece at 115 options —
  with no error raised. The answer looks normal and means nothing.

So this crate makes those cuts *deliberate* and refuses the ones that cannot be
made honestly:

* [`compress::compress_rubric`] compresses an option's rubric to the cap
  deterministically, front-loading the most discriminative clause rather than
  letting position decide what survives;
* [`budget::fit_options`] shortlists to a plan that provably fits, and returns
  `BudgetError::OptionsUnfittable` rather than a plan the encoder would squeeze;
* [`window::window_state`] splits an oversized state into overlapping,
  character-boundary-safe windows, optionally anchored at the end when recency
  is what matters;
* [`aggregate`] recombines per-window answers — `noul` by maximum, `choice` by
  relevance-weighted sum renormalised, `score` by relevance-weighted mean;
* [`expand::expand_choice`] re-expands the result over the caller's **original**
  option keys, with shortlisted-away options at exactly `0.0`;
* [`validate::validate_response`] enforces that last rule, so a shortlisting bug
  becomes a loud failure instead of a quietly narrowed world.

Every constant that encodes an encoder's behaviour cites its provenance in its
own documentation, in the form `laya 0.3.4, <file>:<symbol>`. The token estimate
is a documented heuristic and says where it is wrong and in which direction.

## Example

```rust
use indexmap::IndexMap;
use system_one_core::{budget::{fit_options, OptionBudget}, QuestionKind};

let criteria: IndexMap<String, String> = (0..40)
    .map(|i| (format!("skill-{i}"), format!("does job number {i} for the operator")))
    .collect();
let ranked: Vec<&str> = criteria.keys().map(String::as_str).collect();

let plan = fit_options(
    QuestionKind::Choice,
    "pick the best skill",
    &criteria,
    &ranked,
    &OptionBudget::default(),
)
.unwrap();

assert_eq!(plan.selected.len(), 8);   // shortlisted to k
assert_eq!(plan.dropped.len(), 32);   // reported, not hidden
assert!(!plan.would_squeeze());       // the invariant, as an assertion
```

A worked end-to-end adaptation — fit, window, aggregate, re-expand, validate —
is in the crate-level documentation.

## Licence

Apache-2.0.
