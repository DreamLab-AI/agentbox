---
id: ADR-2075
title: Attest the Loom's loaded generation at the server, instead of asserting it from configuration
date: 2026-09-05
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: e070514d808b218574403377fb75e0e1a0a256b3
verified_paths: []
owner: jjohare
review_trigger: a Loom generation rebuild or model swap, a cache-poisoning or stale-answer incident, or ADR-2023's generation-identity Remaining item being taken up
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: ADR-2023 (Loom façade) — its "Remaining" section names this gap and is its ORIGIN, referenced with `see`, superseded by nothing here; ADR-051 (Loom client, corpusSha pinning); GOVERNANCE-capabilities is the interim authority for the harness-side Loom
---

# ADR-2075 — Attest the Loom's loaded generation at the server

## Context

Diagram **AB-24.9** (`agentbox/24-loom-facade.md:396`) records that generation identity is
asserted by configuration, not attested by the server, and that binding retrieval to the
generation the Loom actually loaded needs a Loom-side identity surface that does not
exist. In the client, generation is an *input*: `resolveBackend` takes it from
`opts.generation`, else `env.LOOM_GENERATION`, else `env.ONTOLOGY_GENERATION`, else `null`
(`mcp/servers/lib/ontology-retrieval.js:474-476`); a request may pin its own
(`:292-295`); and it is keyed into the cache so two generations are two entries
(`:293` comment, `:316,433`). Every one of those values is something the *caller* stated.
Nothing reads the served generation back from the Loom. The consequence is silent and
one-directional: after a corpus rebuild where the config was not updated, answers from the
new generation are cached and reported under the old generation's identity, and no
consumer can detect it. ADR-2023 names this in its Remaining list; it does not close it.

## Decision

**Proposed.** Generation identity is something the Loom states about itself, and the
client's configured value is a *pin to check*, never a label to apply. When taken:

1. **The Loom exposes an identity surface** — a generation descriptor on `/loom/health`
   (or a dedicated endpoint) returning at minimum the loaded generation id, the corpus
   sha it was built from, and its build timestamp. This is a Loom-side change, outside
   this repo, and this ADR is the harness-side statement of the requirement.
2. **The client reads it and reports the attested value**, not the configured one. Every
   retrieval result carries the generation the server reported, alongside the existing
   backend name and (per ADR-2073) the provenance-enforcement flag.
3. **Configuration becomes an assertion that is checked.** When `LOOM_GENERATION` or a
   per-request pin is set and disagrees with the attested value, the request **fails
   labelled** with an explicit generation-mismatch outcome. It does not silently serve the
   other generation, and it does not silently relabel it.
4. **The cache is keyed on the attested generation.** An entry written under an asserted
   generation that later proves wrong is not reusable: keying on the attested value makes
   a rebuild invalidate the affected entries by construction rather than by a manual flush.
5. **Unattested is a state, not a default.** A Loom deployment with no identity surface
   yields results marked `generation: unattested`. That is honest and usable; silently
   substituting the configured value in its place is not, and is prohibited.
6. **Authority.** `GOVERNANCE-capabilities.md` remains the interim authority for the
   harness-side Loom and for the "model swaps behind the façade with zero consumer change"
   invariant; this record adds an attestation requirement to that contract without
   changing the façade's shape.

## Consequences

- The estate gains the ability to prove which corpus generation answered a question — the
  precondition for ADR-051's `corpusSha` pinning meaning anything, and for any audit that
  cites a retrieval result.
- Cost: a Loom-side endpoint (cross-repo), a client change, one extra call per backend
  resolution (cacheable for the life of a connection), and a cache-key change that
  invalidates existing entries once.
- Item 3 turns a class of silent staleness into visible failures immediately after a
  rebuild where config lagged. Those failures already existed as wrong answers; this makes
  them loud.
- The zero-consumer-change model-swap property is preserved: the *model* stays a URL behind
  the façade. Only the *generation* — the corpus the retrieval is against — becomes
  attested, and consumers read it rather than configure it.
- Until the Loom ships the surface, every result is `unattested`, which correctly
  characterises today's state rather than papering over it.

## Verification

`implementation_status: none`. Verified at `e070514d808b218574403377fb75e0e1a0a256b3`:
`mcp/servers/lib/ontology-retrieval.js:474-476` sources generation only from options and
environment; `:292-295` allows a per-request pin; `:316,433` propagate it into result and
cache key. `grep` over the Loom call sites (`/loom/search` `:627`, `/loom/sparql` `:645`)
shows no identity or health read. ADR-2023's "Remaining" records the same fact in its own
words: "asserted by configuration, not attested by the server".

**Acceptance test for the landing change.**

1. Against a Loom serving generation **G2** with `LOOM_GENERATION` unset: every result
   reports `generation: G2`, read from the server, and a fixture asserts the value came
   from the identity surface rather than from environment.
2. With `LOOM_GENERATION=G1` and the server serving **G2**: the call returns an explicit
   generation-mismatch outcome and **no** triples; it does not return G2's answer, and it
   does not label G2's answer as G1.
3. Ask one question against G1, rebuild the Loom to G2, ask the identical question: the
   second call misses the cache and reports `G2` — no manual flush.
4. Against a Loom with no identity surface: results carry `generation: unattested`, and a
   grep confirms the configured value is not substituted into that field.
5. Swapping the model behind the façade with the corpus unchanged leaves the reported
   generation unchanged and requires no consumer edit.

## Estate audit — 2026-09-07

The Rust Loom server already implements GET `/loom/generation` ([Loom routes](../../../../loom/crates/loom-facade/src/routes/mod.rs), lines 51 and 86-88) and [bundle verification](../../../../loom/crates/loom-facade/src/bundle.rs) (lines 210-246). The missing estate seam is the Agentbox consumer: `mcp/servers/lib/ontology-retrieval.js` selects a configured generation and calls search/SPARQL without verifying the served generation endpoint. Retain proposed/none/inactive for this consumer contract; do not describe the server endpoint itself as absent. Require wrong-generation, swapped-bundle, cache and degraded-backend tests before activation. CP-02/03. See the [Agentbox audit](../../../../VisionFlow/docs/estate-review/2026-09-07-agentbox-audit.md).
