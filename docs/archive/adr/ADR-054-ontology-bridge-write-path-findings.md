# ADR-054: Ontology-bridge write-path findings from the terminology live test

**Status**: Proposed
**Date**: 2026-08-15
**Context**: A terminology-canon exercise (VisionFlow ADR-006) used the ontology-bridge
MCP tools in anger for governed writes and discovery. Two defects and one confirmation
came out of it. Related: ADR-051 (Loom client), PRD-020/ADR-112 (pervasive ontology
binding).

## Confirmed working

`ontology_propose` **amend** runs the full governed path as designed: Whelk consistency
gate, conflict gate, staged proposal with cryptographic receipt (envelope hash, provenance
graph hash, idempotency key), ACSP human approval pending. Live example: proposal
`7de21296-eb88-49d0-848e-48c2f8d28a52` amending `urn:ngm:class:knowledge-graph`.

## Defect 1 — `ontology_propose` create path is unusable

- The create handler reads a `subject` field that the MCP tool schema never defines, so
  every create fails with `subject 'undefined' not in local corpus` (backend:
  `local-markdown`).
- `target_iri` is required on create, although the schema documents it as amend-only.
  Supplying it changes the failure from missing-field validation to the `subject` lookup
  above, which shows the two paths disagree about where the class identifier lives.

Fix: map the create payload's `owl_class`/`target_iri` to the handler's subject
resolution, and align the schema docs. Until then, class creation goes through raw
markdown in the corpus plus a pipeline build — which matches the architecture (pages are
the source of truth) but bypasses the Whelk pre-gate that `ontology_propose` exists to
provide.

## Defect 2 — discover-backed search is degraded

`ontology_search` and `kg_node_search` return uniform relevance scores (0.55 / 0.45),
empty `preferred_term`/`definition_summary`/`domain` fields, and unrelated classes for
plain queries ("context graph" → cryptography classes). The Loom façade's
`/loom/scaffold` retrieval over the same corpus is precise for the same queries. Either
the discover endpoint's index is stale/empty or the scoring path is broken; the bridge is
currently not a usable discovery surface, and agents following PRD-020 guidance get noise.

Fix: diagnose the VisionClaw discover endpoint the bridge delegates to; add a canary
query with a known-good expected class to the bridge health check so silent degradation
is visible.

## Defect 3 — staged proposals never reach the governance panel

The staged amend (`7de21296`) sits in the proposal store with `acsp: pending`, but the
forum governance panel never shows it. Relay interrogation (2026-08-15) rules out the
allowlist for the keys in play: the system key `11ed6422…` and the human approve key
`b4165401…` both have accepted events stored on the edge relay — yet **no kind-31402
action request exists for `7de21296` at all**. The event was never emitted. The WS6
elevation flow has a publisher (`lib/elevation-publisher.js`, deliberately fail-open);
the `ontology_propose` staging path has none. `acsp: pending` therefore means "waiting
for a publication step that is not wired", and the proposal is invisible to the human
it is waiting for.

Interim: decide staged proposals via the service route the broker bridge already uses
(`POST /api/enrichment-proposals/{id}/decide`, `X-Agent-Key`-gated) or the control-centre
operator path. Fix: emit a kind-31402 action request from the proposal spine on staging,
through the same publisher the elevation flow uses — and keep the env-file warning in
mind: any *new* system signing key must be added to the relay's D1 allowlist by hand, or
its events are silently refused and this defect's symptom reappears with a different
cause.

## Consequences

- Governed creates are blocked until Defect 1 lands; the terminology exercise shipped its
  three new classes via corpus markdown instead.
- Agents needing retrieval should prefer `ontology_ask` / the Loom scaffold over
  `ontology_search` until Defect 2 is resolved.
