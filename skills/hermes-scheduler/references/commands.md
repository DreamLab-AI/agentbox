# Hermes Scheduler — Command Reference

All commands run via the baked scheduler script at
`/opt/agentbox/skills/hermes-scheduler/scripts/scheduler.py`.

For brevity below, set:

```bash
SCHED=/opt/agentbox/skills/hermes-scheduler/scripts/scheduler.py
```

```bash
# Start the scheduler daemon (background, 60-second tick)
python3 "$SCHED" start

# Stop the scheduler
python3 "$SCHED" stop

# Check status
python3 "$SCHED" status

# Create a job
python3 "$SCHED" add \
  --prompt "check disk usage and alert if over 80%" \
  --schedule "every 30m" \
  --name "disk-monitor"

# Create a one-shot job
python3 "$SCHED" add \
  --prompt "generate a weekly project status summary" \
  --schedule "30m"

# Create a cron job
python3 "$SCHED" add \
  --prompt "pull latest from all repos and run tests" \
  --schedule "0 9 * * *" \
  --name "morning-ci"

# List jobs
python3 "$SCHED" list

# Remove a job
python3 "$SCHED" remove --id <job_id>

# Pause / resume
python3 "$SCHED" pause --id <job_id>
python3 "$SCHED" resume --id <job_id>

# Trigger a job immediately
python3 "$SCHED" trigger --id <job_id>

# View recent output for a job
python3 "$SCHED" output --id <job_id>
```

## Schedule Formats

| Format | Type | Example |
|--------|------|---------|
| Duration | One-shot | `30m`, `2h`, `1d` |
| Interval | Recurring | `every 30m`, `every 2h` |
| Cron | Recurring | `0 9 * * *`, `*/15 * * * *` |
| ISO timestamp | One-shot | `2026-04-07T09:00` |

## Job Execution

Each job runs as a subprocess: `claude --print "<prompt>"`. The agent has full
access to the workspace, tools, and MCP servers. Output is captured and saved to
`~/.claude/scheduler/output/<job_id>/<timestamp>.md`.

## Persistence

Runtime state lives under `~/.claude/scheduler/` (per-user, created by the
daemon — distinct from the baked skill directory):

- Jobs stored in `~/.claude/scheduler/jobs.json`
- Output per-run in `~/.claude/scheduler/output/`
- PID file at `~/.claude/scheduler/scheduler.pid`
- Lock file prevents concurrent ticks
- At-most-once semantics: recurring jobs advance next_run_at BEFORE execution
- Stale job fast-forwarding: if the daemon was down and missed a window, skips
  to next future run

## Architecture

Adapted from NousResearch/hermes-agent cron scheduler patterns. Standalone
Python daemon with no Hermes dependencies. Integrates with Claude Code via
subprocess invocation.
