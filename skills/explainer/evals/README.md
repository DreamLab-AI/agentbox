# Evals: running the A/B on the local model

`evals.json` holds the prompts skill-creator runs. Skill-creator's default loop runs the
skill under test in Claude subagents and grades with Claude agents. For this skill the
question is whether the explainer works on the **local production model alone**, so the
runner is inverted: the run happens in an OpenCode session on `loom-agent/current` (Qwen
through the Loom), and Claude Code is used only to grade, compare and answer hand-ups.
Tokens are spent on judgement, not on drafting.

`run-case.sh` runs one eval case against one skill root and writes the result in the
layout skill-creator's grader, viewer and `aggregate_benchmark.py` expect:

```
<workspace>/iteration-<N>/eval-<ID>/<old_skill|with_skill>/
  outputs/          what the run produced (the production record)
  transcript.jsonl  every OpenCode event (tool calls, results, text)
  timing.json       wall clock, exit status, model identity, skill root hash
  opencode.json     the per-run config that pinned the skill root
```

The skill root is pinned per run with `OPENCODE_CONFIG`, which OpenCode merges as an
extra config file, so old and candidate never share a skills path. The baseline root is a
frozen copy of the skill (skill-creator's "snapshot before editing"); the candidate root
is the source tree. Both roots must also contain the specialists the case will discover
(at least `codebase-video`), because discovery is part of what is measured.

Hand-ups are part of the result. `scripts/handup.mjs stats --record outputs` gives the
per-run hand-up count, reason mix and tokens by tier; the analyst pass reads those
alongside the assertion grades. A candidate that scores the same on assertions but hands
up less has improved.

Serialise runs: the model and the GPU specialists (ComfyUI, speech) are shared services,
so run old and candidate one after the other, counterbalancing the order across repeats,
and note cold or warm cache in `timing.json`.
