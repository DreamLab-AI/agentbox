# DDD-021: Typed Decision Domain

**Date**: 2026-09-20
**Status**: Proposed
**Bounded Context**: Typed Decisions — putting a bounded, typed question to a judge of finite capacity and returning an answer over the caller's own vocabulary (**BC24**)
**Placement**: `docs/archive/ddd/` is the frozen pre-consolidation corpus and is not authority; the DDD series is continued here beside the living scope documents. The compliance surface is [`docs/GOVERNANCE-capabilities.md`](../GOVERNANCE-capabilities.md); the decision is [ADR-2094](../adr/ADR-2094-local-capacity-adapting-typed-decision-facade.md).
**Cross-references**: [PRD-023](./sovereign-system-one.md) (the product case this domain models), [ADR-2094](../adr/ADR-2094-local-capacity-adapting-typed-decision-facade.md) (façade, adaptation policy, locality fence), [ADR-2089](../adr/ADR-2089-skill-status-and-measured-discovery.md) (the measured baseline and the "confidence is not a safety net" rule), [ADR-2090](../adr/ADR-2090-skill-routing-prompt-egress.md) (accepted routing egress), [ADR-2091](../adr/ADR-2091-live-skill-router.md) (the router consumer), [ADR-2093](../adr/ADR-2093-jev-verbatim-compaction.md) (the compaction consumer and the email taint fence), [ADR-2023](../adr/ADR-2023-loom-facade.md) (the façade pattern this domain reuses), [ADR-2084](../adr/ADR-2084-one-published-loom-client-for-every-facade-caller.md) (one published client per façade), [ADR-2030](../adr/ADR-2030-permissive-licensing-for-publishable-service-crates.md) (Apache-2.0 for publishable crates), [ADR-2020](../adr/ADR-2020-capability-gating.md) (manifest gating, byte-identical-when-off), [DDD-016](../archive/ddd/DDD-016-memory-learning-domain.md) (RuVector/embedding geometry — consumed, not owned).

---

## TL;DR for newcomers

*Skip if you already know that a typed decision is a question with a closed answer
vocabulary, and that the whole domain exists because the judge's context is smaller than
the question.*

This bounded context owns what happens between a caller's typed question and a typed
answer: validating the question, discovering how much the judge can actually read,
reducing the question to fit without changing what it asks, and re-expanding the answer so
it is stated in the caller's own vocabulary rather than the reduced one. The aggregate
root is the `DecisionRequest`. The domain does **not** own the judge's weights, the
embedding model, the consumers' fail-open behaviour, or the decision about what may leave
the network — it consumes all four.

**If you remember only one thing:** a `DecisionRequest` may be *reduced* to fit a
`CapacityBudget` but never *narrowed* — the answer's probability mass is always stated
over the caller's original `Criteria` keys, with what was reduced away declared.

For the deep version, keep reading.

---

## Domain Purpose

The truth this domain owns is **the correspondence between the question asked and the
question judged**. A caller poses a `Question` whose answer is drawn from a closed
vocabulary it supplied. A judge has a finite `CapacityBudget`. When the question does not
fit, something must give, and the only acceptable thing to give is *how much of the
question the judge reads* — never *what the answer may say*. Everything in this context
exists to make that reduction principled, bounded and declared.

Three things make this a domain rather than a serialisation layer. First, **vocabulary
integrity**: an answer over eight options when the caller offered one hundred and fifteen
is a different answer wearing the same shape, and only the caller knows that. Second,
**capacity is discovered, not assumed**: the budget is a property of the deployed judge
and changes when the judge changes, so a hard-coded budget is a latent wrong answer.
Third, **locality is a fact about the deployment, not about a string**: whether an answer
can be sought at all, for a given class of content, depends on where the judge runs, and
that must be asserted by configuration rather than inferred from a URL.

Nothing here owns the model, the embedding backend, the consumers' fallback paths, the
egress policy (ADR-2090/2093), or the manifest gate. It owns the request, the budget, the
reduction, the aggregation and the declaration.

---

## Bounded Context Definition

**Boundary**: the typed-decision surface — from a well-formed `DecisionRequest` at the
façade's door to a `DecisionResponse` stated over the caller's vocabulary, including the
capacity discovery and the reduction in between.

**Owns** (IN):

