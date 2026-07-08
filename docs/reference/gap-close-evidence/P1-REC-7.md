# P1-REC-7 — Outcome learning made real (Wilson floor + gated consumers; own trajectory loop only)

**Item:** REC-7 (PRD-019, ADR-037 D3, DDD-016 §EffectivenessAggregate / DDD-017 §8)
**Wave:** P1
**Target tier:** producer `integrated`; consumers `scaffolded` (gated OFF behind the sample floor — honest, not stale)
**Canary:** `CANARY-AB-LEARN` (standing monitor; fires when a floor-cleared aggregate observably re-ranks retrieval or surfaces a hint in a live session)
**Captured against SHA:** `9673624437fb9bd25792112a1b6f05713e6a8c55` (branch `gap-close/2026-07`; receipts run on the working tree atop this base, pinned by the closure commit)
**Timestamp (UTC):** 2026-07-08T13:07:32Z

## Falsification statement (from PRD-019)

> REC-7 is falsified if either consumer flag flips true before the sample floor clears,
> if the re-rank influence cannot be evidenced by a receipt, if agentbox's child docs
> claim the out-of-repo intelligence banner as their own closure, or if any in-repo
> comment is edited to claim the trajectory loop learns before it observably does.

## Scope (ADR-037 D3 — recorded, in writing, per DDD-017 invariant 7)

REC-7 is scoped to **agentbox's own trajectory loop ONLY**. The "intelligence banner"
and "hardcoded router confidence" the meta-PRD names live in the baked claude-flow CLI
in the Nix store (`/nix/store/.../claude-flow-cli-3.14.4` — `router.js` `0.8` constant,
`hook-handler.cjs`), **outside this git repo**. They are **excluded** from this closure
and were **not touched**. agentbox's own `config/hooks/claude-flow-hook-adapter.cjs`
already disclaims holding learning state.

