# Reading the live docs

The authoritative description of the API, the models, the limits and the cookbooks
is `https://docs.typesafe.ai`. This skill deliberately keeps no copy of it.

## Why no mirror

A mirrored API reference has two failure modes and no upside. It drifts silently —
nothing here fails when the vendor changes a field, so the copy keeps being read and
keeps being believed. And it doubles the maintenance surface of every future change.
The estate's own rule for this shape is already written down: depth loaded on demand,
not baked into context (ADR-2021 progressive discovery).

What belongs in this directory instead is everything the vendor cannot know: our
egress boundary, our integration points, our calibration discipline, and the design
rules distilled to the point where an agent can draft a judgment set *before* the
first fetch and then check it against the live page.

## Fetch discipline

1. **Index first.** `https://docs.typesafe.ai/llms.txt` lists the available pages.
   Read it, then pick targeted pages. Never bulk-load the site.
2. **Append `.md`** to a page path for the markdown rendering, e.g.
   `https://docs.typesafe.ai/concepts/state.md`. Resolve relative links against
   `https://docs.typesafe.ai`. If a `.md` fetch fails, try the normal page.
3. **Two reads minimum before writing an integration**: the current API or SDK page,
   and the closest cookbook to the workflow. The cookbook usually shows a better
   decomposition than a generic classifier would.
4. **State the limitation when offline.** If live access is unavailable, say so, use
   `primitives.md` here plus the installed SDK's own types, and do not invent
   version-dependent details — field names, model ids, limits and pricing are exactly
   the things that move.

## Page map

Starting points, to be confirmed against the index rather than trusted as permanent:

| Task | Start here |
|---|---|
| The programming model | `/concepts/system-one.md`, `/concepts/how-to-build-with-system-one.md` |
| What to build | `/concepts/use-case-map.md`, then the closest cookbook from the index |
| Inputs and questions | `/concepts/state.md`, `/primitives.md`, then the chosen primitive's page |
| Uncertainty | `/confidence.md` |
| Writing code | **`/api.md`** — the full HTTP reference, confirmed reachable 2026-09-16 — plus `/sdk/python.md`, `/sdk/javascript.md` |
| Updating an older integration | `/migrating-to-v1.md` + the installed SDK's reference |
| The primitives themselves | `/primitives/choice.md`, `/primitives/score.md`, `/primitives/noul.md` |

Named cookbooks seen in the vendor's own index, useful as decomposition examples:
function calling, speculative fan-out, pre-parsed value extraction, structure
recovery (autoformat), reranking, hierarchical classification, composite scoring,
autoresearch feature discovery, citation check, extraction cascades, parallel
questions, skill suggestion.

## Confirmed 2026-09-16

Endpoint `POST https://api.typesafe.ai/v1/systemone`, bearer auth, `model: "jev-latest"`,
top-level `state` / `model` / `questions`, response `model` / `answers` / `usage`. The
request and answer shapes are distilled in `primitives.md` §Answer-space shapes. These
are the facts most worth re-confirming, not least worth: they are what a fabricated
client gets subtly wrong.

## Vendor claims vs measured facts

Treat the following as **vendor claims** until measured on our own workload, and mark
them as such in any document produced from this skill:

- ~150 ms real-time latency; ~100× cheaper than a frontier LLM call.
- A shared state+questions token budget of roughly 32,000 tokens (~150,000 characters
  of English).
- Batching 13 questions into one call reported as ~11.5× cheaper and ~9.6× faster than
  13 separate calls, with unchanged answers.
- Calibration: probabilities optimised against outcomes across groups of predictions.
  Calibration is a property of a population, never a guarantee about one answer.

`evaluation.md` says how to turn each of these into a number for our traffic.
