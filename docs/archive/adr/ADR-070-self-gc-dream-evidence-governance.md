# ADR-070: Self-GC evidence governance for the dream engine

**Status**: Accepted (2026-08-28)
**Relates to**: ADR-052 (HP annexe), ADR-061 (draft-PR persistence), ADR-065 (evaluator liveness)

## Context

The dream engine's cross-night memory was three lossy channels: an 80-char
ledger finding, regex-plucked "Next steps" carry-over lines, and blind
`tail()` truncation of build/evaluator receipts (3000/6000 bytes) — with the
full receipts discarded after the night. These are precisely the weak
baselines measured in *Self-GC: Self-Governing Context for Long-Horizon LLM
Agents* (arXiv 2607.00692): position-based pruning destroys exact anchors
(failing test names, error signatures, numbers), and summary-style carry-over
blurs evidence into unaddressable prose. The paper's fix — indexed context
objects, a side-channel planner assigning fold/mask/prune lifecycles, sidecar
recoverability, and harness-enforced invariants — reached 84.85–94.58%
future-turn no-impact versus 54–70% for heuristics, with GLM-5.1 validated as
a planner backbone (we run GLM-5.3).

The paper governs an in-session transcript; the dream engine gives its LLM
exactly one call per night. The adaptation shifts the substrate: **turns are
nights, tool spans are evidence receipts, the active view is the compiled
nightly evidence pack**, and the night boundary is the naturally safe commit
point (no live prefix cache, so the paper's cache-aware commit rule
degenerates away).

## Decision

Adopt the Self-GC architecture in `services/dream-engine/src/context.rs`:

1. **Sidecars, unconditionally**: tonight's build/evaluator outputs are
   persisted untruncated under `<artefact_dir>/<night_id>/receipts/` with an
   `index.json`, even when governance is disabled. Evidence is never again
   destroyed by truncation.
2. **Indexed objects**: `receipt:<night_id>:<name>`, following the engine's
   URN habit. The planner sees only the index (id, age, size, head line).
3. **Side-channel planner**: one bounded extra call (same provider chain as
   the nightly call, `max_tokens` clamped 2048–4096 — reasoning models
   truncate to empty below ~1536) emits a JSON plan of
   `restore | mask | fold | prune` per object, over tonight's receipts plus
   the last 6 nights'.
4. **Harness-enforced invariants** (Rust, not prompt): tonight's receipts are
   never folded/pruned (last-turn protection — upgraded to `mask`); unknown
   targets dropped; unmentioned objects default tonight→mask, prior→fold;
   a char budget (`DREAM_SELF_GC_BUDGET`, default 30k) degrades overflow to
   fold, never touching tonight's retention. Every fold/mask carries a
   recovery pointer; a later night's planner can `restore` a folded object
   when its topic's slot rotates back — slot rotation makes future relevance
   nearly deterministic, a stronger position than the paper's chat traces.
5. **Fail-open everywhere**: planner error, unparseable plan, or sidecar I/O
   failure lands on the legacy `tail()` path. `DREAM_SELF_GC=0` disables
   governance outright (sidecars still written).

## Consequences

- One extra LLM call per repo per night (index-sized prompt; small).
- Nights compound: prior evidence is byte-exact recoverable instead of an
  80-char pointerless summary; HP-path redaction still applies to everything
  that leaves the LAN (sidecars stay control-plane side, unredacted).
- The deployed binary is Nix-built (`lib/dream-engine.nix`); this ships on
  the next image rebuild. No manifest gate: the feature is runtime-env-gated
  (`DREAM_SELF_GC`), not a build-composition change.
- Artefact dirs grow by full receipt sizes per night; the existing 3-day HP
  annexe sweep does not cover local artefacts — revisit retention if disk
  pressure appears.
