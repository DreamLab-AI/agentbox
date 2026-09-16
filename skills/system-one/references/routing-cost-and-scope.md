# The economics of skill selection

**Corrects an earlier version of this file that priced output tokens as a cost driver and
never priced the alternative. Jev's output tokens are free, and the alternative — skill
selection paid in *our* context — was the cost that mattered all along.**

Rates used (2026-09-16): **Jev $0.042/MTok input, output free.** Claude Opus 5 **$5.00/MTok**
input, cache reads ~0.1× (**$0.50/MTok**), cache writes ~1.25× (**$6.25/MTok**); Sonnet 5
$2.00/MTok. Substitute your own if the tier differs — the ratios are what matter.

## Measured unit costs

| | Tokens | Rate | Cost |
|---|---|---|---|
| **Jev route over all 127 skills** | 15,772 in / 1,269 out | $0.042 in, out free | **$0.000662** |
| **Always-loaded descriptions** (20 registered skills, in every request's system prompt) | 2,892 | $0.50/MTok cache read | **$0.001446 per turn** |
| **One `/route`** (skill-router SKILL.md + routing-table.md pulled into context) | ~16,462 | $5.00/MTok, uncached | **$0.0823** |
| **Reading SKILL-DIRECTORY.md instead** | ~18,544 | $5.00/MTok | **$0.0927** |

Latency: 598–636 ms per Jev route, measured over 120 calls.

## The two comparisons that matter

**A full-fleet Jev route costs less than half of one turn's residency tax — and sees 6.3×
more skills.** We pay $0.001446 every turn to keep 20 of 127 descriptions resident. A Jev
call that reads *all 127* costs $0.000662, once, only on turns that actually route.

**A Jev route is ~124× cheaper than one `/route`.** $0.000662 against $0.0823 — and the
`/route` number understates it, because those ~16,000 tokens then *stay in the context
window* for the rest of the session.

## Volume

| Routes/day | Jev, flat over 127 skills | For comparison: today's always-loaded tax at the same turn count |
|---|---|---|
| 100 | $0.07/day · **$2/month** | $0.14/day · $4/month |
| 1,000 | $0.66/day · **$20/month** | $1.45/day · $43/month |
| 10,000 | $6.62/day · **$199/month** | $14.46/day · $434/month |

The right-hand column is what we already spend, for one sixth of the coverage, on every turn
whether or not a skill is needed.

## Corrections to the earlier analysis

- **"Output scales with option count, so a two-stage design pays twice."** Wrong — output is
  free. Option count costs nothing on the output side. A 127-option Choice and a 5-option
  Choice bill identically for output.
- **"Two-stage section→skill gives a ~4.5× saving."** It saves input only: ~15.8k → ~3.5k
  tokens, about $0.00047 per route. At 1,000 routes/day that is $15/month against an added
  round trip (~1.2 s) and stage-1 error compounding into stage-2. **Not worth building.**
- **"Prune the candidate set / shorten descriptions."** Both now pointless as cost levers.
  Truncation *costs* accuracy (160 chars → 78%, full → 90%) and saves fractions of a cent.
  Send the full text.
- **"Don't wire it live — the economics don't justify it."** The economics now argue the
  other way. Cost was never the real objection.

## Egress: decided (ADR-2090)

**Resolved 2026-09-16.** The operator has accepted that skill-routing prompts may leave the
network. The exemption covers skill routing only; every other must-not-leave class stays
closed, and **per-project gates are deferred rather than waived** — the first project that
cannot accept this needs a gate built before it runs, and none exists today.

The honest cost stands on the record: a routing call carries whatever the user typed, and the
turns where routing matters most are the ones most likely to carry real content.

Two engineering consequences remain, both decisions rather than measurements:

- **Availability coupling.** A sole-dispatch router fails closed on 429/529. The fallback to
  existing description matching must be the *normal* path when the service is slow, not an
  error case.
- **Confidence is not a safety net.** Measured here: a wrong pick at **0.94** confidence. The
  vendor's own intent-routing guidance gates escalation on `confidence < 0.5`; that is their
  pattern for their customer-service use case and does not transfer on this evidence.

## Recommendation

Both objections are now settled: cost argues **for** the router, and egress is decided
(ADR-2090). A live router is cheaper than the status quo, covers all 127 skills rather than a
curated 20, and returns ~2,900 tokens per turn to the context window.

Build order, cheapest-first:

1. **Re-choose the always-loaded twenty by measurement.** They were curated by taste when
   context was the binding constraint. The same offline rig can say which descriptions
   actually earn a permanent slot. No new runtime, no egress, immediate context saving.
2. **A router with fail-open.** — **Built, ADR-2091 (2026-09-16).** `[skills.routing].router`
   defaults to `"jev"`; the hook and `/route` share `config/hooks/lib/skill-route.cjs` and fall
   open to `"table"` on timeout, 429/529, any error, a missing key or a `none` pick. Measured
   through the runtime path: 90% soft, $0.00062/route, 0 failed calls in 120.
3. **A per-project bypass**, before the first project that needs one — the debt ADR-2090
   records. Still open: `[skills.routing]` has no per-project key yet.

Do not build the two-stage section→skill variant: it saves ~$15/month at 1,000 routes/day and
costs a round trip plus compounding error.

## Mid-run routing — analysis, not yet a build (2026-09-16)

The question raised once the per-turn router landed: if a route costs $0.0006 and ~1 s, why
not route *every* model call — every step of an agentic run — rather than only the user's
turn? Skills discovered mid-run are a real value unlock (the task at step 40 is often not the
task at step 0). Three things have to be understood before that is wired.

**1. Recursion.** The judge is a leaf: the hook calls an HTTP API, never a model, so the hook
itself cannot recurse. The loop is one level up. A mid-run injection that says "`x` fits" can
cause the model to load `x` (a `Skill` tool call), which is a tool event, which fires the
hook, which routes again, which suggests `y`… Every injection is a potential cause of the
next event. That loop is bounded only if the hook refuses to fire on the events its own
output produces. Concretely: never route on `Skill`, `Read`, `Glob`, `Grep`, `TodoWrite` or
`AskUserQuestion`; never inject the same pick twice in a turn; never inject a skill already
loaded in the session (readable from the transcript); cap injections per user turn. Subagents
add fan-out, not recursion: each profile session has its own hooks, so a routed run that
spawns five subagents pays five hook chains, and a `none`-heavy judge keeps each chain short.

**2. Cost — and it is not the judge.** Per step, Jev is $0.00062 and the injected line is ~33
tokens. What compounds is *residency*: every injected line stays in context and is re-read on
every subsequent step. For a 150-step turn with a route on each step:

| Component | Working | Cost |
|---|---|---|
| Jev, 150 routes | 150 × $0.00062 | **$0.093** |
| Injected lines, first write | 150 × 33 tok × $6.25/MTok cache write | $0.031 |
| Injected lines, re-read | 33 tok × (150²/2) ≈ 371k tok × $0.50/MTok cache read | **$0.186** |
| Latency | 150 × ~0.8 s | **~2 min added to the turn** |

The same finding as ADR-2089, one level down: our own context tax on the routing output
outweighs the judge. The fix is the same too — inject **only on change**. Route on every
eligible step but emit a line only when the top pick differs from the last line emitted this
turn. A typical run then carries 3–8 lines, not 150, and the table collapses to roughly
$0.09 Jev + $0.01 residency + the latency, which stays the real cost.

**3. What is the state?** The user's turn is a natural state. Mid-run there are three
candidates: the tool call's input (poor — a `sed` command says little about intent), the
model's most recent assistant text (its stated next step, good, available via the hook's
`transcript_path`), or a rolling window of the last few steps. The second is the right first
choice, clamped to ~2k chars.

**Plan, cheapest first.**

1. **Replay before wiring.** `[memory_learning].record_trajectories` already persists
   transcripts. Replay recorded runs through the judge offline, one route per eligible step,
   and measure two numbers: how often the mid-run pick differs from the turn-start pick (the
   value signal), and how many of those differences the model would plausibly have acted on.
   Exact cost, zero latency, no hook. If the mid-run pick rarely differs, stop here.
2. **`[skills.routing].mid_run = false`** (default) gating a `PostToolUse` registration of
   the same library with: the event blocklist above; state = last assistant text; inject on
   change only; a per-turn cap; `timeout_ms` of ~2000 because it sits inside the tool loop.
   Off ⇒ byte-identical (the existing de-registration idiom).
3. **Measure live** with the log already in place — it records consumer, outcome and cost
   per call, so the residency and latency numbers above become observed rather than modelled.

Not before 1: it is the step that says whether 2 is worth its latency.
