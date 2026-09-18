# Estate integration map

**Status: one invocation point is live; the seven candidates below are not wired.** The
candidates are the design surface for the next pass — each with its egress posture and the
question that has to be answered before it is built. Do not read any *candidate* entry as a
description of running code.

## Live

### 0. Skill routing (ADR-2091, 2026-09-16)
**Where** — `config/hooks/skill-route.cjs` on `UserPromptSubmit` and `/route`
(`skills/skill-router/scripts/route.mjs`), both over `config/hooks/lib/skill-route.cjs`.
**Judgment** — one Choice per turn: every routable skill's frontmatter description as the
option rubric (ADR-2089 `status` composed at the point of use), plus a `none` option; the
user's turn is the state. Gate: `[skills.routing].router = "jev" | "table"`.
**Replaced** — nothing removed: the always-loaded descriptions and the routing table are the
fail-open fallback (timeout, 429/529, any error, no key, `none`), and the hook never retries.
**Egress** — accepted for this use only (ADR-2090); per-project gates deferred.
**Measured** — 90% soft accuracy over 115 candidates + `none` (3 reps × 40 items, 0 failed
calls), 676–1,100 ms, ~14.8k input tokens, **$0.00062 per route**.

The reason this file exists: a typed-judgment primitive is not mainly a thing to build
apps with. It is a component other skills and services call, and the interesting
decision is *where in an existing pipeline a judgment replaces a heuristic or an LLM
prompt-and-parse step*. Each candidate is scored the same way — what it replaces, what
it would cost, what class of data it would send, and what has to be true first.

## Candidates

### 1. Knowledge-graph annotation and contradiction detection
**Where** — `ontology-augment` / the `ontology-bridge` MCP surface (Oxigraph/Whelk,
~5,975 OWL classes). Judgments: classify a relationship type, judge whether two
records contradict, score whether a proposed enrichment is supported by its evidence.
**Replaces** — human triage of governed write-back proposals.
**Egress** — *middle ground at best, must-not-leave in parts.* The ontology schema is
one thing; instance data carrying provenance about people and private projects is
another. The split is not currently drawn.
**Open** — can a proposal be judged from the class/axiom layer alone, with instance
text withheld? If not, this waits on a local backend.

### 2. Retrieval reranking
**Where** — `deep-research`, `web-researcher`, RuVector search results.
**Judgments** — per-candidate relevance Score against the query, comparable across
candidates; a Noul for "does this actually answer the question".
**Replaces** — ranking by embedding cosine alone. Directly relevant to the known
low-recall namespaces: a cheap reranker over a wider candidate set is the standard
answer to weak first-stage retrieval, and it does not touch the HNSW index.
**Egress** — depends entirely on corpus. Public web candidates, fine. Private
namespaces, no.
**Open** — is a rerank over public candidates measurably better than the current
order, on the existing recall-gate fixture set? That is a cheap, self-contained
experiment and the best first thing to build.

### 3. Guardrails and semantic lints
**Where** — `build-with-quality` quality gates; hook points around agent input and
output.
**Judgments** — jailbreak/injection detection, policy violation, sensitive-data
exposure, tool-call error, response-quality failure; project-specific conventions as
semantic lints in CI.
**Replaces** — regex heuristics and, in places, an LLM reviewing another LLM at full
frontier cost.
**Egress** — agent traces are middle-ground; they routinely contain paths, hostnames
and private content. Redaction is a prerequisite, not a refinement.
**Open** — is a guardrail that fails open acceptable, given the vendor is a remote
dependency? A gate that silently passes when the API is unreachable is worse than no
gate, and a gate that blocks when it is unreachable is an availability coupling.

### 4. Model routing
**Where** — the ADR-041 per-activity model routing, the AoE `router` seed.
**Judgments** — classify intent and domain, Score difficulty and risk, Noul for "needs
escalation to an expensive model".
**Replaces** — static routing rules.
**Egress** — the prompt being routed is whatever the user typed. That is the widest
possible data class and the least controllable. Routing decisions on private work
would send private prompts to a third party on every turn.
**Open** — arguably the most valuable and the least safe. Only plausible for a
restricted surface with a known-public data class.

### 5. Structured extraction over documents
**Where** — `podcast-ingest`, `explainer` corpus work, document pipelines.
**Judgments** — pre-parsed value selection (extract candidates in code, select in the
model, copy in code), structure recovery, hierarchical classification.
**Egress** — per corpus.
**Open** — nothing structural; this is the most conventional use and the easiest to
evaluate.

### 6. Feature extraction for classical ML
**Where** — anywhere with labelled outcomes: task success, routing outcomes, recall
gates.
**Judgments** — probabilistic features over natural-language fields, combined with
structured data to train a model against ground truth.
**Open** — do we have enough labelled outcomes for any target worth predicting? Answer
this before building anything; without labels this is not a use case.

