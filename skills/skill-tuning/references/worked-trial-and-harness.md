# Skill Tuning — Worked Trial, Harness, and Extension Contract

Depth material for `skills/skill-tuning/SKILL.md`. Read this before running
or extending the SkillOpt loop.

---

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

---

## Harness (live, reusable)

Root: `/home/devuser/workspace/skillopt-lab` · venv: `.venv/bin/python`

Verified live 2026-09-09: `repo/` (skillopt pkg), `rust-task/`, `runs/`, and
`.venv/` are all present exactly as documented below.

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

**Models (matches the estate's current lineup):** target
`claude-haiku-4-5-20251001`; optimizer/author `claude-fable-5-1`; mesh
second tier `claude-sonnet-5`.

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

---

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

---

## Outputs of a Tuning Run

- `runs/<arm>/best_skill.md` — the optimized candidate per arm.
- `runs/run-opus/steps/step_NNNN/merged_patch.json` — the ranked edits with
  support counts (the human-auditable "what changed and why").
- `runs/run-mesh/allocation.md` — the mesh's self-chosen model split + rationale.
- `.eval/replicate-test/comparison.json` — the held-out verdict.
- A findings entry in RuVector memory (`project-state` / `patterns`).
