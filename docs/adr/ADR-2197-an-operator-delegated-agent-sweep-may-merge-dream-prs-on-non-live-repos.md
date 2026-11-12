---
id: ADR-2197
title: An operator-delegated agent sweep (yolo mode) may merge dream PRs and clear the dream backlog on non-live repos
date: 2026-11-11
decision_status: accepted
implementation_status: complete
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 21318b600597671d34c6028758d1a950e722a483
verified_paths: [services/dream-engine/src/*.rs, scripts/dream-inbox.mjs]
owner: jjohare
review_trigger: any estate repo going live or gaining external users (contributors, customers, a public deployment others depend on); a forge identity that separates agent merges from human merges (ADR-2190's trigger); any engine change that makes a merge, an inbox answer or a governance decision happen without an agent session acting
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: amends ADR-2024 (the human-merge gate) for operator-delegated sweeps of non-live repos only; operator decision 2026-11-11
relates: [ADR-2024, ADR-2190, ADR-2087, ADR-2115, ADR-2141, ADR-2118]
evidence_class: source
acceptance_boundary: "Source at 21318b600 shows the engine opens draft PRs only (engine.rs:1868-1882) and has no merge path and never builds a 31403 (it only reads and verifies them, governance.rs:845); its only way to answer an inbox item is ingesting an operator-signed 31403; withdraw only retracts cases that are no longer open (governance.rs:622-635). The sweep itself is agent discipline written in skills/dream-machine/commands/dream.md; nothing in code enforces its limits, its exclusion list or its merge comment. Not shown: a sweep run, or the skill as baked into a rebuilt image."
---

# ADR-2197 — An operator-delegated agent sweep (yolo mode) may merge dream PRs and clear the dream backlog on non-live repos

## Context

- ADR-2024 makes every dream candidate human-merge-gated. `docs/developer/dream-engine.md:323` adds that ACCEPT triggers no automation, because keying permissions off a verdict creates a verdict-inflation incentive.
- The estate is not live. Its repos have no external users, and the operator and agents are the only parties. In practice the operator waves agent-prepared dream PRs through. The gate queues work without adding review, and green ACCEPT PRs, rotting candidates (fmt, clippy) and stale governance cases pile up between sessions.
- On 2026-11-11 the operator asked agents to "invent permission and clear the backlog on the system with your own judgement" and to make "yolo mode" a thing.
- ADR-2190 already records that agents merge under the operator's forge account. A merge event is therefore not review evidence, and the ledger's human cells come only from a recorded review.
- ADR-2115 makes the operator's signed kind-31403 decision the answer to a governance case. The engine ignores decisions signed by its own agent key and accepts an admin-signed one as the operator's answer, so an agent that signed one with any admin key it can reach would be impersonating the operator.
- Some estate repos are operator experiments, and some may become live. A sweep must be able to skip them without an engine change, and agentbox's tracked files are public, so private repo names cannot be listed in them.

## Decision

A **sweep** is a pass over the dream backlog that an agent session runs only when the operator delegates it, either for one session ("yolo mode", "clear the dream backlog with your own judgement") or standing. A standing delegation is the line `standing: yes` under the exclusion heading below; if that line is absent, delegation is per session only. It amends ADR-2024 for that case only. The sweep is agent-side: the engine still triggers nothing on ACCEPT and merges nothing, and no automation merges anything.

A sweep **may**:
1. merge dream PRs, oldest first, that the agent has read, judged correct and seen green on the PR head. A draft is marked ready first. Every merge carries this PR comment: `Merged under operator-delegated agent sweep (yolo mode, <YYYY-MM-DD>). No human review recorded; this merge is not review evidence and the ledger's Reviewer/Review-minutes cells stay empty (ADR-2190, ADR-2197).` If the agent pushed fixups, the comment names their SHAs, because the merged tree is then not the witnessed tree;
2. fix candidate rot (formatting, lints, a trivial rebase) on the PR branch, by ordinary commits;
3. close a wrong PR with a comment giving the reason;
4. answer code-design questions in the dream inbox on its own judgement through the break-glass CLI (`scripts/dream-inbox.mjs answer|dismiss`). Every answer begins `Agent sweep (yolo mode, <YYYY-MM-DD>):`, so the next night's carry-over cannot read it as the operator's;
5. dismiss alerts that are stale or superseded;
6. run `dream-engine governance withdraw` to retract cases that are no longer open;
7. rebase the engine's local ledger-row commits onto the remote and push them, fast-forward only. It does this only in a clean checkout (`git status --porcelain` empty) on the default branch, with no `--autostash`. It never does it between 01:00 and 05:00 UTC, or while a night holds `<artefact_dir>/.night-running.lock` (the file persists between nights; it is held when `flock -n <file> true` fails, as `ledger_io::night_in_progress` checks). Otherwise it skips the push and reports it.
8. repair a non-excluded repo's dream harness when a night's receipts show that the harness, not the candidate, decided the verdict. Two repairs are allowed: opting an existing evaluator into a dream-core fixer (`"fixer": "rustfmt"`, ADR-2141), and ignoring a file an evaluator writes into the work tree. The repair is an ordinary commit on the default branch whose message cites the night, and the config must still pass `dream validate`. It never removes an evaluator, makes a required one advisory, changes an evaluator's command, or touches `protected`, thresholds, slots, disciplines or `autoMerge`. Everything else in `dream.config.json` stays the operator's.

A sweep **never**:
- writes `review.json`, runs `dream-engine review import`, or fills the Reviewer or Review-minutes cells (ADR-2190);
- answers owner-fact questions: money, rates, staffing, legal or IP, or anything personal. These stay open for the operator;
- signs or forges a kind-31403 decision;
- merges, or pushes to, a change that touches the dream-gate guard's protected set (ADR-2141), except the ledger rows of point 7 and the harness repairs of point 8: its built-in defaults (`.github/**`, `.cargo/**`, manifests and lockfiles, `dream.config.json`, `CODEOWNERS`, `SECURITY.md`, and gate, safety, threshold, promotion, scorer, receipt and witness paths), plus the ledger, the evaluator-command paths, the config's `protected` globs and the extras `services/dream-engine/src/policy.rs` adds; a path the repo's `AGENTS.md` marks protected, or a surface that a `HANDOFF` discipline in `extraDisciplines` assigns to another repo;
- force-pushes or rewrites published history;
- touches an excluded repo.

**Exclusion** is an operator-maintained list under the heading `Dream sweep exclusions (ADR-2197)` in the gitignored `config/instructions/local/workspace.md`. It is projected into every session's workspace instructions (`~/workspace/AGENTS.md`, ADR-2118). Each line names one repository directory and a reason (`experiment` or `live`). The optional `standing: yes` line under the same heading records a standing delegation. The sweep fails closed. If the heading is absent from the session's workspace instructions, no sweep runs. A repo the agent is unsure about is skipped and reported.

## Consequences

- The backlog clears inside the session the operator delegates, not in the next human pass. Forge history stays honest: each sweep merge says that no human review happened, and the ledger's human cells stay empty, as ADR-2190 requires.
- Quality now rests on the agent's judgement and the PR's checks. A wrong merge on a non-live repo is reverted by an ordinary revert. That cost is acceptable only because nobody outside the estate consumes these repos, which is why going live is the review trigger.
- The engine is unchanged, so the verdict-inflation argument of `dream-engine.md:323` still holds. ACCEPT confers nothing. The sweep merges what the agent judges correct, and it may close an ACCEPT or merge after fixing one.
- Inbox answers given by a sweep feed the next night's carry-over with an agent prefix. A governance case answered this way is closed by the local answer plus `withdraw`, not by a signed decision. The panel's receipt trail (ADR-2115) therefore has no 31403 for it, and the inbox's prefixed answer text is the only record.
- Nothing in code enforces the limits or the exclusion list. They are skill text (`skills/dream-machine/commands/dream.md`, `/dream sweep`) and the agent's discipline. The fail-closed heading check turns a forgotten list into no sweep rather than a sweep of everything. It does not protect a repo that is live but missing from the list.
- The exclusion list lives in the estate layer, so it does not travel with a fresh checkout of agentbox. On a machine without the local layer, sweeps simply refuse.
- The ledger push (point 7) widens what agents write. The running image does not yet take ADR-2190's ledger lock, so the time window and the night lock file are the guard until the rebuild.
- `/dream sweep` reaches sessions only from the baked `/opt/agentbox/skills`, so activation waits for the next image rebuild. A session can read the checkout's copy before then.

### Rejected alternatives

- **Engine auto-merge on ACCEPT** (enable dream-core's automerge option, or set `autoMerge: true` per repo). It keys a permission off a verdict, which is exactly the inflation incentive `dream-engine.md:323` forbids. It would merge without any session reading the change, and it would act on live and experiment repos the same way. That would need its own ADR superseding ADR-2024, not an amendment.
- **Reusing `.dream-standby` as the exclusion marker.** It means "do not dream nightly". Most nominated repos carry it, while the experiment's clone, which still dreams, does not.
- **A per-checkout marker file.** A sweep enumerates PRs from the forge as much as from checkouts, and clones get recreated, so a marker is an unreliable sole signal. It would also add an untracked file to each repo.
- **A key in `dream.config.json`.** That file is protected in candidates and read by the engine. A new key is an engine-schema change, and the sweep must need none.

## Verification

At `21318b600597671d34c6028758d1a950e722a483` (the base of this change):

- The engine's only forge write is a draft PR on a gated ACCEPT. `services/dream-engine/src/engine.rs:1868-1882`: `git.push` then `gh pr create --draft` via `Forge::publish_draft`. `git grep -n -iE "pr merge|auto_?merge" 21318b600 -- services/dream-engine/src` finds two lines, neither a merge path: a test name, `prompt.rs:113` (`human_review_policy_when_no_auto_merge`), and the module comment `review.rs:5`, which says a merge event is not review evidence.
- `git grep -n 31403 21318b600 -- services/dream-engine/src` finds only comments and the decision planner (`governance.rs:11`, `:18-19`, `:845`; `inbox.rs:8`, `:43`). The engine reads and verifies 31403s. It never builds one.
- `governance::plan_withdrawals` (`services/dream-engine/src/governance.rs:622-635`) selects only items that are no longer open, were published and have not been withdrawn. `withdraw` (`:713`) is reached from `main.rs:196`. Withdrawing therefore cannot close an open case, and resolving one is the inbox CLI's job (`scripts/dream-inbox.mjs`, `answer` sets `status = 'answered'`).
- `docs/developer/dream-engine.md:323` states that ACCEPT triggers no automation. This change adds a sentence that leaves that statement true.
- The first sweep (2026-11-11) made both point-8 repairs from night evidence. visioncraft `a995fcc` ignores `__pycache__/`: `python3 -I` does not imply `-B`, so the skill-eval evaluator wrote bytecode that changed the candidate tree hash (night `2026-11-11-visioncraft`, BLOCKED-ENV with every required evaluator passing). visioncraft `d21ea9c` and visiontouch-rs `39feaf5` opt `fmt` into the rustfmt fixer, which was configured nowhere outside dream-engine itself (fmt vetoes on 11-06 to 11-11). Both configs pass `dream validate`.
- `implementation_status: complete` covers the procedure as written (the `/dream sweep` section, the governing-document invariant amendment and the fail-closed exclusion rule). It does not cover any run. Activation needs a rebuilt image that bakes the skill, and one sweep whose merges carry the comment.
