# scripts/

## `route-eval.mjs` — built, measured

Measures how well skill **descriptions** discriminate, using a System One `Choice` over
the skill fleet as the instrument. Zero dependency, Node >= 18, reads `TYPESAFE_API_KEY`.

```bash
node route-eval.mjs --items items.json                 # baseline, full descriptions
node route-eval.mjs --items items.json --reps 3        # replicated (see below)
node route-eval.mjs --items items.json --desc-max 320  # truncation sweep
node route-eval.mjs --items items.json --override system-one=cand.txt   # A/B one description
node route-eval.mjs --items items.json --json out.json # per-item probabilities
```

It composes each skill's frontmatter `status` into its criteria text at the point of
use, so a demoted skill is visibly demoted to the judge without a status sentence being
baked into its prose.

**It is a measurement rig, not a runtime router.** It sends only this repo's own skill
descriptions plus the labelled prompts in `items.json` — public content by the
classification in `../references/data-boundary.md`. Pointing it at live session prompts
is the egress decision that file says must be taken explicitly, not a config change.

### Always use `--reps`

Measured 2026-09-16: at 10 candidates the picks were bit-identical across three repeats,
but **at 131 candidates they are not** — items where the top two options sit within
~0.05 of each other flip between runs. Two runs of an identical configuration scored
34/40 and 36/40. Single-rep comparisons at fleet scale are inside the noise; use
`--reps 3` and read the soft (pass-fraction) score, which is the same lesson
`skill-tuning` learnt on its own target agent.

## `items.json` — labelled routing items

40 items over 24 skills, in three provenance tiers. Tier A was authored in earlier
sessions, tier B from `SKILL-DIRECTORY.md`'s `When to Choose` column (written
independently of the frontmatter under test), tier C alongside this skill and therefore
biased upward — it is reported separately and excluded from headline figures.

Two labels have been corrected by measurement rather than assumption: the
client-handover item is a genuine dual-skill request, and the browser items were
relabelled to `browser-automation` on operator policy after the judge picked it over the
label. **A disagreement between the judge and a label is not automatically a model
error** — check the label first.

## The runtime path is measured separately

The live router (ADR-2091) does not use this rig; it uses
`config/hooks/lib/skill-route.cjs`, whose candidate map excludes never-routable statuses and
adds a `none` option. Measure *that* path with the same items:

```bash
AGENTBOX_SKILL_ROUTER=jev AGENTBOX_SKILL_ROUTE_SKILLS_DIR=../.. \
  node ../../skill-router/scripts/route.mjs --eval items.json --reps 3
```

2026-09-16: 36.0/40 soft (90%), 3 `none`-picks, 0 failed calls — the same headline as the rig,
so the exclusions and the `none` option cost nothing measurable. Report the two numbers
separately; they answer different questions (description quality vs. what a turn gets).

## Not built

- **`probe.mjs`** — one-shot state + questions, printing full distributions; the thing
  to reach for while designing a judgment set.
- **`redact.mjs`** — only if the middle-ground classes in `../references/data-boundary.md`
  are approved. Mechanical, tested, assertable.
