---
id: ADR-2089
title: Make skill availability a contract field and gate progressive discovery on measurement
date: 2026-09-16
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 6ea592ee0fc62125b75d6c789b4e3160c526f4ef
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
6. **A skill may be removed, not only deprecated,** when measurement and an operator decision
   agree. Applied 2026-09-16 to four tooling-free thinking lenses (`adaptive-communication`,
   `human-architect-mindset`, `negentropy-lens`, `renaissance-architecture`), two of which were
   also each other's only overlap pair. Removal is git-recoverable and requires re-pointing every
   inbound reference; it does not licence trimming depth out of a skill that stays.
7. **Prefer an explicit boundary to a merge.** Where two skills measure as overlapping, first
   try naming the boundary in both descriptions and re-measure; merge only if that fails.
   Two of three clusters resolved this way, with no content lost.

## Consequences

- A demoted skill is visible as demoted to every consumer that reads descriptions, including
  Claude's own trigger matching — not only to a human reading a manifest comment.
- Adding a skill now means declaring status when it is not live; the drift gate fails otherwise.
- Discovery quality is a number. Measured over 40 labelled items across all 131 skills:
  **92% soft accuracy (3 reps), 96% on the independent tier.** Truncation curve: 160 chars
  → 78%, 320 → 83%, 640 → 88%, untruncated → 90% (1 rep). Estate overlap fell from 9 pairs
  at ≥0.60 to **0**: five cleared by naming boundaries, one by supersession, one by removal.
- The measurement instrument is a third-party cloud API (TypeSafe System One / Jev). It is
  used **offline against this repo's own public skill descriptions only**. Using it as a live
  router is a separate decision, not taken here: the state of a routing call is the user's own
  prompt, the widest data class in the estate, with no redaction story
  (`skills/system-one/references/routing-cost-and-scope.md`).
- Costs: measured ~15.8k input tokens and ~600 ms per full-fleet routing call. At Jev's
  $0.042/MTok input with **output free**, that is **$0.000662 per route** — roughly half what
  one turn of the 20 always-loaded skill descriptions costs in Opus cache reads ($0.001446),
  and ~124× cheaper than one `/route`, which pulls ~16k tokens into our own context at
  $5.00/MTok. Re-running the rig over the whole estate is effectively free; the scarce
  resource is our context window, not the judge's tokens
  (`skills/system-one/references/routing-cost-and-scope.md`).
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

- `bash skills/lint-skills.sh` → `OK — skills estate clean (127 skills … 0 warnings)`, with the
  new `STATUS` and `DIRECTORY` (MCP) checks active. The STATUS gate failed 9 skills on first
  run — including two that had invented their own vocabularies (`active`, `requires-install`) —
  all since remediated.
- `node scripts/skill-count-check.js --quiet` → exit 0.
- `node skills/gen-routing-table.mjs --check` → clean (run by the lint above).
- Routing accuracy: `node skills/system-one/scripts/route-eval.mjs --items items.json --reps 3`
  → 36.0/40 soft (90%) across 127 skills, tier B 25.0/26 (96%). Before the cull, at 131
  skills: 36.7/40 (92%), tier B 96%.
- Overlap: the pairwise scan over within-section live skills reports 4 pairs at ≥0.60
  reports **0 pairs at ≥0.60**, down from 9. Known blind spot: it compares pairs within a
  routing section, so cross-section near-neighbours are invisible — two that misroute anyway
  (`diagrams-as-code`↔`github-workflow-automation`, `perplexity-research`↔`web-researcher`) are
  recorded in the ledger rather than fixed, to avoid tuning descriptions to a 40-item test set.

## Re-verification — 2026-09-22 at e1ba33a1c

Governed paths changed since `cb5d34270` only by `f5d71b874` (the vault CLI becomes the
governed ontology door): two lines of `skills/SKILL-DIRECTORY.md` now describe
`ontology-augment` as Bash over `vault` and the Loom rather than the retired
`ontology-bridge` MCP server. No `status:` value, badge rendering, lint rule or route-eval
behaviour changed; the status contract and measured-discovery decision stand.

## Re-verification — 2026-09-23 at 9c24aad52

Governed paths changed since `e1ba33a1c` only by `d5f5ebccf` (deep-research fans out to
ceramic-search, Perplexity and web-researcher): two lines of `skills/SKILL-DIRECTORY.md`
now describe `deep-research`'s search backends. The row's `No` (not always-loaded) is
unchanged, no `status:` value, badge, lint rule or route-eval behaviour changed, and the
skill stays unregistered in both manifests; the status contract and measured-discovery
decision stand.

## Re-verification — 2026-09-26 at 6ea592ee0 (ADR-2111/2116 landing)

**Governed change:** `skills/lint-skills.mjs` only (`b25903ec8`, ADR-2111). A new `DESC_WARN = 600` soft budget warns, never fails, on a frontmatter `description` longer than 600 chars, because a registered description is paid for in every session's prefix; the hard `DESC_MAX = 1024` fail is unchanged. This is a lint-side budget, distinct from Decision point 4's `DESC_MAX = 640` in the generated routing table (`gen-routing-table.mjs`, unchanged). No `status:` value, badge, gate or route-eval behaviour changed. `bash skills/lint-skills.sh` → OK, 127 skills, 30 warnings, all 30 of them the new `> 600 soft budget` DESCLEN. Claim STILL TRUE.
