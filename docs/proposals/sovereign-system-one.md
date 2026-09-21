---
id: PRD-023
title: "Sovereign System One — a self-sovereign typed-decision capability"
status: scope / pre-ratification (not authority)
date: 2026-09-20
drives: [ADR-2094]
domain: DDD-021 (BC24)
depends_on: [ADR-2089, ADR-2090, ADR-2091, ADR-2093, ADR-2023, ADR-2030, ADR-2084, ADR-2020]
lands_in: docs/GOVERNANCE-capabilities.md (governing) + docs/adr/ADR-2094 (decision)
review_trigger: the first measured accuracy/latency run of the façade against the ADR-2089 baseline, or an upstream laya release changing the context budget
repo: agentbox
---

# PRD-023: Sovereign System One

**On placement.** `docs/archive/prd/` is a frozen corpus (cut 2026-08-31, last touched
only by the consolidation and one addressing sweep) and is explicitly not authority. The
PRD series is continued here, beside the other living forward-looking scope documents,
because the number is the useful thing and the archive is the wrong shelf. This document
is scope, not authority: [ADR-2094](../adr/ADR-2094-local-capacity-adapting-typed-decision-facade.md)
is the decision and [`docs/GOVERNANCE-capabilities.md`](../GOVERNANCE-capabilities.md) is
the compliance surface.

---

## 1. Problem

The estate has two System One consumers and both of them are cloud calls.

| Consumer | Decision | What leaves |
|---|---|---|
| Live skill router (ADR-2091) | one Choice over every routable skill, every turn | the user's turn text, clamped to 12k chars |
| Verbatim compaction (ADR-2093) | two Noul questions per old tool call, every compaction | the conversation — user and assistant text, tool inputs ≤1,000 chars, tool-result *sizes* |

Both go to `https://api.typesafe.ai/v1/systemone` (`jev-latest`). Three consequences
follow, and they are the problem:

1. **An accepted egress, twice widened.** ADR-2090 was an operator decision that routing
   prompts may leave the network, taken on cost grounds with the honest note that "the
   turns where routing matters most are the ones most likely to carry real content".
   ADR-2093 widened the same boundary to the compaction transcript. Neither is an
   oversight; both are debts with a named creditor.
2. **A fence that costs the feature.** Because the backend is remote, ADR-2093 fences
   email-tainted sessions out of compaction entirely — the conservative reading, chosen
   because a message-level redaction of what the model *wrote about* mail cannot be
   asserted. An email-touching session loses verbatim compaction for its whole duration.
3. **The most valuable classes are unjudgeable.** `skills/system-one/references/data-boundary.md`
   lists what must not leave: personal mail, the private context portfolio, private
   knowledge-graph instance data, credentials and key material, client content under
   confidentiality. For these the document already names the only answer — "a local
   backend or no judgment at all". Today it is no judgment at all.

The estate is otherwise deliberately LAN-local in its reasoning posture. The Ontology
Loom exists precisely so private content is reasoned over without leaving the LAN, and it
is the email privacy system. A cloud typed-decision API is the one reasoning surface that
contradicts that posture.

## 2. Evidence

All figures measured on this estate; the routing numbers are the ADR-2089/ADR-2091 runs.

**Read the route-log rows as of their date, not as fixed properties.** `~/.claude/skill-route.jsonl`
is written live by the ADR-2091 hook — a line per turn, including the turns that produced this
document. The counts below are N=115 at time of measurement on 2026-09-20 and the log grows with
use; earlier passes over the same file legitimately read 112 and then 115 lines within one session.
A reader who recounts and gets a larger N should conclude the log grew, not that the evidence was
wrong. Only the derived quantities (mean, median, candidate count) are stable claims, and each is
dated.

