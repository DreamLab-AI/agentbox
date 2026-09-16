---
id: ADR-2089
title: Make skill availability a contract field and gate progressive discovery on measurement
date: 2026-09-16
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: cb3d83c1103a7c3b5de416c075d0cb70f1b34d24
verified_paths: [skills/lint-skills.mjs, skills/gen-routing-table.mjs, skills/SKILL-DIRECTORY.md, skills/system-one/scripts/route-eval.mjs]
owner: jjohare
review_trigger: the next time a skill is demoted, merged, or added to a cluster that already shows measured overlap
repo: agentbox
---

# ADR-2089 — Make skill availability a contract field and gate progressive discovery on measurement

## Context

Progressive discovery routes on a skill's frontmatter `description` (ADR-2021/2083). A
skill's *availability* was recorded elsewhere: comments in `registered-skills.txt`, markers
in `SKILL-DIRECTORY.md`. Nothing that matches on descriptions can read either, so demoted
skills kept competing for triggers — measured 2026-09-16, `playwright` (manifest-disabled)
and `browser-automation` together absorbed 1.07 of routing probability from the canonical
browser skill. The estate had no way to *measure* discovery quality, so cluster overlap was
adjudicated in prose: the `SKILL-DIRECTORY` overlap ledger recorded the browser cluster as
"well-differentiated, no merge needed" while it measured 0.80 pairwise overlap. Two further
facts were hand-maintained and had drifted: the inventory's `MCP` column (12 disagreements
with frontmatter) and the generated routing table's `DESC_MAX = 160`.

## Decision

1. **`status:` is a frontmatter contract field.** Vocabulary: `live` (default, omit),
   `foundation`, `gated`, `router-only`, `not-installed`, `superseded`, `deprecated`. It
   states availability, not maturity. `superseded` and `deprecated` must carry a
   `replacement:` that resolves to a skill directory.
2. **Status is rendered at the point of use, never baked into prose.** `gen-routing-table.mjs`
   emits a status badge; `skills/system-one/scripts/route-eval.mjs` composes a status
   sentence into its criteria. One source, many renderings. Hand-prefixing a status onto a
   description is prohibited — it re-creates the duplication this ADR removes.
3. **Derivable facts are gated, authored facts are kept.** Lint now fails when the inventory's
   `MCP` column disagrees with frontmatter (`mcp_server: true` or `depends_on_mcps:`), and
   when a `SKILL-DIRECTORY` row carries an unavailability marker while the frontmatter
   declares no `status:`. The inventory's prose columns stay hand-written: `When to Choose`
   carries operator routing nuance the description does not, and is independent evidence
   when descriptions are under test.
4. **`DESC_MAX = 640`** in the generated routing table, from the measured curve (below).
5. **Cluster overlap is settled by measurement, not assertion.** The overlap ledger records a
   measured pairwise number and the date. A claim of "no merge needed" without one is not a
   finding. The instrument is `route-eval.mjs` plus the pairwise overlap scan.
6. **Prefer an explicit boundary to a merge.** Where two skills measure as overlapping, first
   try naming the boundary in both descriptions and re-measure; merge only if that fails.
   Two of three clusters resolved this way, with no content lost.

## Consequences

- A demoted skill is visible as demoted to every consumer that reads descriptions, including
  Claude's own trigger matching — not only to a human reading a manifest comment.
- Adding a skill now means declaring status when it is not live; the drift gate fails otherwise.
- Discovery quality is a number. Measured over 40 labelled items across all 131 skills:
  **92% soft accuracy (3 reps), 96% on the independent tier.** Truncation curve: 160 chars
  → 78%, 320 → 83%, 640 → 88%, untruncated → 90% (1 rep). Estate overlap fell from 9 pairs
  at ≥0.60 to 4 after this ADR's boundary fixes.
- The measurement instrument is a third-party cloud API (TypeSafe System One / Jev). It is
  used **offline against this repo's own public skill descriptions only**. Using it as a live
  router is a separate decision, not taken here: the state of a routing call is the user's own
  prompt, the widest data class in the estate, with no redaction story
  (`skills/system-one/references/routing-cost-and-scope.md`).
- Costs: measured 15,839 input + 1,319 output tokens and ~636 ms per full-fleet routing call.
  Output scales with option count, so re-running the rig over the whole estate is not free.
- Known limitation: **the judge is not deterministic at fleet scale.** At 10 candidates picks
  were bit-identical across repeats; at 131 candidates two runs of an identical configuration
  scored 34/40 and 36/40. Single-rep comparisons are inside the noise. `--reps 3` and the soft
  score are mandatory — the same lesson `skill-tuning` learnt on its target agent.
- Known limitation: **confidence is not a safety net.** A wrong pick was returned at 0.94
  confidence. TypeSafe's own intent-routing guidance
  (`https://docs.typesafe.ai/patterns/intent-routing.md`) gates escalation on
  `confidence < 0.5`; that is their pattern for their customer-service use case and it does
  **not** transfer to skill selection on this evidence. Do not build a
  low-confidence-escalates rule on it here without measuring the threshold locally
  (`skills/system-one/references/evaluation.md`).
- A judge/label disagreement is not automatically a model error. Two of four apparent misses
  were wrong labels, one corrected by operator policy (`browser-automation` is the entry point
  for all browser work). Check the label first.

## Verification

At the commit recording this ADR:

- `bash skills/lint-skills.sh` → `OK — skills estate clean (131 skills … 0 warnings)`, with the
  new `STATUS` and `DIRECTORY` (MCP) checks active. The STATUS gate failed 9 skills on first
  run — including two that had invented their own vocabularies (`active`, `requires-install`) —
  all since remediated.
- `node scripts/skill-count-check.js --quiet` → exit 0.
- `node skills/gen-routing-table.mjs --check` → clean (run by the lint above).
- Routing accuracy: `node skills/system-one/scripts/route-eval.mjs --items items.json --reps 3`
  → 36.7/40 soft (92%), tier B 25.0/26 (96%).
- Overlap: the pairwise scan over within-section live skills reports 4 pairs at ≥0.60
  (`bhil-methodology`↔`sparc-methodology` 0.74, `human-architect-mindset`↔
  `renaissance-architecture` 0.70, `bencium-controlled-ux-designer`↔`ui-ux-pro-max-skill` 0.60,
  `clipcannon`↔`open-montage` 0.60) — each an open design question, recorded in the ledger
  rather than silently merged.
