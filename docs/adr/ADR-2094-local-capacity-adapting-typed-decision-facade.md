---
id: ADR-2094
title: Answer typed decisions on a local capacity-adapting façade, and relax the email fence only on proven backend locality
date: 2026-09-20
decision_status: accepted
implementation_status: partial
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: b680a7aeef604276af73e00e1eb5156f379530ae
verified_paths: []
owner: jjohare
review_trigger: the first measured accuracy/latency run of the façade against the ADR-2089 baseline, an upstream laya release (GitHub NandhaKishorM/laya, HF convaiinnovations/laya, or PyPI laya) that changes the context budget, a candidate second engine passing system-one-eval, the first compaction run against a local backend reporting the distribution of aggregated nouls against keepThreshold, or any proposal to give the façade a non-LAN upstream
repo: agentbox
domain: GOVERNANCE-capabilities
---

# ADR-2094 — Answer typed decisions on a local capacity-adapting façade, and relax the email fence only on proven backend locality

## Context

Two consumers put typed decisions to TypeSafe's cloud API (`api.typesafe.ai`, `jev-latest`): the
live skill router (ADR-2091) and the verbatim compaction plugin (ADR-2093). That forced an accepted
prompt-egress decision (ADR-2090) and a hard email-taint fence, so the estate's most private classes
(`skills/system-one/references/data-boundary.md`) cannot be judged at all. Laya (Apache-2.0, open
weights) answers the same three primitives — choice, score, noul — locally in ~30 ms, on a 512–1024
token context. Measured 2026-09-20: 115 routable skills render 59,004 chars of criteria ≈ 14,751
tokens, and a real route sends a mean 14,969 input tokens at p50 1.1 s, p95 1.4 s, $0.00063 (N=115
logged turns, 101 routed — a live log that grows with use); compaction sends up to 25,000 state
tokens. That ~15× routing and ~25× compaction overrun rules out a naive swap; the estate's answer to
this shape — a stable door with swappable capability behind it — is a façade (ADR-2023, ADR-2084).

## Decision

1. **A façade, not a backend.** `system-one-facade` (Rust, container port 8097 on
   `visionclaw_network`) serves `POST /v1/systemone` in the Jev wire format consumers
   already send. The engine (`services/laya-engine`, FastAPI + laya) binds **loopback
   only** and is reached solely through the façade. Consumers are not modified to adopt
   a local backend; they are repointed at a door that speaks what they already speak.
2. **Capacity adaptation is the façade's job, and it is policy, not implementation
   detail.** The engine reports its own budget at `/v1/models` (`max_len`,
   `head_max_len`); the façade never hard-codes it.
   - **Option shortlisting** (Choice whose criteria exceed the budget): embed each
     `"<option>: <rubric>"` with `bge-small-en-v1.5`, cache by SHA-256 of the string and
     persist that cache across restarts, cosine-rank against the rendered state, keep top
     `shortlist_k` (default 8) and **always** retain every key in `shortlist_always`
     (default `["none","other"]`) so the judge can still decline. Reduce `k` until the
     request fits; below `k = 2` return `options_unfittable` rather than guess.
   - **Rubric compression is the façade's, not the tokeniser's.** The engine hard-truncates
     every option to 48 tokens unconditionally before any budget logic runs, and squeezes
     all options to `max(4, (head_max_len - 16) // n)` tokens when they still do not fit
     (`laya/common.py:build_sequence`, read at 0.3.4). Our median skill description is ~115
     tokens, so the default path amputates roughly 60% of a rubric mid-sentence, tail-first
     — the failure mode the estate already knows from bge-small's embed cap. The façade
     therefore compresses each rubric to ≤48 tokens **deterministically**, front-loading the
     discriminative clause, caches the compressed form beside its embedding, reports its
     token count in `sso`, and never reaches the squeeze path. A lost marker raises
     `ValueError` upstream; the façade maps that to `options_unfittable`, never to a guess.
     `head_max_len` (192) and `max_len` (512) are raisable config keys, but raising them
     departs from the training distribution, so it is a **measured** choice reported by
     `system-one-eval` at the chosen setting rather than an assumed one.
   - **State windowing** (state larger than the context): render to text with stable key
     order, split into windows sized to `max_len` minus the question's head cost at 25%
     overlap, rank windows per question by cosine against `instructions + criteria`,
     evaluate the top `window_k` (default 2), and aggregate — `noul` by max, `choice` by
     relevance-weighted probability sum renormalised, `score` by relevance-weighted mean.
     The aggregation rule is per-deployment configurable; the default above is the one
     that gets measured, and a measurement against a non-default rule is not a
     measurement of this decision.
