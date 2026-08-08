---
id: ADR-050
title: Decision elevation — the inverse corpus path for durable, governed decision records
status: proposed
date: 2026-08-08
type: data-flow
adr_category: architecture
author: Dr John O'Hare
depends_on: [ADR-048, ADR-049, ADR-047, ADR-023, ADR-033]
amends: ADR-048
prd: PRD-022
domain: DDD-020
policy_decided: 2026-08-08 — broker-gated, significant-only (operator confirmed the recommendation)
review_trigger: decision-record volume makes per-decision broker cases impractical, or the corpus publish policy for decisions changes
---

# ADR-050 — Decision elevation: the inverse corpus path

> Resolves the durability tradeoff documented when the corpus force-full sync
> gained an assert-graph rebuild (`github_sync_service::rebuild_assert_graph`,
> commit `d9b676061`): a corpus `CLEAR GRAPH <urn:ngm:graph:ontology:assert>`
> reload wipes runtime-written decision-record **class triples** from the
> asserted graph. Their provenance survives (separate `:provenance` graph), but
> the decision nodes + causal edges do not. This ADR makes decisions durable the
> *right* way — by routing them **into the corpus** so the same
> sync→rebuild path that re-derives every class re-derives decisions too.

## Context

ADR-048 makes a `DecisionRecord` a first-class node in `urn:ngm:graph:ontology:assert`
(class membership + `dl:caused`/`dl:precedentFor` causal edges), written at
runtime through the governed propose/decision door. That graph now has **two
writers**: the governed runtime door (per-decision) and the corpus bulk-reloader
(`rebuild_assert_graph`, a full `CLEAR` + `INSERT` from the current json-ld
source on `force_full`). The bulk reload is a *correctness* mechanism — it makes
the asserted graph equal to what the corpus says — but it therefore erases any
asserted triple that is **not** re-derivable from the corpus. Runtime decision
records are exactly that: born in the graph, absent from the source.

VisionClaw already solves the symmetric problem for **classes**: the
`ElevationActor` drafts a canonical Class page for a frontier concept, opens a
`KnowledgeEnrichment` broker case (ACSP `ActionRequest` kind 31402), and on an
`approve` (kind 31403) commits the page to the corpus via `GitHubPRService`; the
next sync ingests it. Decisions want the mirror image of this loop.

## Decision

**Add a decision-elevation path: a governed decision is drafted as a corpus
page, gated through the broker, and committed to `jjohare/logseq` on approval, so
the sync re-derives it into the asserted graph on every rebuild.** Decisions
become versioned, PR-governed, re-derivable corpus citizens — the same kind of
citizen as classes — and the `force_full` `CLEAR` becomes a guarantee (assert ==
corpus) rather than a data-loss risk.

The path has two halves; **both are required** for durability-through-resync.

### Write half — the inverse path + broker gate (reuses the elevation machinery)

1. **`CaseCategory::DecisionElevation`** — a new variant in
   `src/domain/broker/broker_case.rs` (alongside `KnowledgeEnrichment`,
   `ContributorMeshShare`). No new broker infrastructure; the inbox, projection,
   and decision handlers already generalise over `CaseCategory`.