| Quantity | Measured | Source |
|---|---|---|
| Routable skills offered per route | 115 (+ `none`), every route over exactly 115 candidates | `~/.claude/skill-route.jsonl`, 2026-09-20 |
| Rendered criteria | 59,004 chars ≈ 14,751 tokens | route-eval criteria render |
| Logged turns | 115 lines — 101 routed (66 of them `none`), 13 short-prompt skips, 1 router-off | `~/.claude/skill-route.jsonl`, 2026-09-20 |
| Input tokens per real route | mean 14,969, median 14,701 | `~/.claude/skill-route.jsonl`, 2026-09-20 |
| Latency | p50 1.1 s, p95 1.4 s | ADR-2091 runtime path |
| Cost | $0.00063 per route | ADR-2091 runtime path |
| Soft accuracy | 90% (36.0/40, 3 reps, 120 calls, 0 failures) | ADR-2089 baseline / ADR-2091 runtime |
| Compaction state | up to 25,000 tokens | ADR-2093 |
| Laya context window | 512–1024 tokens | upstream model card (HF `convaiinnovations/laya`) |
| Laya answer latency | ~30 ms | upstream, self-reported |
| Weights provenance | HF `convaiinnovations/laya`; SDK PyPI `laya` 0.3.4; source GitHub `NandhaKishorM/laya` | registry lookups, 2026-09-20 |

**The gap, stated plainly:** a ~15× overrun on routing and a ~25× overrun on compaction.
Laya answers the same three primitives (choice / score / noul) with open weights
(Apache-2.0) and would close the egress problem outright — but it cannot receive the
requests our consumers send. That single fact is what makes this a product with a design,
rather than a configuration change.

## 3. Capability

**Sovereign System One (SSO): a capacity-adapting façade that speaks the Jev wire
protocol and answers it from a local engine.** The shape is the estate's existing answer
to the same class of problem — the Ontology Loom (ADR-2023) puts a stable door in front
of a swappable model; SSO puts a stable door in front of an engine with a smaller
appetite than its callers.

```
consumer (skill-route.cjs / jev-compaction)
   │  POST /v1/systemone          Jev wire format, unchanged
   ▼
system-one-facade  :8097          option shortlisting · state windowing · embeddings
   │  POST /predict               loopback only
   ▼
laya-engine        127.0.0.1:8098
```

Two adaptations carry the whole capability:

- **Option shortlisting** — embed each `"<option>: <rubric>"`, cosine-rank against the
  rendered state, send the top `k` (default 8), and re-expand the answer so the caller
  still sees probability mass over all of its original keys. `none`/`other` are always
  retained so the judge can decline.
- **State windowing** — split oversized state into overlapping windows, rank them per
  question against `instructions + criteria`, evaluate the top `window_k` (default 2) and
  aggregate by primitive: `noul` by max, `choice` by relevance-weighted sum, `score` by
  relevance-weighted mean.

Everything the façade did to fit the request is reported back in an additive `sso` block
— the real shortlist and window counts, engine and façade milliseconds. That block is the
honesty channel: without it, an accuracy number for SSO would not be attributable to
either the engine or the adaptation.

**The engine is the swappable half.** Laya is the engine because it is the only open-weights
model that answers all three primitives natively, not because it is the best available judge —
that is not yet a measured claim. A cross-encoder judge scores each `(state, option)` pair in
its own forward pass, which removes the 48-token option cap and the shared head budget
entirely at the cost of *k* passes of a far larger model, turning the design into the standard
bi-encoder-shortlist → cross-encoder-rerank cascade that our shortlist stage already supplies
half of. `AlexWortega/openjev` (MIT, an NLI cross-encoder on Qwen3.5-4B) is the first concrete
candidate and is examined in ADR-2094 *Alternatives considered*; it implements no System One
primitive and is a candidate engine, not a plan. Selection is an S1/S2/S3 result, never a
model card.

## 4. Users

| User | What they get | What changes for them |
|---|---|---|
| The skill router (ADR-2091) | the same Choice, answered locally | the endpoint and model name, projected from the manifest; nothing in the hook |
| The compaction plugin (ADR-2093) | the same two Noul questions, answered locally | endpoint and model, plus the `backendLocal` input that governs the email fence |
| The operator | the must-not-leave classes become judgeable; a switch that defaults to today's behaviour | one gate, off by default |
| Future typed-decision consumers | a published client (`system-one-client`) that speaks to either backend | they write against a protocol, not a vendor |