3. **The response never narrows the caller's world.** `answers.<name>.choice` is always
   one of the caller's original option keys, and `probabilities` covers **all** original
   options with shortlisted-away options at `0.0` — because `skill-route.cjs` ranks
   `Object.entries(probabilities)` and an advisory line that silently dropped 107 of 115
   options would be a different decision presented as the same one. `usage.input_tokens`
   counts what the engine consumed, not what the caller sent. The additive `sso` block
   (`shortlisted`, `windowed`, `engine_ms`, `facade_ms`) is the honesty channel: it
   reports the real counts and is never required by a consumer.
4. **The façade fails loud; consumers own fail-open.** Errors are HTTP 4xx/5xx with
   `{"error":{"code","message"}}`. The façade never simulates a plausible answer, and
   **never has a cloud fallback path** — not on engine failure, not on timeout, not
   behind a flag. If the engine is down the consumer falls open to its own built-in path
   (the routing table, the built-in summary), which ADR-2091 and ADR-2093 already make
   the normal path rather than an error branch.
5. **The email fence relaxes only on proven locality.** `decide()` in
   `config/claude-plugins/jev-compaction/hooks/policy.mjs` gains an explicit
   `backendLocal: boolean` input. The ADR-2093 taint fence applies whenever
   `backendLocal !== true`. The default is `false`. It is passed by the caller from
   resolved configuration and is **never inferred from a URL string** — a hostname is an
   assertion by whoever wrote the config file, and a fence that a typo can open is not a
   fence. E074 and the `taint_tools` prefix list are unchanged and still refuse a
   manifest that drops the email prefix; `backendLocal` gates *when the fence is
   consulted*, not *what it fences*.
6. **Off by default, rebuild-class.** `[features.sovereign_system_one].enabled = false`
   with `endpoint`, `model`, `shortlist_k`, `window_k`, `embeddings_url` and
   `embeddings_model`. When enabled, `services/agentbox-manifest` projects
   `AGENTBOX_SKILL_ROUTE_API`/`AGENTBOX_SKILL_ROUTE_MODEL` and the jev-compaction
   plugin's `baseUrl`/`model`; when disabled it leaves both untouched, so the cloud path
   is byte-identical to today (ADR-2020). Lifecycle `./agentbox.sh systemone`; compose
   `docker-compose.system-one.yml`; the container bakes its own code, with no source bind
   mount.
7. **The protocol is published, the deployment is not.** `system-one-core` (pure
   protocol, serde, token estimation, budget fitting; no I/O, wasm-capable) and
   `system-one-client` (async client for *any* System One endpoint, TypeSafe or SSO) are
   publishable under Apache-2.0 per ADR-2030 and follow the `loom-client` precedent
   (ADR-2084): one place knows the wire, so a parity difference between backends is a
   client-level fact rather than three callers' private guesses. `system-one-facade` and
   `system-one-eval` stay internal.

## Consequences

- The must-not-leave classes become judgeable for the first time. That is the prize, and
  §5 is the whole of what makes it safe: the fence opens on a boolean the operator sets,
  not on a string the deployment happens to contain.
- Two backends now answer the same protocol, so **parity is a standing obligation**, not
  a one-off migration check. `system-one-eval` exists to run a labelled set against
  either and diff them; a claim that SSO matches Jev is only as good as its last run.
- The ADR-2089 baseline (90% soft accuracy, p50 1.1 s, $0.00063/route) is the bar. It was
  measured against a ~14,969-token prompt that the local engine cannot receive; SSO is
  therefore measured **after** shortlisting and windowing, which is a different
  experiment on the same task. An accuracy loss here is attributable to the adaptation,
  not to the engine, and the `sso` block is what makes that attributable at all.
- Confidence remains not a safety net (ADR-2089, ADR-2091 §5, ADR-2093). A local backend
  changes the cost of a wrong pick, not its detectability. No threshold rule may be added
  on the strength of locality.
- Egress does not shrink until the gate is turned on. ADR-2090 and ADR-2093's accepted
  egress stay in force for every consumer still pointing at the cloud, and the per-project
  routing bypass remains the open debt ADR-2090 recorded.