### 7. Shared-agent-learning confidence
**Where** — the `colloquy` crates, whose confidence counts authorising principals.
**Judgments** — whether a proposed precedent is supported by its cited evidence;
whether two precedents conflict.
**Open** — `colloquy-core` is published, pure and wasm-capable. A remote HTTP
dependency does not belong in it. Any integration is a consumer-side concern, above
the core crate, and must not add a network edge to the standard.

### 8. Verbatim context compaction — evaluated 2026-09-18, not integrated
**What** — [tamaratran/fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction)
(MIT, v0.3.0, 2.2k stars in a day, 29/29 unit tests pass offline here). Replaces Claude
Code's compaction *summary* with Jev decisions: every non-pinned tool call gets two Noul
questions (keep the call? keep its result verbatim?); calls under `keepThreshold` 0.5 are
dropped, results are truncated to 300 chars; user and assistant text is never touched. The
whole conversation goes to Jev as state (results replaced by size notes, fitted into 25k
tokens through six shrink stages); questions are batched into ≤30k-token requests run
concurrently. Falls back to the built-in summary on any error or <25% reduction.
**Blocker 1 — harness.** It is a Claude Code *function-hook* plugin (`session.compact`,
`turn.complete`, `$.http.fetch`) needing **2.1.274+**; the image bakes **2.1.257**
(`lib/claude-code-binary.nix`), which contains none of those symbols. npm has 2.1.276.
Rebuild-class bump with the usual blast radius.
**Blocker 2 — egress.** ADR-2090 covers the routing *prompt* only. This sends the **entire
transcript** — every user turn, every assistant turn, every tool input (Write contents,
Bash commands, up to 1k chars each) — and transcripts here routinely carry `email-search`
answers, `personal-context` recall and private KG data: three must-not-leave classes above.
No per-session exclusion exists. This needs its own operator decision; it is not covered.
**Cost, measured against the last 7 days of this container's transcripts** (66 busy
sessions, ≥20 tool calls/active hour): a busy agent-hour is **43 tool calls, 81 API calls,
~140k tokens ingested**; sessions run to the 1M window (peak seen 1,000k). At
`compactAtPercent` 60 that is one compaction per ~1–4 busy hours; each costs ~4 requests ×
≤30k tokens = **$0.005 in Jev**. A ten-agent swarm: **≈ $0.05/hour**. Negligible.
**The cost that is not negligible — residency.** The built-in summary drops a 600k context to
~10–20k; this keeps 60–75% of it verbatim. Every one of the next ~81 API calls per hour then
re-reads ~350–450k more cached tokens: at Opus 5 cache-read ($0.50/MTok) that is
**≈ $14–18 per busy agent-hour, ≈ $150/hour for ten agents**, until the next compaction.
The same finding as ADR-2089 and §Mid-run routing: the judge is free, our context is not.
Against that: no lossy summary, so fewer re-reads of files and fewer repeated mistakes —
real, but unmeasured, and the only thing that could justify the residency bill. On a 200k
window the ratio holds and the absolute numbers are 5× smaller.
**Verdict** — do not integrate as-is. Worth revisiting only as a **local-backend** design
(no egress) and after a measured A/B on task success against the built-in summary, which the
skill-tuning harness could run. If the operator accepts the egress anyway, the build order
is: bump the Claude Code pin → manifest gate `[features.jev_compaction]` default **off** →
register the marketplace in `settings.json` from the entrypoint → an ADR that widens
ADR-2090 explicitly, with the residency figure in its Consequences.

## Cross-cutting open questions

1. **Where does the call live?** A skill that tells an agent to call an HTTP API, a
   Rust client crate (the `loom-client` precedent), or an MCP server? The estate's
   pattern for a façade with a swappable backend already exists and argues for a thin
   client crate plus a façade, not per-caller HTTP.
2. **Fail-open or fail-closed, per call site?** Must be explicit and in an ADR, as it
   is for every other middleware layer here.
3. **Does this ride an adapter slot?** The adapter contract covers durable state.
   Judgments are not durable state, so probably not — but persisted judgment outputs
   might be, and that needs deciding before anything writes them.
4. **Observability.** Every adapter dispatch here emits span, log and metrics. A
   judgment call should be no different: the question set, the answers, the
   distribution and the composition step all need to be inspectable, or failures
   cannot be attributed. `evaluation.md` §Diagnosis depends on it.
5. **Cost and rate ceiling.** Unknown at estate traffic. Needs a measured number
   before any always-on gate is proposed.

## Suggested build order

1. Reranking over a public corpus, measured against the existing recall fixtures —
   smallest, safest, produces a real number.
2. Structured extraction on a public document set — exercises state design and
   candidate coverage.
3. Guardrails on a redacted trace stream — only after (1) and (2) have produced
   calibration experience.

Everything else waits on the boundary decisions in `data-boundary.md`.
