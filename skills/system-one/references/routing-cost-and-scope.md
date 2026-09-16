# Option 2 — Jev as a live skill router: scope and cost

Measured 2026-09-16 with `../scripts/route-eval.mjs` over 40 labelled items against all
131 skills. **Option 1 (offline description tuning) is implemented and needs none of
this.** What follows scopes the live-router variant and prices it.

## Measured unit economics

Per routing call, flat over the whole fleet, full descriptions:

| | Measured |
|---|---|
| Input tokens | **15,839** |
| Output tokens | **1,319** |
| Latency | **636 ms** (p50-ish, n=120) |
| Accuracy | **92%** soft over 3 reps (96% on the independent tier) |

Two cost properties are unusual and drive everything below.

**Input is re-sent every call.** The 131 descriptions are byte-identical on every
request, and no prompt-caching mechanism is documented. So ~15.8k input tokens is a
fixed toll per route, not an amortised corpus load.

**Output scales with the option count.** 1,319 output tokens is not an answer — it is a
probability for each of 131 options. Halve the candidate set and the output cost
roughly halves with it. This is the opposite of the usual LLM profile and it is why a
two-stage design pays twice.

## Volume

TypeSafe publishes no public pricing page (`/pricing` and `/limits` are 404 as of
2026-09-16; the console is the only source). Substitute the real per-million rate for
`$P_in` / `$P_out`:

| Routes/day | Input tokens/day | Output tokens/day | Cost/month |
|---|---|---|---|
| 100 | 1.58 M | 0.13 M | `47.5 M × $P_in + 4.0 M × $P_out` |
| 1,000 | 15.8 M | 1.3 M | `475 M × $P_in + 40 M × $P_out` |
| 10,000 | 158 M | 13.2 M | `4.75 B × $P_in + 396 M × $P_out` |

At 10k routes/day — plausible if *every* agent turn across the estate routes — this is
billions of input tokens a month to re-send the same 131 descriptions. That is the
finding: Jev is cheap per call, and "often" is what makes it expensive. The question is
not the unit price, it is how many turns actually need routing.

## Cheaper shapes, in order of expected saving

1. **Route only on ambiguity, not every turn.** Most turns do not need a router at all —
   the harness already matched a skill, or none applies. A router invoked on every turn
   pays the full toll to confirm what was already known. *Blocker: the harness exposes
   no "I am uncertain" signal to gate on, so this needs a trigger design first.*
2. **Two-stage: section, then skill within section.** Stage 1 chooses among the 26
   routing sections; stage 2 chooses among that section's ~5–10 skills. **Projected**
   from two measured points (10 candidates = ~2.0k input / ~100 output; 131 = 15.8k /
   1.3k): roughly **3.5k input and ~250 output per route, a ~4.5× saving**, at the cost
   of a second round trip (~1.2 s total) and compounding stage-1 error into stage-2.
   Hierarchical classification is a documented vendor pattern and our `section-map.json`
   already carries the hierarchy. **Not yet measured — measure before adopting.**
3. **Prune the candidate set.** Demoted skills (`status` ≠ live) need not be offered at
   all. That is ~8 skills today: a few percent, not a fix on its own.
4. **Shorter descriptions.** Measured: 640 chars holds 88% at ~94% of full-text cost —
   truncation is a poor lever because description length is already near the knee.

## What still blocks Option 2 — unchanged by any of this

The state of a routing call is **the user's own turn text**. That is the widest and
least controllable data class in the estate, and unlike the reranking case it cannot be
scoped to a public corpus. Everything in `data-boundary.md` §Must not leave would flow
through the router on the turns where it matters most.

Three consequences, all needing a decision before a line of router code is written:

- **Egress.** Ratify or refuse in an ADR. There is no redaction story for "the user's
  prompt" — you cannot strip the meaning and still route on it.
- **Availability coupling.** A router that is the sole dispatch path fails closed when
  the vendor 429s or 529s. The rig retries; a live router needs a defined fallback to
  the existing description matching, and that fallback must be the *normal* path when
  the service is slow, not an error case.
- **Confidence is not a safety net.** Measured here: a wrong answer arrived at **0.94**
  confidence. A "low confidence → ask the user" rule does not catch this failure mode.

## Recommendation

Do not wire a live router yet. The measured accuracy (92%) is good but not better than
the existing arrangement by enough to justify sending every user turn off-network. The
cheap, decision-free wins are all in Option 1, which is implemented. If Option 2 is
wanted later, the order is: (1) measure the two-stage variant, (2) design the ambiguity
trigger so routing is occasional rather than per-turn, (3) then take the egress decision
to an ADR with real numbers attached.
