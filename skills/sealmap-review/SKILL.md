---
name: sealmap-review
description: >-
  Reviews a whole project or system from its diagrams-as-code corpus: risks,
  technical due diligence, a pre-mortem, or an outside opinion before running,
  shipping or taking it over. External mode sends the diagrams only, never code,
  to Gemini 3.8 Flash under critical and pre-mortem lenses; inline mode has a
  Claude subagent check topics against the code they cite. Findings are
  hypotheses for build-with-quality triage. Use for "review this project", "what
  would worry you running this", "pre-mortem this", "have Gemini look at the
  diagrams", "do the diagrams still match the code". Not for a PR or diff
  (code-review), writing the corpus (diagrams-as-code), or web research.
compatibility: "Claude Code and Codex. External mode is a zero-dependency Node >= 18 script and needs GEMINI_API_KEY in the environment. Inline mode uses the Agent tool to run a Sonnet reviewer; a Codex session runs the same checklist itself, one topic at a time."
related_skills: [diagrams-as-code, build-with-quality, explainer, consultant]
---

# sealmap review

A diagrams-as-code corpus is a distillation of a codebase: consolidated topics,
both narratives, and the authors' own Tension, Debt, Drift and Open markers.
This skill reads that distillation critically, in two modes that answer
different questions.

| Mode | Reviewer | Sees | Answers | Cost on a 630k-token corpus |
|---|---|---|---|---|
| External | Gemini 3.8 Flash, high thinking | diagrams only | what an outsider would worry about before running it | about 3 min for two lenses; the second lens reads the pack from cache |
| Inline | Claude subagent (Sonnet; Opus for security- or custody-heavy topics) | a topic plus the code it cites | does this topic still tell the truth about the code | minutes per topic |

Both write findings in one shape, and every finding is a hypothesis.
What measurement showed works and what does not: [references/evidence.md](references/evidence.md).
A reviewer may over-assert or be wrong. Nothing is fixed on a reviewer's word:
findings go to build-with-quality, which reproduces each one with a failing test
or check before anyone acts on it (see "After the review").

## When to use

- Someone wants an opinion, a review, a pre-mortem or due diligence on a project
  that has a `docs/diagrams` corpus, especially one too large to send as code.
- Before taking over, shipping or handing on a large system: the external lenses
  rank its production risks.
- While writing or re-verifying a topic: inline mode is the local fidelity loop.
- To measure whether a corpus carries its issues: the blind external run (below).

No corpus yet? Build one first with `diagrams-as-code`; this skill reviews the
distillation, and without one it has nothing to read.

## External review

```bash
S=skills/sealmap-review/scripts/external-review.cjs
node $S docs/diagrams                         # both lenses, register included
node $S docs/diagrams --only control-plane/   # one area (needed past ~1M tokens)
node $S docs/diagrams --lens critical --count 25
node $S docs/diagrams --register strip        # blind: authors' markers removed
node $S docs/diagrams --dry-run               # pack and estimate only; nothing sent
```

The script packs every topic file the generator gates, in path order: the
diagrams, both narratives and the markers. It sends the pack first and each lens
prompt last, so every lens after the first reads the pack from Gemini's cache.
It writes these files to `.diagram-review/<timestamp>/` (gitignore it):
- one review per lens
- `findings.json`: every `F-nn` and `R-n` parsed out, each `status: "unverified"`
- the exact pack
- a manifest with the revision, pack hash, tokens, cache hits and timings

Lenses live in `assets/lenses/`:

- **critical**: "I am deciding whether to take responsibility for running this."
  It allows no scores and no praise, and asks for the N most consequential
  problems ranked by production damage, contradictions first. Each finding names
  its topic ids, evidence, failure scenario and confidence, and says whether the
  authors had already marked it.
- **premortem**: "It is twelve months on and there has been a serious incident."
  It returns three root causes, each with a chain of events and the warning
  signs visible today, then latent defects in the same shape.

Do not use an open "what do you think of this project" prompt. Measured on a
45-topic corpus, it opened with "exceptionally engineered… masterclass" and
stayed general. The two lenses produced no praise and 15 to 18 specific
findings each. Measurements and caveats are in
[references/external-review.md](references/external-review.md).

**Register included or stripped.** With the markers included, the review
ranks the authors' known problems: a useful triage, but mostly a rediscovery of
the register. Stripping the markers (`--register strip`) tests the distillation:
if a blind reviewer can rediscover known Tensions from the diagrams alone, the
corpus carries its issues and not just its structure. Run the default for
decisions and the stripped run to judge a corpus.

## Inline review

