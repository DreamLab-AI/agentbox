---
id: ADR-2076
title: Benchmark the agent retrieval path (/loom/search + /loom/sparql) on its own terms, with a frozen recall band
date: 2026-09-05
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: e070514d808b218574403377fb75e0e1a0a256b3
verified_paths: []
owner: jjohare
review_trigger: any change to the Loom retrieval geometry (seed, expand, budget, graph scope), a Loom generation rebuild, or a claim that scaffold/chat benchmark numbers justify the retrieval path
repo: agentbox
domain: LEARNING-memory
lineage: ADR-2023 (Loom façade) — its "Remaining" section names this gap and is its ORIGIN, referenced with `see`, superseded by nothing here; ADR-040 D2/W-B (`scripts/ruvector-recall-harness.mjs`, the frozen-band precedent this record copies); ADR-2073 (graph scope, which changes what "correct" means here)
---

# ADR-2076 — Benchmark the agent retrieval path on its own terms

## Context

Diagram **AB-24.9** (`agentbox/24-loom-facade.md:397`) records that agent retrieval uses
`/loom/search` + `/loom/sparql`, not `/loom/scaffold` or chat, and that the Loom's
scaffold/chat benchmarks are therefore **no evidence** for this path. The published Loom
verdict — static scaffold ≈ 3.5× recall, prose adds ~nothing — was measured on the
scaffold-injection and chat-completion route. The agent route is different code with
different failure modes: a lexical seed (`ontology-retrieval.js:627`) followed by a
bounded SPARQL expansion (`:645`), a token budget that truncates, and (per ADR-2073) an
unenforced provenance scope. It has never been measured. ADR-2023 says the existing
fixtures are helper-level with injected transports and establish no live round-trip.
Meanwhile the estate already has the right shape of instrument for the RuVector side:
`scripts/ruvector-recall-harness.mjs`, run as `./agentbox.sh ruvector recall`, with a
frozen band and an enforced floor.

## Decision

**Proposed.** The agent retrieval path gets its own measured recall band, built on the
established harness pattern rather than inheriting another route's numbers. When taken:

1. **A dedicated harness** — `scripts/loom-retrieval-recall-harness.mjs`, run as
   `./agentbox.sh loom recall` — exercises the live `/loom/search` + `/loom/sparql` route
   end to end against a real Loom generation. Read-only, no writes, no model calls.
2. **A fixed query set with ground truth**, drawn from the ontology corpus so expected
   classes are derivable rather than hand-labelled: for each query, the set of classes a
   correct retrieval must surface. Reported metrics are recall@k for the seed stage and
   for the post-expansion result, plus the truncation rate (how often the budget clamps
   before the expected set is complete) and p50/p95 latency per stage.
3. **A frozen band with an enforced floor**, in the shape ADR-040 D2/W-B established for
   RuVector: the first full run sets the band; the floor is enforced; a regression below
   it fails the gate. The band is per generation and is re-measured on a corpus rebuild —
   a changed corpus invalidates the numbers, it does not excuse them.
4. **Scaffold and chat numbers are never cited for this path.** Any document, ADR or
   skill claiming retrieval quality for the agent route cites this harness's output or
   states that no measurement exists. This is the operative prohibition; the harness is
   what makes complying with it possible.
5. **The harness is required before and after any retrieval-geometry change** — seed
   limit, expansion depth, budget, cache key, or graph scope — exactly as the RuVector
   recall gate is. ADR-2073's graph split is such a change and must be measured through it.
6. **Authority.** Filed under `LEARNING-memory` because it defines a retrieval gate;
   `GOVERNANCE-capabilities.md` keeps the harness-side Loom façade authority.

## Consequences

- The estate stops holding an unmeasured, load-bearing retrieval path while citing a
  different route's benchmark as if it applied — the precise error the diagram note names.
- Cost: a harness, a ground-truth query set that must be maintained with the corpus, and a
  gate that will occasionally fail a legitimate change and demand a re-baseline. That cost
  is the same one the RuVector recall gate already pays and is worth paying twice.
- The first run may show the agent path performing materially worse than the scaffold
  route. That result is the point of measuring; it must be recorded rather than explained
  away.
- Running against a live Loom means the gate depends on the Loom being reachable, so a
  Loom outage becomes a gate outage. The harness must report "not measured" distinctly
  from "measured and failing" and never treat the two alike.
- Interacts with ADR-2075: until generation is attested, a band cannot be reliably bound
  to the generation it was measured on, so band records carry the generation as reported
  (attested or `unattested`).

## Verification

`implementation_status: none`. Verified at `e070514d808b218574403377fb75e0e1a0a256b3`:
`mcp/servers/lib/ontology-retrieval.js:627` (`/loom/search` seed) and `:645`
(`/loom/sparql` expand) are the agent path; no benchmark, harness or fixture in the tree
exercises them live — `ls scripts/ | grep -i bench` returns nothing and the only recall
harness present is `scripts/ruvector-recall-harness.mjs` (`./agentbox.sh ruvector recall`,
`agentbox.sh:94`). ADR-2023's "Remaining" states the fixtures are helper-level with
injected transports.

**Acceptance test for the landing change.**

1. `./agentbox.sh loom recall` runs read-only against a live Loom and prints, per stage,
   recall@10, truncation rate and p50/p95 latency, plus the generation the numbers were
   measured on.
2. The run writes a band record; a second run with no change lands inside the band and
   exits zero.
3. Artificially degrading the path (e.g. seed limit 8 → 2) drops recall below the floor
   and the command exits non-zero, naming the metric that failed.
4. With the Loom unreachable, the command reports **not measured** and exits with a
   distinct code from a measured failure.
5. No ADR, skill or governing doc cites a scaffold or chat benchmark as evidence for the
   `/loom/search` + `/loom/sparql` path — verified by grep at the landing commit.
6. Re-running after ADR-2073's graph split produces separate bands for asserted-scoped and
   merged-scope queries, rather than one blended number.
