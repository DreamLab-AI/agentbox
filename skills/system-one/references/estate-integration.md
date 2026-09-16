# Estate integration map

**Status: foundation. Nothing below is wired. This is the design surface for the next
pass — a list of candidate invocation points with their egress posture and the
question that has to be answered before each is built.** Do not read any entry here as
a description of running code.

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
