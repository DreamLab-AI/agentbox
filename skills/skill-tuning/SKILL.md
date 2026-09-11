---
name: skill-tuning
description: "Empirically optimize any existing Claude skill against a measurable reward signal using a closed SkillOpt loop (rollout → reflect → aggregate → select → evaluate) plus a noise-robust held-out A/B comparator. Use when you want a skill's prose tuned by evidence rather than eyeballed — e.g. raising an agent's success rate on a bounded, scoreable task — or to compare a single-optimizer arm against a mesh arm. Complements skill-builder (which authors skills); this one tunes them."
license: MIT
metadata:
  version: 1.0.0
  author: DreamLab AI
  tags: [meta-skill, skill-optimization, skillopt, eval, ab-testing, reward, held-out, reflect, gradient, subscription-cli]
  mcp_server: false
---

# Skill Tuning — Optimize a Skill Against a Reward Signal

Author prose is a guess until a reward measures it. This skill turns skill
improvement into a measurable optimization loop: you pick a skill, define a task
that scores an agent following it, and let the loop propose edits that provably
raise the score on **held-out** items. It is the empirical counterpart to
`skill-builder` (which scaffolds a skill from scratch) and to `docs-alignment`
(which checks prose consistency). Neither of those measures whether the skill
actually makes an agent *succeed*. This one does.

> **Trial of record:** the framework was validated end-to-end by tuning the
> `build-with-quality` skill's `DEBUGGING-PROTOCOL.md` against a Rust
> stub-and-restore task. That run is the worked example throughout; build-with-
> quality was only the *trial subject* — the capability generalizes to any skill.

## When To Use

- You have a skill whose effect you can **score**: there is (or you can build) a
  bounded task where an agent reads the skill, acts, and a deterministic checker
  returns a number (tests pass-rate, eval-rubric score, structural assertions).
- You want edits justified by a measured uplift on items the optimizer never saw,
  not by intuition.
- You want to compare optimization strategies (single strong optimizer vs a
  multi-model mesh) on the same evidence.

**When NOT to use:**

- Authoring a brand-new skill → `skill-builder`.
- Checking prose/cross-link consistency only → `docs-alignment`.
- A skill whose value cannot be reduced to any measurable task (pure stylistic
  guidance with no success criterion). Without a reward there is no gradient — do
  not force one; a saturated 0%/100% task teaches nothing.

## The Loop (SkillOpt)

```
                 ┌─────────── one step (epoch × batch) ───────────┐
seed skill S₀ →  │ rollout → reflect → aggregate → select → update │ → candidate
                 └────────────────────────┬───────────────────────┘
                                          ▼
                              evaluate (gate) on val
                       accept_new_best  /  keep incumbent
                                          ▼
                       held-out test eval (baseline vs best)
```

- **rollout** — run the *target* agent on a minibatch of training items, each
  with the current skill in context. Capture every trajectory.
- **reflect** — an *analyst* model reads each trajectory and proposes edits
  (failure edits fix what broke; success edits codify what worked).
- **aggregate/merge** — dedupe overlapping edits across the batch, rank by
  support count, keep the strongest within an edit budget.
- **select/update** — apply the merged patch to produce a candidate skill.
- **evaluate (gate)** — score the candidate on a validation split; accept it as
  the new best only if it beats the incumbent.
- **held-out test** — finally, score S₀ and the best skill on a *test* split the
  optimizer never touched. That delta is the only number that matters.

## Two Optimizer Arms

Run either or both on the **same** rollout evidence for a fair comparison:

- **Arm A — single strong optimizer.** One model (e.g. Opus) plays analyst +
  merger inside the SkillOpt trainer. Edits are applied in **patch mode**
  (anchored insert/replace). Conservative: preserves the seed's structure,
  grafts in islands. *Limitation: patch mode cannot restructure — if the seed's
  framing is wrong for the regime, the right ideas land in the wrong place.*
- **Arm B — mesh.** A coordinator self-allocates an Opus/Sonnet split across
  roles (e.g. Opus = skill-author, Sonnet = failure-analyst + red-team) and
  produces a **full rewrite**. Escapes the seed's structure; coherent and
  regime-native, at higher coordination cost.
  *Honesty note:* if the spawn path doesn't expose a per-worker `model`
  parameter, the "split" is role-effort inside the coordinator turn, not separate
  model processes — document that in `allocation.md` rather than overclaiming.

The trial found both arms converge on the same *content* insight; they differ in
*form* (graft vs rewrite). Use the held-out comparator to pick the winner, then
promote its insight **surgically** into the real skill — do not paste either
candidate wholesale.

## Procedure

1. **Pick the skill and the reward task.** Choose a skill file as `S₀`. Build a
   task where an agent following it produces an artifact a checker can score.
   Split items into `train` / `val` / `test` (the optimizer sees train+val only;
   test is the held-out ruler).
2. **Calibrate to a gradient regime.** A task the agent already aces (or always
   fails) yields no signal. Add a difficulty lever until the seed scores in the
   ~30–80% band. *Trial lever:* restrict the target to `Read,Edit` (no `Bash`),
   removing brute-force verification and forcing reason-from-code. This is what
   created headroom — the seed assumed a runnable loop that no longer existed.
3. **Baseline.** Score `S₀` on test (with replication — see below).
4. **Run an arm.** Arm A: launch the SkillOpt trainer with a config (see
   *Harness*). Arm B: hand the mesh coordinator a no-leakage evidence packet
   (seed + the *same* rollout trajectories, no reference solution, no test items)
   and have it self-allocate and write `best_skill.md` + `allocation.md`.
5. **Compare on held-out, noise-robustly.** Run `replicate_eval.py` over
   `S₀ / armA / armB` on the test split with `reps ≥ 3`. Report `hard_acc` and
   `soft_acc`.
6. **Bank findings** (RuVector `project-state` / `patterns`) — method, deltas,
   and every gotcha hit (these are the reusable IP).
7. **Promote surgically.** Land only the winning insight into the live skill,
   scoped to where it actually generalizes. Resist smearing a corner-case insight
   across the whole skill.

## Depth on demand

The worked trial's Hard-Won Lessons (read before every run), the live
harness asset table and run commands (`/home/devuser/workspace/skillopt-lab`,
verified present 2026-09-09), the four-file contract for plugging in a new
skill/task, and the output artefact list all live in
[references/worked-trial-and-harness.md](references/worked-trial-and-harness.md).

## Related Skills

- `skill-builder` — author a new skill (use *before* tuning a fresh one); it
  links back here for measuring whether wording changes actually work.
- `build-with-quality` — the trial subject; its EDD layer ("executed evidence
  required; narrative evidence auto-rejected") is the same discipline this loop
  enforces empirically.
- `docs-alignment` — prose/cross-link consistency (orthogonal to reward).

## License

MIT
