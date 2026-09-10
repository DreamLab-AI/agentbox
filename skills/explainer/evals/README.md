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

The skill root is pinned per run in place. OpenCode discovers skills from `~/.claude/skills`
first, then the project walk-up, the Codex skills dir and `skills.paths`, and keeps the
first copy of a name, so an extra config file alone pins nothing (measured 2026-09-10: the
run root was logged as the duplicate), and a sandbox `HOME` stalls in OpenCode's embedded
package manager. The runner therefore points the `explainer` and `codebase-video` symlinks
in `~/.claude/skills` at the run root for the duration of the run and restores them on
exit. Runs are serialised, so the swap is safe; do not start a Claude Code session that
needs the hot copy while a run is in progress.

When the deliverable lands in the target repository, pass `--target-seed` and
`--target-subdir` so each run starts from identical inputs: the deliverable directory is
reset to the seed before the run, archived to `target-after/` afterwards, and the target is
left as it was found. Without this the second variant inherits the first one's chapters
(measured 2026-09-10, the baseline run wrote its chapters straight into the target).

`opencode run` is non-interactive and auto-rejects any permission it would otherwise ask
for, so the per-run config allows edit, bash, web fetch and reads of the workspace, the
prompt directory, the skill root and any `--allow` directory, while denying `git push` and
recursive deletes. A run without those permissions stops after its first step.

Hand-ups are part of the result. `scripts/handup.mjs stats --record outputs` gives the
per-run hand-up count, reason mix and tokens by tier; the analyst pass reads those
alongside the assertion grades. A candidate that scores the same on assertions but hands
up less has improved.

Serialise runs: the model and the GPU specialists (ComfyUI, speech) are shared services,
so run old and candidate one after the other, counterbalancing the order across repeats,
and note cold or warm cache in `timing.json`.