## 5. Scope

**In.**

- The façade, its two adaptations, the persistent embedding cache, `/health` and
  `/v1/models` budget discovery.
- The engine service, English-only deployment, checkpoints preloaded at startup.
- Two publishable crates (`system-one-core`, `system-one-client`) and two internal
  binaries (`system-one-facade`, `system-one-eval`).
- One manifest gate, off by default, with boot projection into both consumers and the
  `./agentbox.sh systemone` lifecycle.
- The `backendLocal` input to the compaction taint fence.
- The measurement rig and the first honest run against the ADR-2089 baseline.

**Out — explicit non-goals.**

- **No cloud fallback in the façade, ever.** Not on engine failure, not on timeout, not
  behind a flag. The consumers already own fail-open to their own built-in paths.
- **Not a general local LLM service.** Three typed primitives, no free-text generation.
  Prose reasoning belongs to the Loom.
- **Not a replacement for the Loom.** The Loom grounds and generates; SSO decides.
- **No business logic in the engine.** Shortlisting and windowing are the façade's; the
  engine loads checkpoints and answers.
- **No confidence-threshold policy.** ADR-2089 measured a wrong pick at 0.94. Locality
  changes the cost of a wrong answer, not its detectability, and no escalation rule may
  be added on the strength of this work.
- **Not a change to what may leave.** Every consumer still pointing at the cloud is
  governed by ADR-2090 and ADR-2093 unchanged; this PRD removes the *need* to egress, it
  does not retract the permission.
- **No source bind mount.** The container bakes its own code (host/container path
  divergence).
- **No second engine in this scope.** A cross-encoder cascade is recorded as a candidate,
  not scheduled; adopting one is a later decision carrying its own measurement.

## 6. Success criteria

Measurable, each against a stated baseline. None of these is claimed today.

| # | Criterion | Target | Instrument |
|---|---|---|---|
| S1 | Routing soft accuracy | ≥ 85% on the ADR-2089 40-item set, 3 reps, against the 90% cloud baseline | `system-one-eval` + `route.mjs --eval` |
| S2 | Parity with the cloud backend | per-item choice agreement reported, disagreements enumerated, not summarised | `system-one-eval` backend-vs-backend diff |
| S3 | Routing latency | p95 ≤ 1.4 s end-to-end (the cloud p95), including embedding and shortlisting | eval rig, ≥ 100 routes |
| S4 | Marginal cost per route | $0.00000 in API spend; GPU residency reported separately and honestly. The cloud unit price is configuration (`AGENTBOX_SKILL_ROUTE_USD_PER_MTOK_IN`) and each log line records the rate it priced at, so a log spanning the migration totals honestly and no cloud-priced "% saved" figure is reported for a local route | manifest + eval receipts |
| S5 | Egress elimination | zero requests to `api.typesafe.ai` from either consumer when the gate is on | packet-level or proxy-level observation, not code reading |
| S6 | Fence correctness | the email fence remains closed for every `backendLocal !== true` path, including `undefined`, `"true"`, and a local-looking URL with the flag unset | `tests/config/jev-compaction-policy.test.mjs` extension |
| S7 | Budget fitting is honest | `sso.shortlisted` / `sso.windowed` counts match what was actually sent on every response | façade unit + golden tests |
| S8 | Off is off | with the gate disabled, both consumers' resolved configuration is byte-identical to the pre-SSO boot | ADR-2020 byte-identical-when-off discipline |

S1 deserves a caution that belongs in the criterion rather than a footnote: the 90%
baseline was measured on a ~14,969-token prompt the local engine cannot receive. SSO is
measured *after* shortlisting, which is a different experiment on the same task. A
shortfall is attributable to the adaptation, and `sso` is what makes that attribution
possible.

## 7. Risks

