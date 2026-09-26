# /dream — control the nightly dream machine

Control the dream-engine (nightly evidence-gated repository evolution, ADR-052 the connected node annexe). Reference: `docs/developer/dream-engine.md` in the agentbox repo.

Parse the argument and act:

## `/dream status` (or no argument)

Report, concisely:
1. **Loop state**: `supervisorctl status dream-engine` is the canonical owner; a tmux `dream-engine` session is a fallback that must NOT coexist with it (the engine's singleton lock on 127.0.0.1:49172 makes a duplicate exit, but report it as drift). Also whether `/home/devuser/workspace/.agentbox/dream-paused` exists (paused).
2. **Roster**: list dirs under `/home/devuser/workspace/` containing `dream.config.json`. For each: manual standby (`.dream-standby` marker present?), dry streak (count trailing INCONCLUSIVE rows in its `docs/dream-cycle/LEDGER.md` — ACCEPT/REJECT reset the count; BLOCKED-ENV and HANDOFF rows neither count nor reset — the first is a broken harness, the second a nomination refused at evaluator-readiness admission), and the last ledger row (date, deep, verdict, witness). Fair-scheduling state lives in `/home/devuser/workspace/.agentbox/dream-roster.json` — least-recently-dreamed repos lead tonight's selection, so a repo over the cap is deferred, never starved.
3. **Tonight**: window is 01:00–05:00 UTC; eligible repos (not paused, not standby, streak < 5) dream serially, capped at 5 and ordered least-recently-dreamed first.
4. **Last night's health**: `/home/devuser/workspace/.agentbox/dream-last-night.json` (one honest verdict per eligible repo; FAILED/BLOCKED-ENV entries mean the harness, not the repos, needs fixing; HANDOFF means a repo's `evaluatorEntrypoints` cannot decide that deep).
5. **Gate**: for any night of interest, `<artefact_dir>/<date>-<repo>/` holds `manifest.json` (what was frozen before the model call), `run-state.json` (restart-safe phase journal), `receipts/{baseline,candidate}/` (raw stdout/stderr, exit codes, durations), `candidate.json` and `gate.json`. A `gate.json` with a non-empty `vetoes` array is the interesting case: the model claimed something the required evaluators refused (ADR-2024).
6. **Decisions**: open questions and alerts are cases on the forum governance panel (https://dreamlab-ai.com/community/governance, "Dream machine decisions", published by JunkieJarvis). `node /home/devuser/workspace/project/agentbox/scripts/dream-inbox.mjs list` shows the engine's working copy.

## `/dream questions` · `/dream answer <id> <text>` · `/dream dismiss <id>`

The operator decides on the **forum governance panel** (ADR-2115): every open item is a case there — Approve, Reject (say why) or Amend (write your own instruction); "Acknowledge all alerts" on the panel clears the alert backlog. The engine ingests those signed decisions at the start of each night. Point the user there first. The `dream-inbox-surface.cjs` hook only reminds sessions how many cases are waiting.

The local file (`workspace/.agentbox/dream-inbox.json`) is the engine's working copy; the CLI below is a break-glass path for when the forum is unavailable:

```bash
node /home/devuser/workspace/project/agentbox/scripts/dream-inbox.mjs list [--all]
node /home/devuser/workspace/project/agentbox/scripts/dream-inbox.mjs answer <id> "<decision>"
node /home/devuser/workspace/project/agentbox/scripts/dream-inbox.mjs dismiss <id>
```

To push open items to the panel or pull decisions now (instead of waiting for the night): `dream-engine governance publish|ingest [--dry-run]`. Answered items feed the repo's next night as hypothesis carry-over. For decisions with cross-agent value, additionally `memory_store` the decision to namespace `project-state`.

## `/dream harvest [--days N]`

Weekly value-extraction report — verdict counts, streaks, ACCEPT nights awaiting human merge decisions, inbox state, environment-fault rate:

```bash
node /home/devuser/workspace/project/agentbox/scripts/dream-harvest.mjs [--days 7]
```

Present the "ACCEPT nights awaiting human review" list and ask the user which to review; a validated finding nobody merges is value left on the floor.

## `/dream off` · `/dream on`

- off: `mkdir -p /home/devuser/workspace/.agentbox && touch /home/devuser/workspace/.agentbox/dream-paused` — the loop skips nights while the flag exists; no process restart. Confirm: "dreaming paused".
- on: `rm -f /home/devuser/workspace/.agentbox/dream-paused`. If the nightly window is still open the same night runs on the next 10-minute tick.

## `/dream run [repo]`

One-shot cycle now, ignoring the window. The engine holds a singleton lock
(127.0.0.1:49172) so a one-shot cannot race the nightly loop — stop the loop
first, run, restart. Use the baked `dream-engine` on PATH (the one supervisord runs) —
`services/dream-engine/target/release` is a stale dev build — with the loop's environment:
```bash
P=$(pgrep -f 'bin/dream-engine' | head -1); mapfile -d '' E < /proc/$P/environ   # the loop's env (SSH target, Z.AI key)
supervisorctl stop dream-engine
cd /home/devuser/workspace && env -i "${E[@]}" RUST_LOG=info dream-engine --once [--target <repo>] \
  --agentbox-toml /etc/agentbox.toml 2>&1 | tail -20
supervisorctl start dream-engine    # always restart, whatever the cycle's exit
```
Without a repo: dreams every eligible repo serially (a full night, 10–40 min — warn the user before starting). With a repo: single cycle (2–8 min), works even on standby repos. Report verdict, witness, and whether RuVector stored it. Note the engine archives the repo's **HEAD** — uncommitted changes are invisible to the night by design (witness = evaluated tree).

## `/dream standby <repo>` · `/dream revive <repo>`

- standby: `touch /home/devuser/workspace/<repo>/.dream-standby` — parks the repo (skipped nightly, `--target` still works).
- revive: `rm -f /home/devuser/workspace/<repo>/.dream-standby`. If the repo is also parked by a dry streak (5 trailing INCONCLUSIVE ledger rows), tell the user: only a decisive verdict clears that — suggest `/dream run <repo>` after fixing whatever kept the nights INCONCLUSIVE (usually an evaluator gap; see the repo's last report under `/home/devuser/workspace/.tmp/dream-annexe-artefacts/`).

## `/dream digest [date]`

(Re-)issue the nightly forum digest (JunkieJarvis → dreamlab zone → chat with agents):
```bash
dream-engine digest [--date YYYY-MM-DD] [--dry-run]
```
Plain English, composed from the engine's night-health record: every scheduled repo's outcome (including BLOCKED-ENV, HANDOFF and FAILED), the standby/parked roster on a night where nothing was eligible, and how many decisions wait on the governance panel. The engine verifies its own event is readable back from the relay and says so — report `published+verified`/`NOT VERIFIED` to the user verbatim. To replace an existing digest, first send a kind-5 deletion for the old event id (as JunkieJarvis), then re-run.

## `/dream nominate <repo>`

Confirm the repo exists under `/home/devuser/workspace/`, then author a `dream.config.json` in its root following the schema in `docs/developer/dream-engine.md`. Non-negotiables: `autoMerge: false`; every `evaluatorEntrypoints` command must be **provably live** (run it once and check it produces surface-dependent output — a silent no-op evaluator is the #1 historical failure); slots reflect the repo's OWN surfaces; anything owned by an upstream/downstream repo is fenced out via an `extraDisciplines` handoff rule. If the roster already has 5 active repos, warn that the cap will skip the excess.

## Guardrails

- Never delete a repo's `dream.config.json`, ledger, or reports to "prune" it — standby markers and streaks are the only parking mechanisms.
- Never set `autoMerge: true` — merges are human-only (or explicitly guarded per repo by the user).
- `ZAI_ANTHROPIC_API_KEY` is required for the default provider; if missing, cycles degrade to INCONCLUSIVE — check env before diagnosing "broken" nights.
