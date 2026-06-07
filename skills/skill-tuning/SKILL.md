---
name: "Skill Tuning"
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

## Hard-Won Lessons (the real IP — read before every run)

- **Trajectory persistence is load-bearing.** The reflect analyst reads *only*
  `predictions/<id>/conversation.json`. If the env's rollout doesn't write it,
  the analyst returns `None` instantly and you get **0 edits / 0 calls** with a
  near-zero `reflect_s` — looks like a backend bug, is actually missing I/O.
- **Never leak the reference solution.** The target often works in a worktree at
  the *correct* commit. A naïve `git diff` would feed the answer to the
  optimizer. Commit a **stubbed baseline** first and capture `git diff HEAD` so
  only the agent's own work is recorded.
- **Gate saturation pins best = S₀.** A tiny/easy val split scores everything
  1.0, so ties favour the incumbent and nothing is ever selected. Mitigate with a
  larger/harder val set, and *always* settle the verdict with the direct held-out
  comparator, not the trainer's gate.
- **Stochasticity is severe near threshold.** The same skill scored an item 0/31
  on one run and 33/34 on the next (target-model non-determinism). Single evals
  are coin-flips: use `reps ≥ 3` and prefer the **continuous soft score**
  (pass-fraction) — it discriminates even when the binary hard score saturates.
- **Read the right signal on a subscription backend.** The `claude_chat`
  optimizer backend shells to `claude -p` (subscription, $0 metered) and does
  **not** increment the global token/call counter — `calls=0` is uninformative;
  use `reflect_s` timing to confirm the analyst ran.
- **Patch mode can't restructure.** If Arm A's edits read correctly but land in
  the wrong section (e.g. the key guidance ends up at the bottom under an
  unrelated heading), that's the patch-mode ceiling, not a bad edit — consider
  Arm B for that skill.

## Harness (live, reusable)

Root: `/home/devuser/workspace/skillopt-lab` · venv: `.venv/bin/python`

| Asset | Path | Purpose |
|-------|------|---------|
| SkillOpt fork | `repo/` (`skillopt` pkg) | the loop; trainer at `repo/scripts/train.py` |
| Trainer config | `repo/configs/solidpodrs/default.yaml` | backends, splits, edit budget, gate metric |
| Env adapter | `repo/skillopt/envs/solidpodrs/` | `adapter.py`, `dataloader.py`, `rollout.py`, `__init__.py` |
| Task generator | `rust-task/gen_dataset.py` | stub-and-restore dataset builder |
| Worktree isolation | `rust-task/prepare_worktree.sh`, `cleanup_worktree.sh` | per-item isolated checkout |
| Reward checker | `rust-task/score.sh` | cargo test → hard + soft |
| Difficulty calibration | `rust-task/calibrate.py` | find the gradient regime |
| Held-out comparator | `rust-task/replicate_eval.py` | replicated A/B (reps + soft) |
| Single-shot comparator | `rust-task/eval_skill_on_test.py` | quick one-skill check |
| Plumbing smoke (no LLM/cargo) | `rust-task/smoke_prediction.py` | verify trajectory capture before a real run |
| Splits | `rust-task/data/{train,val,test}/items.json` | item ids per split |

**Models:** target `claude-haiku-4-5-20251001`; optimizer/author `claude-opus-4-8`;
mesh second tier `claude-sonnet-4-6`.

**Run Arm A (trainer):**
```bash
cd /home/devuser/workspace/skillopt-lab/rust-task
bash run_arm_a.sh /home/devuser/workspace/skillopt-lab/runs/run-opus
# → runs/run-opus/best_skill.md + steps/step_0001/{merged_patch.json,candidate_skill.md}
```

**Held-out A/B (cargo is serial — never run two cargo jobs at once):**
```bash
cd /home/devuser/workspace/skillopt-lab/rust-task
/home/devuser/workspace/skillopt-lab/.venv/bin/python replicate_eval.py 3 test \
  S0=<seed_skill.md> armA=<runs/run-opus/best_skill.md> armB=<runs/run-mesh/best_skill.md>
# → .eval/replicate-test/comparison.json  (hard_acc, soft_acc, per-item runs)
```

## Plugging In a New Skill / Task

To tune a *different* skill, add a new env under `repo/skillopt/envs/<name>/`
implementing the same four-file contract:

- **`dataloader.py`** — load `data/{split}/items.json`; each item is a unit of
  work with an `id`.
- **`rollout.py`** — for each item: set up an isolated workspace, drop the skill
  in context, run the target agent (Read/Edit-only lever as needed), score it,
  **and write `predictions/<id>/conversation.json`** (`[user, assistant, system]`)
  capturing task, the agent's response, and its own diff (no reference leakage).
  Return `{id, hard, soft, task_description, fail_reason, n_turns}`.
- **`adapter.py`** — wire the env into SkillOpt's batch runner.
- **`__init__.py`** — export the batch entrypoint.

The reward must yield both a **hard** (binary success) and **soft** (continuous
fraction) score; the soft score is what makes A/B verdicts survive noise. The
worktree/serial-cargo specifics are Rust-task-isms — replace with whatever
isolation + checker your task needs; keep the *contract* (isolated run →
deterministic score → persisted trajectory) identical.

## Outputs of a Tuning Run

- `runs/<arm>/best_skill.md` — the optimized candidate per arm.
- `runs/run-opus/steps/step_NNNN/merged_patch.json` — the ranked edits with
  support counts (the human-auditable "what changed and why").
- `runs/run-mesh/allocation.md` — the mesh's self-chosen model split + rationale.
- `.eval/replicate-test/comparison.json` — the held-out verdict.
- A findings entry in RuVector memory (`project-state` / `patterns`).

## Related Skills

- `skill-builder` — author a new skill (use *before* tuning a fresh one).
- `build-with-quality` — the trial subject; its EDD layer ("executed evidence
  required; narrative evidence auto-rejected") is the same discipline this loop
  enforces empirically.
- `docs-alignment` — prose/cross-link consistency (orthogonal to reward).

## License

MIT
