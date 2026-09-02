---
name: hermes-scheduler
description: "Schedule recurring agent tasks on cron/interval/one-shot schedules — start with /hermes-scheduler. Triggers: 'run this every 30m', 'schedule a daily 9am job', 'cron job that invokes Claude Code', 'background scheduler for agent tasks'. A standalone Python daemon that runs natural-language jobs via `claude --print`, persists jobs across restarts, and saves per-run output. Inspired by NousResearch/hermes-agent. NOT for one-off tasks you can run now, NOT a system-cron/systemd replacement, and NOT for orchestrating multi-agent swarms."
version: 1.0.0
author: jjohare
license: MIT
metadata:
  hermes:
    tags: [scheduler, cron, background, daemon, polling, always-on]
    category: automation
    related_skills: []
---

# Hermes Scheduler

Background cron scheduler that runs agent tasks on schedule. Jobs are defined in
natural language, executed via `claude --print`, and output is saved per-run.
Jobs persist across restarts.

## Quick start

The scheduler is a single baked binary,
`hermes-scheduler` (on PATH from the `agentbox-ops` crate).

```bash
hermes-scheduler start                     # start daemon (60s tick)
hermes-scheduler add \
  --prompt "check disk usage and alert if over 80%" \
  --schedule "every 30m" --name "disk-monitor"
hermes-scheduler list                       # list jobs
hermes-scheduler status                     # daemon status
```

Schedules accept durations (`30m`, one-shot), intervals (`every 2h`), cron
(`0 9 * * *`), or ISO timestamps (`2026-04-07T09:00`).

Runtime state lives under `~/.claude/scheduler/` (jobs, output, PID) and is
created by the daemon on first run.

## Depth

- Full command reference, schedule formats, job execution, persistence, and
  architecture: [references/commands.md](references/commands.md)
