# ADR-061: Persist an ACCEPT night's candidate as a draft PR

- **Status:** Accepted — built + unit-tested (2026-08-27). Push/PR path validated
  by the first live ACCEPT night.
- **Relates to:** [ADR-056](ADR-056-dream-decision-surface.md) (cockpit
  pending-merge queue), [ADR-052](ADR-052-dream-machine-hp-annexe.md), the
  one-week dreaming audit (2026-08-26)

## Context

The audit found the promotion loop broken **upstream of the human merge**: across
a week and 17 ACCEPTs, ~0 became mergeable code. The engine's flow was
*discover → dispatch → evaluate → LLM → verdict → persist(report, ledger, witness,
memory)* — it never turned a validated candidate into a branch or PR. The prompt
told the model to "create branch, open draft PR", but the model runs on the
control plane with no push path, so wins evaporated as reports. Only repos where a
human re-applied the finding by hand (dreamlab-ai-website's direct commits) landed
anything. ADR-056's cockpit pending-merge queue has nothing to show until the
engine actually persists.

## Decision

On an **ACCEPT** night, materialise the candidate as a **draft PR** — on the
control plane, so no annexe dependency:

1. **The LLM emits the patch.** Prompt step 20 now requires ACCEPT to include one
   git-apply-able unified diff in a ` ```dream-patch ` fenced block (omitted only
   when the finding has no code change). The model does **not** run git/gh.
2. **The engine persists it** (`persist.rs`): extract the block; build the branch
   in an **isolated git worktree at HEAD** (`worktree add -b dream/<deep>-<date>`),
   so the operator's uncommitted working tree is never touched; `git apply --3way`
   the patch; commit; push; `gh pr create --draft`. The worktree is removed after.
3. **The PR reference** (URL, or `branch:<name>` if the PR call failed) lands in
   the ledger row's PR column — where ADR-056's pending-merge queue reads it and
   the fate-token discipline tracks its eventual `#N:MERGED`.

### Guardrails

- **Draft only; the merge stays human** — evaluation is not promotion. `autoMerge`
  is never set; the engine never merges.
- **Fail-open.** A failed apply/push/PR never fails the night — the win still lands
  in the report, ledger and memory; a warning is logged and the local branch kept.
- **Gated.** `[dream_machine].persist_accepts` (default `true`) disables it wholesale.
- **Isolated.** The worktree means a persist run cannot corrupt or commit the
  operator's uncommitted files (proved by a unit test).

## Consequences

- Closes the loop the audit exposed: ACCEPT → reviewable draft PR → cockpit
  pending-merge queue → human merge → `#N:MERGED` fate token → accurate
  `zeroMergeStreak`. Every prior fix this cycle now has something to act on.
- Control-plane only, so it is testable offline (patch extraction, branch naming,
  and the worktree apply/commit are unit-tested — 64 tests green). The network
  steps (push, `gh pr create`) validate on the first live ACCEPT night; until then
  they fail-open.
- Quality of the persisted PR is only as good as the LLM's emitted diff; a diff
  that does not apply to HEAD is dropped with a logged reason, not force-committed.
