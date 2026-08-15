# /dream — control the nightly dream machine

Control the dream-engine (nightly evidence-gated repository evolution, ADR-052 HP annexe). Reference: `docs/developer/dream-engine.md` in the agentbox repo.

Parse the argument and act:

## `/dream status` (or no argument)

Report, concisely:
1. **Loop state**: `tmux has-session -t dream-engine 2>/dev/null && echo running || echo stopped` (after image rebuild: `supervisorctl status dream-engine`). Also whether `/home/devuser/.agentbox/dream-paused` exists (paused).
2. **Roster**: list dirs under `/home/devuser/workspace/` containing `dream.config.json`. For each: manual standby (`.dream-standby` marker present?), dry streak (count trailing INCONCLUSIVE rows in its `docs/dream-cycle/LEDGER.md` — ACCEPT/REJECT reset the count), and the last ledger row (date, deep, verdict, witness).
3. **Tonight**: window is 01:00–05:00 UTC; eligible repos (not paused, not standby, streak < 5, cap 5) all dream serially.

## `/dream off` · `/dream on`

- off: `mkdir -p /home/devuser/.agentbox && touch /home/devuser/.agentbox/dream-paused` — the loop skips nights while the flag exists; no process restart. Confirm: "dreaming paused".
- on: `rm -f /home/devuser/.agentbox/dream-paused`. If the nightly window is still open the same night runs on the next 10-minute tick.

## `/dream run [repo]`

One-shot cycle now, ignoring the window:
```bash
cd /home/devuser/workspace/project/agentbox/services/dream-engine && \
RUST_LOG=info ./target/release/dream-engine --once [--target <repo>] 2>&1 | tail -20
```
Without a repo: dreams every eligible repo serially (a full night, 10–40 min — warn the user before starting). With a repo: single cycle (2–8 min), works even on standby repos. Report verdict, witness, and whether RuVector stored it.

## `/dream standby <repo>` · `/dream revive <repo>`

- standby: `touch /home/devuser/workspace/<repo>/.dream-standby` — parks the repo (skipped nightly, `--target` still works).
- revive: `rm -f /home/devuser/workspace/<repo>/.dream-standby`. If the repo is also parked by a dry streak (5 trailing INCONCLUSIVE ledger rows), tell the user: only a decisive verdict clears that — suggest `/dream run <repo>` after fixing whatever kept the nights INCONCLUSIVE (usually an evaluator gap; see the repo's last report under `/home/devuser/workspace/.tmp/dream-annexe-artefacts/`).

## `/dream digest [date]`

(Re-)issue the nightly forum digest (JunkieJarvis → dreamlab zone → chat with agents):
```bash
node /home/devuser/workspace/project/agentbox/scripts/dream-night-digest.mjs [--date YYYY-MM-DD] [--dry-run]
```
Default style is plain English (`DREAM_DIGEST_STYLE=terse` for the compact form). The script verifies its own event is readable back from the relay and says so — report `published+verified`/`NOT VERIFIED` to the user verbatim. To replace an existing digest, first send a kind-5 deletion for the old event id (as JunkieJarvis), then re-run.

## `/dream nominate <repo>`

Confirm the repo exists under `/home/devuser/workspace/`, then author a `dream.config.json` in its root following the schema in `docs/developer/dream-engine.md`. Non-negotiables: `autoMerge: false`; every `evaluatorEntrypoints` command must be **provably live** (run it once and check it produces surface-dependent output — a silent no-op evaluator is the #1 historical failure); slots reflect the repo's OWN surfaces; anything owned by an upstream/downstream repo is fenced out via an `extraDisciplines` handoff rule. If the roster already has 5 active repos, warn that the cap will skip the excess.

## Guardrails

- Never delete a repo's `dream.config.json`, ledger, or reports to "prune" it — standby markers and streaks are the only parking mechanisms.
- Never set `autoMerge: true` — merges are human-only (or explicitly guarded per repo by the user).
- `ZAI_ANTHROPIC_API_KEY` is required for the default provider; if missing, cycles degrade to INCONCLUSIVE — check env before diagnosing "broken" nights.