The local back-and-forth while a topic is written or re-stamped. Give a Claude
subagent one topic, or the topics whose sources changed, and have it read every
cited `path:line` and judge the claim. The generator's `--cite-check` only proves
the cited line exists. The subagent's brief, fault classes and output shape are
in [references/inline-review.md](references/inline-review.md). The fault classes:

- wrong callee
- missing call
- invented edge
- stale claim
- contradiction with a governing ADR
- unsupported narrative claim

Use Sonnet by default and Opus for security, custody or identity topics. Fix
real faults in the topic, then run the generator gate again. Faults in the
code itself become findings like any other.

## After the review

**Staleness.** A pack built from topics that have gone stale produces false
findings. Run triage and re-stamp what it flags before an expensive audit.

**Two families.** When both a GLM review and a Gemini audit exist for a pack,
`node $C merge` ranks findings raised independently by both first
(`docs/review/<date>-merged.{md,json}`; agreement ranks, it does not verify).

Findings are input to build-with-quality, never instructions. For each one:

1. **Reproduce it.** Write the failing test, check or citation that shows the
   defect. If it cannot be shown, record the finding as rejected with the
   evidence and move on.
2. **Classify it.** Code defect, so fix test-first. Corpus fault, so correct
   the topic. Known and accepted, so it is already a register marker: link it.
   New and real, so fix it, or add the marker if it is accepted.
3. **Close it.** Record a verdict on each `findings.json` entry: `confirmed`,
   `rejected` or `known`, with the evidence. The confirmed rate across runs
   shows which lens earns its tokens.

## Scheduled review

`[diagram_review].enabled` ships true: a supervised cron keeps every corpus
honest without anyone asking, and keeps the expensive reviewer rare. Corpus repos
are auto-discovered under `$WORKSPACE` (depth 3, `docs/diagrams/<area>/NN-*.md`);
extra or excluded paths go in the gitignored `config/diagram-review.local`, never
in the public manifest.

- **triage** (GLM, daily): topics whose `sources:` changed since the last triage
  get one cheap "is this topic now wrong?" call (unsure means yes). Change is read
  per source repository: each cited path is resolved by realpath and attributed to
  the innermost git repo that owns it, so an estate corpus citing sibling repos and
  a nested submodule is read from the right history. `docs/review/<date>-triage.md`
  lists what to re-author. It never edits a topic.
- **review-glm** (GLM, nightly after the dream window): critical and premortem lenses, one
  pack per area (large areas split by token budget). GLM is effectively free, and a shard
  whose pack hash is unchanged is skipped, so a quiet night costs nothing.
- **audit-gemini**: the external review above, per shard, only when
  `gemini_min_interval_days` have passed, `gemini_min_changed_topics` topics changed
  (or the shard's last GLM review found something high severity), and month-to-date
  spend plus a `countTokens` estimate fits `gemini_monthly_usd`. Most-changed first.

Every run, refusals included, appends a line to `docs/diagrams/review-ledger.jsonl`;
findings land in `docs/review/` as unverified hypotheses.

```bash
C=skills/sealmap-review/scripts/review-cadence.cjs
node $C status                 # resolved repos, ledger summary, month-to-date spend
node $C audit-gemini --dry-run # which shards would the gate open, at what estimate?
node $C merge                  # rank findings both GLM and Gemini raised first
```

Gate, ledger fields, discovery, sharding and pricing: [references/cadence.md](references/cadence.md).

## Never

- Send source code in external mode. The distillation is the point, and the
  code may be private beyond what the corpus already cites.
- Treat a finding as a fix instruction, or a clean review as proof of
  correctness.
- Put the API key in a file, argument or log. The script reads it from the
  environment and writes it nowhere.
- Review a corpus whose topics fail `diagram-index-gen.cjs --check`: fix the
  structure first.

## Depth on demand

- [references/external-review.md](references/external-review.md): options,
  token budget and sharding, the pilot measurements, prompt design, cost.
- [references/inline-review.md](references/inline-review.md): the subagent
  brief, fault classes, model choice, the loop with the author.
- `assets/lenses/`: the lens prompts. A new lens is a Markdown file there, using
  `{{COUNT}}` and the `### F-01 — title` finding shape.
- [references/cadence.md](references/cadence.md): the scheduled review: gate,
  ledger, schedules, spend cap, pricing constants.
- `scripts/review-cadence.cjs`, `run-cron.sh`, `crontab`: the cadence runner,
  its boot wrapper and crontab template.
- [references/evidence.md](references/evidence.md): the measured evidence table.
- `scripts/merge-findings.cjs`: the multi-family agreement merge.
- `scripts/external-review.test.cjs`, `scripts/review-cadence.test.cjs`,
  `scripts/merge-findings.test.cjs`: the offline suites (`node --test`).
- `evals/evals.json`: trigger and behaviour cases.