- New dependencies with short histories. Three identifiers name one project across three
  registries and none is a typo of another: **GitHub `NandhaKishorM/laya`** is the source
  repository (created 2026-09-18, Apache-2.0); **HF `convaiinnovations/laya`** is the weights
  `services/laya-engine` actually pulls; **PyPI `laya` 0.3.4** is the SDK, published by Convai
  Innovations and itself defaulting to the HF id (`laya/agent.py:351`,
  `load(model_id_or_path = "convaiinnovations/laya")`). A fourth, **GitHub
  `lkarlslund/laya.cpp`** (created 2026-09-20), is a separate C++ runtime and is *not* on our
  path — the sanctioned engine is the Python SDK. All carry self-reported benchmarks, and our
  GPUs are Ada rather than the Blackwell laya.cpp was tested on. The gate is off by
  default for this reason as much as any other, and `activation_status` stays `inactive`
  until a measured run exists.
- Python returns as a supervised service dependency (`services/laya-engine`), which the
  estate already accepts for opf-router and code-interpreter; it does not return as a
  boot dependency.
- **A cloud unit price is not a property of the system, and the router library stops treating
  it as one.** `config/hooks/lib/skill-route.cjs` costed every route at Jev's $0.042/MTok
  unconditionally. Against a local backend that computes a meaningless quantity, and a
  flattering one: the local engine also reads ~30× fewer input tokens (14,748 cloud against 486
  local in the golden fixtures), so a cloud-priced column reports "97% saved" when the real
  saving is 100% and the number describes neither backend. The unit price is now configuration
  (`AGENTBOX_SKILL_ROUTE_USD_PER_MTOK_IN`, default unchanged at the Jev rate) and every log line
  carries `usd_per_mtok_in` beside `usd`, so a log spanning the migration still totals honestly.
  The library takes a **price**, never a backend identity, and infers neither from the endpoint
  URL — the same discipline as `backendLocal` in §5, for the same reason: a figure a hostname
  can change is not a measurement.
- **Windowing silently re-calibrates a threshold that was tuned against a different
  statistic.** `decideCall` in the compaction plugin thresholds each noul at a constant
  `keepThreshold = 0.5` (`config/claude-plugins/jev-compaction/lib/compact.ts:19,104-113`),
  calibrated against a single whole-transcript judgement. §3 aggregates a windowed noul by
  **max** across the selected windows, on the sound reasoning that a fact present in any
  window is present. Each is right alone; together they move what is being thresholded — a
  max over *k* windows is stochastically larger than one judgement over the whole, so the
  same `0.5` grows easier to clear as a transcript lengthens and more windows are selected.
  The threshold is a constant; the statistic under it is not. **The invariant: a threshold
  calibrated against an unaggregated judgement must be re-calibrated by any aggregation that
  changes its statistic, or the omission must be recorded.** This record is that recording.
  The bias is upward on a *keep* score, so the failure direction is a transcript that
  compacts less than expected — never one that drops material the assistant still needed —
  which is why this is a consequence with a review trigger and not a blocker. Reasoned from
  the cited code and §3.2, **not measured**: there is no local backend to measure it against
  yet. The first compaction run against one reports the distribution of aggregated nouls
  against `0.5` so the drift is a number rather than an argument.
- **The same audit cleared the other axis.** The compaction plugin consumes only `noul`
  scalars; `probabilities` and `confidence` exist there solely as unused type declarations
  for choice and score (`lib/types.ts:176-184`), so the zero-mass display hazard below has no
  counterpart in it and nothing needs repointing on that axis.
- **Shortlisting makes zero-mass options real, so consumers must stop displaying them.**
  `formatContext()` sliced its top three before filtering zero-probability options, which against
  a shortlisting backend would have advertised two skill names the judge gave no weight to into
  every routed turn — §3 keeps those keys present at `0.0` precisely so nothing silently narrows,
  and a consumer that renders them as candidates inverts that guarantee. It now advertises the
  pick and shows probabilities only where they carry meaning.
- A candidate second engine already exists, which is the point of the door (see
  *Alternatives considered*). Choosing between engines is a `system-one-eval` result, not a
  reading of two model cards; until such a run exists, laya is the engine because it is the
  only one that answers the three primitives natively.

## Alternatives considered

