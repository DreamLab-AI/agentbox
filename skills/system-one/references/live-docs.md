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

## Other endpoints that speak the same wire — confirmed 2026-10-12

The `POST /v1/systemone` request and answer shapes above are no longer TypeSafe's alone.
Three other servers were exercised on this date with `system-one-client`'s request bytes
unchanged; what differs is recorded here because it is exactly what a client gets wrong.

| Endpoint | Docs | Model id | Confirmed on 2026-10-12 |
|---|---|---|---|
| `https://api.subq.ai/v1/systemone` (SubQ Snap, Subquadratic) | `https://docs.subq.ai/endpoints/decisions-api/` | `subq-snap-preview` | Same body and answer fields, same `usage`. Additive `images` array (objects `{mediaType, base64}`, raw base64 with no `data:` prefix, ≤ 4 images, ≤ 4 MiB each, 8 MiB total, 13 MiB body). Choice 2–255 options, Score 2–10 levels, `noul` with optional `criteria.true/false`. Accepted a 73,612-token state whole (vendor claims 384K). Key `SUBQ_API_KEY`, `402` without credits. Errors arrive as `detail.{error_type,message}`, not `error.{code,message}`. Price $0.05/MTok input, output free. Retention default **retain indefinitely**; zero-data-retention is per-organisation on request and leaves Decisions unaffected. |
| `transformers serve` `/v1/systemone` (Hugging Face) | `https://huggingface.co/docs/transformers/main/en/serve-cli/serving` | any chat-template model | Follows TypeSafe's OpenAPI. Scores next-token labels `A`–`Z` / `Yes`/`No` under the chat template, thinking disabled. **1–26 options or levels per question**, ≤ 64 questions, `images` as `data:` URLs (≤ 4). `--decision-config` sets labels, per-type temperature and a full Jinja prompt; custom decision heads (Kev, Clef, laya) are *not* served by it. Not deployed anywhere in the estate: the HP model container is `llama-server` 0.3.0-dev, which returns 404 on this route. |
| Kev `kev.serve` (`github.com/jaredpalmer/kev`) | README | `jaredpalmer/kev-{0.8b,4b,9b,27b}` | Native route, same shape. State ≤ 65,536 tokens (+ 8,192 per question), Choice 1–255 options, no question cap, one request at a time. Not on PyPI (`pip install kev` is unrelated): `uv sync --extra serve` then `python -m kev.serve --run jaredpalmer/kev-9b --port 8009`. Needs the Qwen3.5 base beside the adapter (~17 GB VRAM for 9B). |

TypeSafe itself resolved `jev-latest` to `jev-1.13.0` on this date. The measured comparison
between these backends on the estate's routing corpus is ADR-2139.

### Kev-9B measured 2026-10-12

`python -m kev.serve --run jaredpalmer/kev-9b --port 8009` on an RTX 6000 Ada (bf16, torch, ~30 GB
resident with batching buffers; needs `LD_LIBRARY_PATH` to the Nix `gcc-lib` and `zlib` store paths
in this container). Same 86-case parity as SubQ: **88.4%** vs Jev 91.9% that run (soft 98.8%),
`none` recall 93.8% / precision 100%, **p50 7.6 s** per route (117 options as independent rows), 13.0k
tokens. Routing budget is 4 s, so Kev is a compaction-class local backend here until the serving
path is tuned (flash-linear-attention, fewer options via the façade shortlist). Receipt:
`parity-jev-kev.json` in the session scratchpad.