**Stale `learns` comments — verified, none exist matching this gap.** A repo-wide grep
found exactly one in-repo `learns` line: `management-api/lib/precedent-service.js:7`
("the system learns to auto-apply"). Per ADR-037 D3 that is the **governance precedent
auto-apply** mechanism (COM-16 territory), a distinct, real system — NOT the trajectory
loop — so it is **left untouched**. No comment was edited to claim the trajectory loop
learns (the falsification's last clause). Deleting a comment that is not there, or the
one legitimate `learns` line, would be theatre (D3 rejected alternative 2).

## What changed

| File | Change |
|---|---|
| `mcp/servers/lib/aggregate-effectiveness.js` | Added **`summariseGates(rows, opts)`** — a PURE gate-state inspection: how many action patterns cleared the 20-sample Wilson floor, whether each consumer gate is on, and the load-bearing `premature_consumer_enabled` (a consumer gate ON while the floor has NOT cleared — the degenerate-label pathology the floor prevents). Added a **`--status`** CLI mode + `status()` that reads the live corpus and prints this JSON non-interactively — the "gate state inspectable" requirement. Extracted `makePool()` (shared by `run`/`status`). Imported `gates` from `ruvector-gates`. **No gate was flipped**; the Wilson lower bound (`wilsonLower`) and the raw-count floor (`n >= aggregate_min_samples`, default 20) were already the estimator and remain unchanged. |
| `tests/sovereign/effectiveness-learning.test.js` | **New.** 14 cases: Wilson-bound math (`n=0→0`, `∈[0,1]` and below the raw rate, tighter with more samples, a lone `1/1` heavily discounted, fractional weighting); `computeRows` keying wilson on recency-weighted succ/total; `summariseGates` floor-gating + inspectability + premature-enable flag + live-env gate reads; and **consumer gate behaviour** via injected pools — `feed_retrieval` OFF ⇒ no aggregates read and no bonus, ON ⇒ `+0.1·wilson` lifts the matching row; `feed_routing` OFF ⇒ aggregates omitted with an explicit note (no real CTE), ON ⇒ the orient query reads the aggregates namespace. |

The two gated consumers the recon located are **already implemented** (not stubs I
built): `applyEffectivenessBonus` (gate `RUVECTOR_FEED_RETRIEVAL`) in
`mcp/servers/lib/memory-hybrid.js`, and the `memOrient` aggregates bucket (gate
`RUVECTOR_FEED_ROUTING`). This closure adds the **floor/gate verification, the
inspection mechanism, and the tests** that lock their gated behaviour. The manifest
flags stay `false` (`agentbox.toml:361-362`) because the live corpus has not yet
cleared the floor — the honest producer→consumer split (DDD-017 Open Issue 3).

## Receipts

### 1. Unit tests — Wilson floor + gate behaviour (`cd management-api && npx jest`)

```
$ npx jest ../tests/sovereign/effectiveness-learning.test.js
PASS ../tests/sovereign/effectiveness-learning.test.js
  REC-7 — Wilson score-interval lower bound
    ✓ n=0 → 0 (no evidence, no credit)
    ✓ always in [0,1] and strictly below the raw success rate
    ✓ more samples at the same proportion → a HIGHER (tighter) lower bound
    ✓ a lone degenerate label (1/1 = 100% raw) is heavily discounted
    ✓ works on fractional (recency-weighted) successes / effective n
  REC-7 — computeRows derives wilson from the weighted corpus
    ✓ wilson = wilsonLower(w_succ, w_total); rows sorted by wilson desc
  REC-7 — summariseGates (gate state inspectable; floor-bound)
    ✓ floor NOT cleared when no pattern reaches the 20-sample minimum
    ✓ floor cleared when a pattern reaches the minimum; eligible listed
    ✓ a consumer gate ON while the floor is NOT cleared is flagged premature
    ✓ reads the live gate env when the override is omitted
  REC-7 — feed_retrieval re-rank is gated OFF by default
    ✓ gate OFF: no aggregates read, no effectiveness bonus (ranking unchanged)
    ✓ gate ON: aggregates read, matching row gets +0.1·wilson and re-sorts to top
  REC-7 — feed_routing governs the orient aggregates bucket
    ✓ gate OFF: aggregates omitted with an explicit note; no aggregate CTE in the query
    ✓ gate ON: the orient query reads the aggregates namespace; no off-note
Tests:       14 passed, 14 total
```

### 2. Gate-state inspection is non-interactive (summariseGates smoke)

```
$ node -e "const a=require('./mcp/servers/lib/aggregate-effectiveness.js'); \
  console.log(JSON.stringify(a.summariseGates(\
   [{pattern:'git commit',n:25,wilson:0.7},{pattern:'npm test',n:5,wilson:0.9}], \
   {minSamples:20, feedRetrieval:false, feedRouting:false})))"
{"aggregate_min_samples":20,"patterns_total":2,"patterns_cleared_floor":1,
 "floor_cleared":true,"gates":{"feed_retrieval":false,"feed_routing":false},
 "premature_consumer_enabled":false,
 "eligible_patterns":[{"pattern":"git commit","n":25,"wilson":0.7}]}
```

The live-session inspection entry is `node mcp/servers/lib/aggregate-effectiveness.js --status`
(reads the live `trajectory_steps` corpus, prints the same JSON — reports, never flips).

### 3. node -c

```
OK: mcp/servers/lib/aggregate-effectiveness.js
OK: tests/sovereign/effectiveness-learning.test.js
```

## Maturity & canary honesty

- **Tier:** producer `integrated`; consumers `scaffolded` (gated OFF). Stated as a
  split, not collapsed into one number (DDD-017 invariant 5). The floor is honest
  gating — the consumers do not flip until the live corpus clears 20 samples for a
  pattern, which depends on live agent traffic outside this agent's control
  (DDD-017 Open Issue 3). Per ADR-004's structural answer, REC-7 registers as `Open`
  visibly until then, not as a false closure.
- **`CANARY-AB-LEARN`:** the wire it observes (`memory_search` re-rank term /
  `feed_routing` advisory hint) is exercised green under injected pools above; a live
  fire needs a floor-cleared aggregate and a flipped gate in a live session. The
  VisionClaw `LivenessHarness` was not reachable from this build container, so
  registration is **pending-live-session**. Standing monitor (feeds a KPI), not one-shot.
- **Out-of-repo exclusion recorded** here and to be carried in the compatibility matrix
  (PRD-019 REC-7 AC5): the claude-flow-CLI banner and router confidence are not
  agentbox's REC-7 closure.
