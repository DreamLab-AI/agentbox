---
name: system-one
license: MIT
status: foundation
description: >-
  Build software around small typed AI judgments used as programming primitives —
  a model call returning a `choice`, an ordered `score`, or a 0–1 probability your
  code branches on, instead of prose you prompt-and-parse. Covers designing the
  judgment set, batching independent questions into one call, composing the answers
  in code, and calibrating thresholds on your own data. Backend is TypeSafe's
  System One API (model Jev; Choice / Score / Noul primitives), whose live docs are
  read per task. Use when a feature needs programmable common sense — routing,
  ranking, reranking, extraction, moderation, guardrails on another model's input or
  output, verification, ML feature extraction, knowledge-graph annotation — when an
  LLM prompt-and-parse step should become a structured decision, or when the user
  asks for TypeSafe or Jev by name. NOT for generating text, code or explanations,
  NOT before the egress decision in references/data-boundary.md, and NOT for exact
  lookups, arithmetic or rules code already decides.
triggers: "typesafe, jev, system one, system-one, typed judgment, choice/score/noul, noul, structured decision, classifier instead of prompt, rerank candidates, llm guardrail, semantic lint"
compatibility: "Claude Code and Codex both read this SKILL.md. Live-doc reads use WebFetch in Claude Code; a Codex/GPT-6 Astra session uses its own fetch tool or `curl` against the same URLs. Fan-out over many candidate judgments may use the Agent tool in Claude Code; sequential in Codex. No MCP server and no Claude-only affordance is required to build an integration."
related_skills: [ontology-augment, build-with-quality, deep-research, codebase-memory, autoresearch, adaptive-communication]
env_vars: [TYPESAFE_API_KEY]
---

# System One — typed judgments as primitives

A **System One model** takes a `state` (your content, records and policy) plus a set
of typed **questions**, and returns one typed answer per question. No generated text,
no parsing. Your code owns the workflow; the model supplies semantic understanding at
the points where ordinary code cannot decide.

The current backend is TypeSafe, whose flagship model is **Jev**. The primitives:

| Primitive | Answers | Returns |
|---|---|---|
| **Choice** | which of these options? | `choice`, `probabilities`, `confidence` |
| **Score** | which level on a described scale? | `score` (can fall between levels), `legend`, `probabilities`, `confidence` |
| **Noul** | is this statement true? | `noul` — probability of yes, 0–1, no separate confidence |

All three mix freely in one request, evaluated in parallel and in isolation against
the same state. Adding a question costs its own tokens and barely any latency.

## Read the live docs — they are the source of truth

**This skill does not mirror the API reference, and must not start to.** The vendor's
docs move; a copy here would rot silently and be trusted anyway. This skill holds what
the vendor cannot know: where these judgments belong in *this* estate, what may leave
the LAN, and how to prove a judgment set works before shipping it.

Read the live docs as part of the task, not as background:

1. Start at the index — `https://docs.typesafe.ai/llms.txt` — and read targeted pages.
2. Mintlify serves markdown by appending `.md` to a page path, e.g.
   `https://docs.typesafe.ai/concepts/state.md`. Resolve relative links against
   `https://docs.typesafe.ai`.
3. Before writing an integration, read the current API or SDK page **and** the closest
   cookbook. A cookbook usually shows a better decomposition than a generic classifier.
4. If live access fails, say so, fall back to `references/primitives.md` and the
   installed SDK's types, and do not invent version-dependent details.

`references/live-docs.md` — the page map, fetch discipline, and what to do offline.

## Before you build: the egress gate

TypeSafe is a **cloud API**. Every byte of `state` leaves this network. That is a real
tension with the estate's LAN-only reasoning posture (the Ontology Loom exists because
of it), and it is a decision to be made explicitly per use case, not assumed.

**Read `references/data-boundary.md` before the first call on any new data class.** It
carries the classes that must not leave (owner's personal mail, private context
portfolio, private KG contents), the ones that may, the redaction patterns for the
middle ground, and the local-backend fallback when the answer is "must not leave".

**When the data class is not obvious, ask the user before the first call** — one
question naming what would be sent and to whom. Do not infer consent from the task
being assigned. Equally, a user who asks for Jev or TypeSafe by name has chosen the
backend, not waived the boundary: the classes listed as must-not-leave stay closed,
and the honest answer there is the local fallback or a redacted state.

