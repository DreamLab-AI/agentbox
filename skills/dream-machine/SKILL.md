---
name: dream-machine
description: >
  Control and inspect the nightly dream machine — the dream-engine loop that runs
  evidence-gated repository evolution overnight (ADR-052). Use when the user says
  "/dream", "dream machine", "dream engine", "did anything dream last night", asks
  about the dream ledger/inbox/roster, or wants to pause, resume, or put a repo on
  standby. NOT for sleep/dream content, ML "DreamerV3"-style agents, or the
  qe_learning_dream AQE tool.
section: Automation
---

# Dream Machine

Thin router skill: the operational contract lives in [commands/dream.md](commands/dream.md),
which defines `/dream status|pause|resume|standby|inbox` behaviour. Engine source:
`services/dream-engine/`; developer reference: `docs/developer/dream-engine.md`.

Quick orientation:

- Canonical process owner is supervisord (`supervisorctl status dream-engine`); a tmux
  `dream-engine` session is drift.
- Nightly window 01:00–05:00 UTC; eligible repos are those under `~/workspace/` with a
  `dream.config.json`, not paused/standby, dry streak < 5, cap 5 per night.
- Health: `~/workspace/.agentbox/dream-last-night.json`; open questions:
  `node scripts/dream-inbox.mjs list` (agentbox repo).

For any `/dream <arg>` invocation, follow [commands/dream.md](commands/dream.md) exactly.