- The `DecisionRequest` aggregate — a `State` plus a set of named `Question`s, validated,
  fitted to a `CapacityBudget`, judged, and re-expanded.
- The `CapacityBudget` value object — `{max_len, head_max_len}` as *reported by the
  deployed judge*, never as configured.
- `Shortlist` and `Window` — the two reduction value objects, each carrying its own
  provenance (what was dropped, from how many, by what ranking).
- `Aggregation` — the per-primitive rule that folds multi-window results into one answer.
- The `AdaptationReport` (`sso` on the wire) — the declaration of every reduction applied.
- `BackendLocality` — the boolean fact that the judge runs on the LAN, sourced from
  resolved configuration.
- The anti-corruption boundary against the Jev wire protocol (below).

**Does not own** (OUT):

- **The judge.** Weights, checkpoints, inference, the `~30 ms`. Consumed through one
  internal port; this domain never reasons about what the model knows.
- **Embedding geometry** (DDD-016). `bge-small-en-v1.5` at 384 dimensions is consumed for
  cosine ranking; the model-lifecycle freeze (ADR-2019) is not this domain's to change.
- **Consumer fail-open.** The router's fallback to the table and compaction's fallback to
  the built-in summary belong to ADR-2091 and ADR-2093. This domain fails **loud**.
- **Egress policy.** What may leave the network is ADR-2090/ADR-2093 and
  `data-boundary.md`. This domain supplies the locality *fact*; it does not decide what
  that fact permits.
- **The taint classification.** `taint_tools` and the email prefix list stay ADR-2093's,
  enforced in `policy.mjs`. This domain contributes one input to that decision.
- **Manifest gating and boot projection** (ADR-2020, `agentbox-manifest`).
- **Skill descriptions and their `status` composition** (ADR-2089/2083). They arrive as
  `Criteria`; their authorship is elsewhere.

---

## Ubiquitous Language

| Term | Definition |
|---|---|
| **State** | The material the judge reads to answer. A string, or an object rendered to `key: value` lines in a stable key order. Rendering is deterministic because a window boundary that moves between runs makes two runs incomparable. |
| **Question** | One named, typed ask: `{type, instructions, criteria?}`. A `DecisionRequest` carries one or more, answered independently over the same `State`. |
| **Criteria** | The answer vocabulary the caller supplies: an option→rubric map for `choice`, an ordered band list for `score`, absent for `noul`. **The caller's `Criteria` keys are the only legal answer vocabulary** (I01). |
| **Choice** | Primitive: pick one `Criteria` key. Answer carries `choice`, `confidence`, and `probabilities` over **all** original keys. |
| **Score** | Primitive: a position on an ordered band list. Answer carries `score` (continuous), `distribution`, `confidence`. |
| **Noul** | Primitive: a single probability that the `instructions` hold of the `State`. No criteria, no vocabulary, so never shortlisted — only windowed. |
| **CapacityBudget** | `{max_len, head_max_len}` as reported by the deployed judge at `/v1/models`. The question's head cost (instructions + criteria) is subtracted from `max_len` to size windows. Discovered per deployment, never configured (I03). |
| **Shortlist** | The reduction applied to a `Choice` whose `Criteria` exceed the budget: options embedded as `"<option>: <rubric>"`, cosine-ranked against the rendered `State`, top `shortlist_k` retained plus every key in `shortlist_always`. Below `k = 2` the request is refused (`options_unfittable`), never guessed (I05). |
| **Window** | The reduction applied to a `State` larger than the budget: overlapping slices (default 25% overlap) sized to `max_len` minus head cost, ranked per question by cosine against `instructions + criteria`, top `window_k` evaluated. |
| **Aggregation** | The rule folding per-window answers into one: `noul` = max (a fact present in any window is present); `choice` = relevance-weighted probability sum, renormalised; `score` = relevance-weighted mean. Configurable per deployment; the default is the measured one, and changing it invalidates the measurement (I06). |
| **AdaptationReport** | The declared record of every reduction — `{shortlisted: {name: {from, to}}, windowed: {name: {windows, selected}}, engine_ms, facade_ms}`. Additive on the wire, never required by a consumer, never absent when a reduction occurred (I04). |
| **BackendLocality** | The boolean fact that the judge runs on the LAN. Sourced from resolved configuration, default `false`, **never inferred from a URL string** (I07). |
| **ContentClass** | A `data-boundary.md` classification of the `State` (must-not-leave / may-leave / redacted-middle). Consumed as a precondition by callers; this domain never classifies. |
| **Judge** | The engine answering the primitives. Reached on loopback through one internal port. Swappable behind the façade, exactly as the Loom's model is (ADR-2023). |
| **Façade** | The sole ingress. Owns validation, capacity discovery, reduction, re-expansion and declaration. Has no non-LAN upstream (I08). |

