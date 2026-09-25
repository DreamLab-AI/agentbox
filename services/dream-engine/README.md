# dream-engine

Nightly evidence-gated repository evolution engine for agentbox.

Part of [agentbox](https://github.com/DreamLab-AI/agentbox); the crate lives at `services/dream-engine` and is a
self-contained Cargo workspace.

`dream-engine` compiles configuration into deterministic prompts, dispatches
them to the configured LLM annexe, parses the returned verdicts, and persists
the outcome to the evidence ledger and to RuVector.

### What it does

- Turns the dream configuration into a deterministic prompt set, so two runs of
  the same configuration produce the same prompts.
- Dispatches to the configured backend and parses structured verdicts.
- Writes results to the ledger and the vector store, gated on evidence rather
  than on model assertion.

### Acceptance path

A night is an experiment, and the engine is built so the model cannot grade its
own homework. Seven modules carry that path:

- **`manifest`** — freezes the experiment *before* a token is spent: baseline
  revision and tree, the selected evaluators and the hash of their command
  strings, the model to be asked, and a `run_id` that is a pure function of
  those inputs. Written once, atomically. A restart recomputes the same id and
  resumes against a byte-identical manifest; one that diverged (the baseline
  moved under an interrupted run) is archived, never silently overwritten.
- **`readiness`** — refuses an unusable nomination *before* scheduling, rather
  than discovering it after a clone, a build and a model call. Static: it reads
  the config and the checked-out tree and runs nothing. No evaluators, none
  covering tonight's deep, none *required* for it (so nothing could ever veto),
  an empty command, a script absent from the tree, or a non-probative command
  (`echo`, `true`, `:`) are all refusals. The refusal verdict is a handoff to a
  human, and because no evaluator ran it is not evidence about the repository
  and never counts toward a dry streak.
- **`candidate`** — applies the emitted patch in isolation, in a git worktree at
  HEAD on a fresh branch, and re-runs the required evaluators *against that
  tree*. Receipts bind to the worktree's tree hash, not to a branch name. This
  closes the loop that previously left the model's diff untested: everything it
  saw was evidence about the baseline.
- **`receipts`** — typed evaluator evidence: exit code, both streams verbatim
  and never truncated, wall-clock duration, and an outcome derived from them by
  a pure function, per phase (`baseline` / `candidate`). An evaluator that
  exited non-zero, printed nothing, or never ran is no longer indistinguishable
  from one that passed.
- **`gate`** — the deterministic required-check veto, a pure function of the
  frozen manifest, the typed receipts and the strict verdict parse, consulted
  *after* the candidate has been re-evaluated. A required evaluator that is
  missing, silent, blocked, timed out, explicitly failing or non-zero vetoes
  acceptance whatever the report claims. The veto class picks the substituted
  verdict:

  | class | cause | verdict |
  |---|---|---|
  | harness | missing / silent / blocked / timed out / patch would not apply | `BLOCKED-ENV` |
  | evidence | non-zero exit or explicit FAIL | `REJECT` |
  | unproven | no candidate patch, or an unreadable verdict line | `INCONCLUSIVE` |

  `BLOCKED-ENV` is deliberate for harness faults: a broken annexe is not
  evidence against the repository and must not park a healthy repo on a dry
  streak.
- **`runstate`** — durable run identity and a phase journal written after every
  transition, so a restart learns without guessing whether the night already
  finished (skip), died part-way (resume, attempt counted) or has burned its
  attempt budget (abandon loudly rather than loop).
- **`roster`** — least-recently-run ordering backed by a durable file, so the
  eligible-repository cap rotates through the whole roster instead of pinning
  its alphabetical head and starving the tail.

A draft PR is opened **only on a gate-upheld ACCEPT** — never on the model's
say-so. A vetoed candidate is discarded so no unverified diff is left looking
promotable, and the merge stays human: evaluation is not promotion.

#### Declaring evaluators

`evaluatorEntrypoints` accepts either form:

```json
{
  "evaluatorEntrypoints": {
    "tests":  "cargo test",
    "clippy": { "cmd": "cargo clippy -- -D warnings",
                "required": true, "deeps": ["rust"], "timeoutSecs": 900 }
  }
}
```

A bare string is read **fail-closed** — `required: true`, all deeps, default
timeout — because an evaluator a repository bothered to declare is evidence the
night is expected to honour. An advisory evaluator (`"required": false`) runs
and is recorded but cannot veto; an empty `deeps` means every deep.

### Usage

```sh
dream-engine --help
```

## Licence — AGPL-3.0-only, NOT dual-licensed

**This crate is licensed under the GNU Affero General Public License, version 3
only (AGPL-3.0-only). It is _not_ dual-licensed under MIT OR Apache-2.0.**

Most of the `services/` subtree is permissive (MIT OR Apache-2.0). This crate is
a documented exception: it links `nostr-bbs-core` (AGPL-3.0-only) for Nostr
signing, verification and the forum governance wire types (ADR-2115), so it
cannot grant permissive terms and does not attempt to. The operator chose this on
2026-09-25 over mirroring the forum's wire types in a permissive crate. Do not
copy the sibling crates' licensing boilerplate into this directory, and do not
publish this crate under the permissive assumption.

The full licence text is in [LICENSE](LICENSE). See
[ADR-2030](https://github.com/DreamLab-AI/agentbox/blob/main/docs/adr/ADR-2030-permissive-licensing-for-publishable-service-crates.md)
and [services/LICENSING-NOTICE.md](https://github.com/DreamLab-AI/agentbox/blob/main/services/LICENSING-NOTICE.md).

### Contribution

Contributions to this crate are accepted under AGPL-3.0-only.

## Repository

<https://github.com/DreamLab-AI/agentbox> — path `services/dream-engine`.