Keep `TYPESAFE_API_KEY` server-side. Never in a browser bundle, never in an artifact,
never in a published page. Key material lives in `.env` at the repo root.

## Find the useful shape

Start from the behaviour the application must produce — what it shows, selects,
changes or hands off — and work backwards to the judgments it needs. Keep known
rules, arithmetic, exact lookups and execution in code. These patterns are starting
points, not a taxonomy:

- **Route and fill arguments.** A request selects a handler *and* its typed parameters.
  Ask branch-specific questions speculatively; consume only the applicable answers.
- **Select instead of generate.** Find candidate values or source spans in code, use a
  judgment to pick the intended one, then copy or normalise it in code.
- **Find and judge evidence.** Retrieve candidates, score relevance to the query, keep
  the useful context. This is the rerank stage in a retrieval pipeline.
- **Turn judgments into reusable data.** Score dimensions once; let code or user
  controls change weights, thresholds and views without re-running inference. With
  labelled outcomes those signals become classical ML features.
- **Verify and escalate.** Check a specific claim or field against its evidence; send
  uncertain or failing cases to a person or a reasoning model.
- **Respond to changing state.** Code retains goals and observations; fresh judgments
  guide the next bounded step. Keep inferred state distinct from observed fact, and
  check freshness before applying an answer to a situation that has moved.

`references/composition.md` — fan-out, composite scoring, cascades, and when a second
request is genuinely warranted.

## Design the judgments

Choose the primitive by what the answer *means*:

- **Choice** — one of a known, unordered set. Give the full option list; add an
  `other` / `none` option when the list may not cover every input.
- **Noul** — a clean yes/no where the probability itself is the signal. A Noul near
  0.5 means yes and no are equally likely, **not** medium intensity. Use one Noul per
  label when several labels may apply at once.
- **Score** — a position on a spectrum whose levels you can describe concretely. Each
  level must stand on its own as a situation, not as a bare adjective.

Ask **one narrow, coherent judgment per question**. If a judgment needs extended
reasoning or weighs independent factors, split it and weight the parts in code — then
a change of priorities is a coefficient edit, not a prompt rewrite.

Give each question the state it needs: source text, identities, relationships, policy,
current facts. Prefer a named JSON object over a bare string once the state has parts,
and reference nested fields from `instructions` with backticked paths such as
`` `ticket.messages[0].text` ``. **Question IDs are not sent to the model** — put the
complete meaning in `instructions`. For source-value selection, check candidate
coverage first: the model cannot choose a value you omitted.

`references/primitives.md` — request shape, question anatomy, answer-space shapes, and
the design rules that repeatedly decide whether a judgment set works.
`references/sdk-and-build.md` — HTTP vs the Python SDK, the documented response-shape
discrepancy between the vendor's own pages, and why the SDK should not go into the
image closure for this.

## Compose and verify

- **Batch every question that shares a state into one request**, speculative ones
  included; state each speculative premise explicitly and let code discard the
  irrelevant answers. Split only when an answer is needed to *fetch* evidence, to
  *build* the next state, or to *choose* the next question's options.
- **Thresholds are calibrated on your data and your consequences**, never copied from
  a cookbook. Choice/Score `confidence` summarises how peaked the distribution is — it
  is not a warrant to act and says nothing about whether the workflow is correct.
  Spread probability across several acceptable answers is not an error.
- **Keep policy explicit and raw judgments reusable.** Weighted sums suit compensating
  preferences; "any serious violation blocks" needs separate conditions. Changing a
  weight or a display filter must not require re-running inference.
- **Typed output guarantees the interface, not the truth.** Validate performance in the
  target domain before trusting it. `references/evaluation.md` — how to build the
  fixture set, calibrate thresholds, and separate missing evidence from model error,
  code error and service failure.

## Where this plugs into the estate

This is a primitive other skills and services call, not only a thing to build apps
with. The candidate invocation points — knowledge-graph annotation and contradiction
detection via `ontology-augment`, retrieval reranking in `deep-research`, guardrails
and semantic lints under `build-with-quality`, model routing, email triage — are
mapped, with their egress posture and their open questions, in
`references/estate-integration.md`. **None of them are wired yet**; that file is the
design surface for the next pass, not a description of running code.

## Status

Foundation layout (2026-09-16). The judgment-design and composition guidance is
distilled and usable now; the estate integration points, the local-backend fallback
and the eval harness under `scripts/` are scaffolded and named but not built. See
`references/estate-integration.md` §Open questions before extending.