---

## Aggregates and invariants

**Aggregate root: `DecisionRequest`.** Consistency boundary = one request's `State`, its
`Question` set, the `CapacityBudget` in force, every `Shortlist` and `Window` derived from
them, the judged results and the re-expanded `DecisionResponse`. `CapacityBudget` is a
second, independently refreshed aggregate (it belongs to the judge's lifecycle, not the
request's) and is read into a request at admission.

Invariants (domain law):

- **I01 — Vocabulary integrity.** Every `choice` answer is one of the caller's original
  `Criteria` keys, and `probabilities` covers **all** of them, with reduced-away options
  at exactly `0.0`. A response that omits an offered key is malformed, not compact.
- **I02 — Reduce, never narrow.** A reduction changes how much the judge reads. It never
  changes what the answer may say. Any adaptation that cannot preserve I01 is a refusal,
  not a reduction.
- **I03 — Capacity is discovered.** The budget comes from the deployed judge. A hard-coded
  or configured budget is prohibited: it survives a judge swap and silently starts
  truncating.
- **I04 — Every reduction is declared.** A response whose request was shortlisted or
  windowed carries the real counts in its `AdaptationReport`. An undeclared reduction is
  indistinguishable from an engine that read everything, which makes every measurement
  built on it unattributable.
- **I05 — Refuse rather than guess.** When no reduction fits (shortlist below `k = 2`,
  a window smaller than the head cost, a malformed question), the façade returns a typed
  error. It never returns a plausible answer. Fail-open is the caller's, not the
  façade's.
- **I06 — The default aggregation is the measured one.** A deployment may configure a
  different rule; a measurement taken under a non-default rule is a measurement of that
  rule and may not be reported against the ADR-2089 baseline. An aggregation also changes
  the *statistic* a downstream threshold was calibrated against — a max over `k` windows is
  stochastically larger than one judgement over the whole state — so any consumer constant
  tuned before aggregation existed is either re-calibrated or recorded as un-recalibrated.
  The calibration is the consumer's (ADR-2093's `keepThreshold` is not this domain's to set);
  the **declaration** that the statistic moved is this domain's, and rides `AdaptationReport`
  per I04.
- **I07 — Locality is asserted, never inferred.** `BackendLocality` is an explicit boolean
  passed from resolved configuration, defaulting `false`. It is never derived from a
  hostname, a URL, an IP literal or a network probe. A fence a typo can open is not a
  fence.
- **I08 — No non-LAN upstream.** The façade has no cloud fallback on any path — not on
  engine failure, timeout, degraded mode or behind a flag. The judge binds loopback and
  the façade is its sole ingress.
- **I09 — Usage is what was consumed.** `usage.input_tokens` counts what the judge read,
  not what the caller sent. The two differ by exactly the reduction, and conflating them
  hides it.
- **I10 — Confidence is not a gate.** No component in this context may branch on a
  probability threshold. A wrong pick was measured at 0.94 (ADR-2089); locality changes
  the cost of a wrong answer, not its detectability.
- **I11 — One protocol type set.** Request/response types, validation, token estimation
  and budget fitting live in exactly one crate (`system-one-core`) which both the client
  and the façade depend on. A second hand-rolled copy of the wire shape is prohibited
  (ADR-2084's lesson: three callers each knew a different subset).

---

## Anti-corruption boundary — the Jev wire protocol

The wire format is **not** this domain's model. It is a published language belonging to a
third party (TypeSafe's System One), which two consumers already speak and which we
conform to so that adopting a local judge requires no consumer change. The boundary is a
conformist relationship with a translation layer, and it has four rules:

1. **Conform on the wire, own the model inside.** `system-one-core` owns
   `DecisionRequest` / `Question` / `CapacityBudget` / `Shortlist` / `Window` /
   `AdaptationReport` as domain types; serde renders them into the Jev shape at the edge.
   Nothing inside the façade reasons in wire JSON.
2. **Extensions are additive and namespaced.** Our own concepts reach the wire only under
   `sso`, which a Jev-speaking consumer ignores by construction. We never repurpose a
   field of theirs to mean something of ours, and we never make a consumer read ours.
3. **Their shape is non-normative for our behaviour.** Recorded TypeSafe responses are
   golden *fixtures* that our client must parse identically — evidence of compatibility,
   never a specification of what the façade must decide. Where their semantics are
   unspecified (multi-window aggregation, shortlist re-expansion) our rule is ours, stated
   in I02/I06 and declared per I04.
4. **Translation failure is loud.** A request our model cannot represent is a typed 4xx at
   the boundary; a judge response our model cannot accept is a 5xx. The translation layer
   never repairs, defaults or infers a field into existence — that is how a protocol
   divergence becomes a silent behavioural one.

### The judge's shape is outside the boundary

The reduction exists because *this* judge has a shared head budget and hard-truncates each
option to 48 tokens: one forward pass reads instructions, every option and the state together,
so the options compete for one budget. That is a property of the judge, not of the domain. A
cross-encoder judge scores each `(state, option)` pair in a separate pass, so options stop
competing, rubric compression stops being necessary and `Shortlist` degrades from a
correctness requirement to a cost control — while `Window` may disappear entirely under a long
context.

None of the invariants move. I01/I02 still bind because the caller's vocabulary is a fact about
the caller; I03 still binds because the budget is still discovered, merely a different shape;
I04 still binds because a cascade that reranks *k* survivors has still reduced something; I05,
I07–I11 are untouched. What changes is only which reductions are in force, which is exactly the
line a bounded context is supposed to draw. `CapacityBudget` is therefore modelled as the
judge's report rather than as `{max_len, head_max_len}` semantics the domain believes in, and
`AdaptationReport` names the reduction applied rather than assuming one was.

The same boundary runs the other way: `system-one-client` speaks to *either* backend, so a
behavioural difference between the cloud judge and the local one surfaces as a client-level
observation (`system-one-eval`'s parity diff) rather than as three callers' private
guesses. That is ADR-2084's precedent applied to a second façade.

---

## Context map

| Relationship | Neighbour | Pattern |
|---|---|---|
| **Conformist** | TypeSafe System One (Jev wire protocol) | Published language of a third party; we conform on the wire and translate at the edge. Additive `sso` namespace only. |
| **Customer–Supplier (downstream)** | The judge (`laya-engine`) | We are the customer: we consume `/predict` and `/v1/models`. The supplier owns weights and inference and reports its own budget. Swappable: a candidate cross-encoder judge is recorded in ADR-2094 and would change the reductions in force, not the invariants. |
| **Open Host Service** | Skill router (ADR-2091), compaction plugin (ADR-2093) | The façade publishes one protocol both consume unchanged. Their fail-open behaviour is theirs; our failure is loud. |
| **Consumes geometry** | DDD-016 Memory-Learning | `bge-small-en-v1.5` @ 384-dim for cosine ranking, under the ADR-2019 freeze. We embed and cache; we do not own the column. |
| **Consumes policy** | ADR-2090 / ADR-2093 / `data-boundary.md` | Supplies `BackendLocality` as an input to the taint decision; never makes the egress decision. |
| **Shares pattern, not code** | The Ontology Loom (ADR-2023, BC-Loom) | Both are stable doors with swappable capability behind them. Separate protocols, separate clients, no shared transport. |
| **Governed by** | ADR-2020 manifest gating | One gate, off by default, byte-identical when off. |

---

## Migration / sequencing

The context comes into existence protocol-first: `system-one-core` (I01–I06, I09, I11) is
complete and tested before any server exists, because the invariants that matter are
properties of the reduction, not of the deployment. `system-one-client` and the golden
fixtures establish the anti-corruption boundary next, against the *existing* cloud backend
— which proves conformance before there is a local judge to confuse it with. The judge,
the façade and the gate follow. I07 (`backendLocality`) is wired into `policy.mjs` **last**
and independently, because it is the only change in this programme that can weaken an
existing security control, and it should not land in the same breath as the code that
makes it tempting to enable.

No consumer is repointed before `system-one-eval` has produced a parity run against the
cloud backend and the ADR-2089 baseline.