2. **`draft_decision_page(decision)`** — mirrors `draft_class_page`: emits a
   markdown page carrying a `dl:DecisionRecord` json-ld block (the `urn:agentbox:decision`
   URN, `rdf:type prov:Activity, dl:DecisionRecord`, summary, rationale,
   `dl:caused`/`dl:precedentFor`/`dl:consideredInput`/`dl:governedBy` edges, and
   a provenance summary linking the `prov:wasAssociatedWith <did:nostr>`
   attribution) at a dedicated corpus namespace (`pages/decisions/` or a
   per-principal namespace, matching `GitHubPRService`'s per-user path rule).
3. **Elevation trigger** — recording a decision (`decision_service`, or a small
   `DecisionElevationActor` subscribing to the decision stream) opens a
   `DecisionElevation` broker case. The decision is already ACSP-governed *as an
   act*; this second gate governs its *publication to the public corpus*.
4. **On `approve`** — `GitHubPRService` PRs the decision page into the corpus,
   tracked to terminal git state exactly like an elevation PR (GOV-2 poll).

### Read half — make it survive resync (the non-obvious half)

5. **Decision-record ingestion.** `rebuild_assert_graph` currently filters
   `owl_class_iri.is_some()` — it captures **classes**, not decision **instances**
   (`dl:DecisionRecord` is a `prov:Activity` individual). The sync/parser must
   recognise decision-record json-ld and re-materialise it into
   `urn:ngm:graph:ontology:assert` on rebuild, so a `force_full` re-derives
   decisions from the corpus. Scope the rebuild's `CLEAR`+`INSERT` to include the
   decision instances (and their causal edges), keeping PROV-O attribution in the
   `:provenance` graph per ADR-049 (the corpus page carries a provenance
   *summary*; the authoritative signed provenance stays in the provenance graph).

### Net data flow

```
agent decision → governed door (conflict → Whelk → ACSP) → :assert (runtime)
              → DecisionElevation broker case → human approve
              → PR decision page → jjohare/logseq (versioned, published)
              → next force_full sync → rebuild_assert_graph re-derives it → :assert (durable)
```

## Decision — elevation trigger/gate policy (DECIDED 2026-08-08: broker-gated, significant-only)

`jjohare/logseq` is public and publishes on merge, so *which* decisions elevate
and *whether* a human gates each corpus commit is an operator policy, not a
default. Options, with recommendation:

| Policy | Effect | |
|---|---|---|
| Broker-gated, **all** decisions | Full corpus audit trail; one broker case per decision (volume) and every approved decision is public | |
| **Broker-gated, significant-only** | Only decisions that caused a graph mutation / carry causal edges / were ACSP-approved elevate; routine/read-only stay runtime-only | **recommended** |
| Auto-PR ACSP-approved (no 2nd gate) | Fastest/most durable; every agent decision hits the public repo with no human corpus-commit review | |
| Write-half only, defer read-half | Decisions archived in corpus now, resync re-derivation later | staged fallback |

**Recommendation: broker-gated, significant-only.** It keeps the public corpus
high-signal, bounds broker volume, and preserves a human gate on what becomes
permanent public record — the control the broker exists to provide. The
significance predicate reuses signals already present at decision time (caused a
mutation / has causal edges / ACSP verdict).

## Consequences

- Decisions gain the same durability guarantees as classes: versioned, diffable,
  rollback-able, re-derivable, and — where governed — publicly auditable.
- The `force_full` `CLEAR` of `:assert` stops being a data-loss risk for
  decisions and becomes a correctness guarantee (assert == corpus).
- No new broker or PR infrastructure — pure reuse of `ElevationActor` /
  `CaseCategory` / `GitHubPRService` / GOV-2 poll; the new code is
  `draft_decision_page`, one `CaseCategory` variant, the elevation trigger, and
  the sync read-half for decision instances.
- Cost: a per-decision (or per-significant-decision) broker case, and decision
  pages in the public corpus. The gate policy above bounds both.
- Requires `LOGSEQ_PRIVATE_REPO_GITHUB` (the same token the class-elevation loop
  already needs); degrades gracefully (GOV-2 DEGRADED) without it.
- **Default-OFF, production opt-in.** The `DecisionElevationActor` starts only
  when `DECISION_ELEVATION_ENABLED=1` **and** `FORUM_RELAY_URL` **and**
  `ACSP_PANEL_NOSTR_PRIVKEY` are set (mirrors the class `ElevationActor`'s
  opt-in). Without them the elevation sink is `None`, `maybe_elevate` is a no-op,
  and decisions commit exactly as before — verified live: a significant decision
  commits `Ok` with no case and no PR when the panel is disabled. Enabling the
  live write-half (broker case-open + PR) is therefore operator config, not code.

## Implementation notes (for the build, once policy is confirmed)

- `src/domain/broker/broker_case.rs` — `CaseCategory::DecisionElevation`.
- `src/actors/elevation_actor.rs` (or a sibling `decision_elevation`) —
  `draft_decision_page`, case-open, approve→PR, GOV-2 tracking.
- `src/services/decision_service.rs` — the elevation trigger (significance
  predicate), non-fatal/fail-open so a broker/PR outage never blocks the governed
  decision itself.
- `src/services/github_sync_service.rs` — `rebuild_assert_graph` read-half for
  decision instances; increment reporting.
- Tests: draft round-trips to a parseable page; significance predicate; a decision
  PR'd and re-synced re-appears in `:assert`; a `force_full` with the read-half
  preserves decisions that the corpus contains and drops those it does not
  (the intended semantics).