**Upstream immaturity is the dominant risk, and it is quantifiable.**

| Risk | Fact | Mitigation |
|---|---|---|
| The model repository is days old | GitHub **`NandhaKishorM/laya`** (the source repo) created 2026-09-18; 3,501 stars, 312 forks, 24 open issues, Apache-2.0 | gate off by default; no consumer repointed until S1–S5 run |
| Three identifiers, one project | GitHub `NandhaKishorM/laya` (source) · HF **`convaiinnovations/laya`** (the weights the engine pulls) · PyPI `laya` 0.3.4 (the SDK, published by Convai Innovations, defaulting to the HF id at `laya/agent.py:351`). Different registries, not variants of one name | each pin names its registry explicitly; the engine pins the HF id, the service pins the PyPI version |
| The C++ runtime is days old and near-unused | GitHub `lkarlslund/laya.cpp` created 2026-09-20; 2 stars — a separate project, not a release channel of the above | not on the critical path — the sanctioned engine is the Python SDK |
| Benchmarks are self-reported | the ~30 ms and accuracy figures are upstream's own | every number that governs a decision here is re-measured locally by `system-one-eval` |
| Hardware mismatch | laya.cpp was tested on Blackwell; our GPUs are Ada | latency is an S3 criterion measured on our hardware, never inherited |
| Accuracy loss from adaptation | shortlisting discards 107 of 115 options before the judge sees them | `shortlist_always`, re-expansion over original keys, and the `sso` counts; S1/S2 measure it rather than assuming it |
| Window aggregation is a design choice | max / weighted-sum / weighted-mean is a default, not a proof | the default is what is measured; a non-default rule invalidates the measurement and must re-run it |
| Aggregation moves a calibrated threshold | compaction thresholds each noul at a constant `keepThreshold = 0.5` (`lib/compact.ts:19,104-113`) tuned against one whole-transcript judgement; a windowed noul is a max over `k` windows, which is stochastically larger. Reasoned from the code, **not measured** — no local backend exists to measure against | fails in the safe direction (upward on a *keep* score ⇒ less compaction, never dropping needed material); recorded in ADR-2094 with a review trigger that the first local run reports the distribution of aggregated nouls against 0.5 |
| A weakened fence | `backendLocal` is a new way for the email fence to open | explicit boolean from resolved config, default false, never inferred from a URL; S6 tests the failure modes, not the happy path |
| Licence and weights drift | Apache-2.0 today, open weights today | pinned versions, weights on a named volume, no runtime fetch |
| Betting the design on one engine | laya is the only model answering all three primitives natively; no comparative measurement exists | the façade and `system-one-client` make the engine swappable by construction; a candidate cross-encoder path is already recorded (ADR-2094) and would be selected only by an S1–S3 run |
| Rubric amputation | the engine hard-truncates every option to 48 tokens before budget logic (`laya/common.py`, 0.3.4); a median skill description is ~115 tokens | the façade compresses rubrics deterministically to the cap, front-loading the discriminative clause, caches the result and reports its token count in `sso`; the 4-token squeeze path is never reached |
| Python returns | a supervised Python service | precedented (opf-router, code-interpreter); it is **not** a boot dependency |

**The risk that is not mitigated:** an estate that can judge its private classes locally
will be asked to judge more of them. Every such extension is a new decision against
`data-boundary.md`, not an inherited permission from this one.

## 8. Sequencing

1. Protocol and adaptation in `system-one-core`, with the budget-fitting tests, before any server exists.
2. `system-one-client` and golden parity against recorded TypeSafe responses.
3. Engine service with `/v1/models` budget reporting.
4. Façade, embedding cache, honesty block.
5. Gate, projection, compose, lifecycle — all off by default.
6. `system-one-eval` and the first honest run. **No consumer is repointed before this step.**
7. `backendLocal` wired into `decide()`, with S6's failure-mode tests.
8. ADR-2094 amended with receipts; BASELINE-container amended with the sidecar; activation moved off `inactive` only after a booted run.