**A cross-encoder engine — `AlexWortega/openjev` (HF, MIT, created 2026-09-16; 294 likes, 0
downloads, ~87.6 GB repo; `Qwen3_5ForSequenceClassification` over Qwen3.5-4B, with a 35B-A3B
MoE variant).** It is **not** a System One implementation and does not claim to be one: it is
an NLI cross-encoder taking premise + hypothesis to entailment / contradiction / neutral, with
`rerank` and `grade` methods. There is no choice-with-criteria, no score, no noul and no
API-compatibility claim. It borrows the name, not the interface, and nothing here treats the
shared name as evidence of anything.

Its relevance is architectural, and it is precisely the case the façade exists to make
possible. A cross-encoder scores each `(state, option)` pair in its **own** forward pass, so
neither the 48-token option cap nor the shared `head_max_len` budget applies and a full rubric
survives to the judge intact — the constraint that forces rubric compression above simply is
not present. The price is *k* forward passes of a 4B (or 35B-A3B) model where laya spends one
pass of a ~421M encoder, which is the classic cascade: a bi-encoder shortlist feeding a
cross-encoder rerank. Our shortlist stage is already a bi-encoder over `bge-small`, so the
cascade is available without a redesign — the façade would shortlist as it does today and
rerank the survivors on the cross-encoder instead of re-expanding an engine's single pass.
Qwen-length context would also dissolve the windowing problem for compaction outright; against
that, compaction's nouls ask whether a tool call retains **future utility**, which is not an
entailment relation, so the semantic fit is weaker exactly where the context advantage is
largest.

Not adopted, and not scheduled. It is recorded as a candidate engine behind the same door,
selectable by a `system-one-eval` run reporting accuracy, parity, p95 and GPU residency against
the laya path and the ADR-2089 cloud baseline. An engine is swapped on a measurement, never on
a vendor claim or a figure from a model card; `system-one-eval` exists so that the sentence has
teeth, and the two publishable crates exist so that a swap costs no consumer a line.

**A naive backend swap** — point the consumers at a local engine and accept truncation — is
rejected by the Context arithmetic: at 115 options the engine squeezes every rubric to 4 tokens,
which is a collapse, not a degradation. **Raising `max_len`/`head_max_len` alone** is not a
substitute either: it departs from the training distribution, so it is a measured setting inside
this decision rather than an alternative to it.

## Verification

No behaviour in this record is verified, and none is claimed. `verified_commit` records the
commit at which the tree was *inspected*, not one at which anything was tested, and
`verified_paths` is deliberately empty so the staleness gate makes no promise on this
record's behalf. `implementation_status: partial` rests on a directory listing and nothing
more: at `b680a7ae` plus the uncommitted working tree, `crates/system-one/` contains
`system-one-core`, `system-one-client`, `system-one-facade` and `system-one-eval`,
`services/laya-engine/` exists, and `tests/system-one/` holds `golden/` and
`routing-cases.json`; `docker-compose.system-one.yml` and the
`[features.sovereign_system_one]` gate do **not** exist. Those paths were inspected for
presence only — no file was read for correctness, no test was run, no binary was built, no
request was made, and at the time of writing the Rust does not compile. The implementing
change is landing alongside this record and its author holds the receipts.

Two classes of external fact in this record *are* source-read, and by whom matters. The
engine internals governing rubric compression — the 48-token truncation, the squeeze
formula, `head_max_len`/`max_len` defaults and left-truncation — were read from the
extracted `laya` 0.3.4 sdist (`laya/common.py:build_sequence`, `laya/agent.py:predict`) on
2026-09-20, not taken from the README, which does not state them. The openjev attributes in
*Alternatives considered* were read from its HF model card and the HF API on the same date.
Both were read by the implementing programme rather than by this record's author; neither
has been re-derived here, and both are re-read rather than trusted if they ever govern a
decision on their own.

This record is amended — not re-pointed — when that change lands, with: `cargo test`
across the new crates (budget fitting, rubric compression determinism, shortlist re-expansion
over the original keys, window aggregation, protocol round-trip, error mapping);
`cargo doc --no-deps` clean for the two publishable crates; golden parity of recorded
TypeSafe-shaped responses through `system-one-client`; a live Choice over all 115 skill
descriptions and a 25k-token compaction-shaped request against a booted sidecar; and
`system-one-eval` against the ADR-2089 labelled set reporting accuracy, p50/p95 and cost
honestly beside the cloud numbers. `activation_status` moves off `inactive` only when the gate
is enabled in a booted image, never on the strength of a passing test.
