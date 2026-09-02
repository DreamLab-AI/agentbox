# Hermes Scheduler — Command Reference

All commands run via the baked scheduler binary
`hermes-scheduler` (on PATH from the `agentbox-ops` crate).

```bash
# Start the scheduler daemon (background, 60-second tick)
hermes-scheduler start

# Stop the scheduler
hermes-scheduler stop

# Check status
hermes-scheduler status

# Create a job
hermes-scheduler add \
  --prompt "check disk usage and alert if over 80%" \
  --schedule "every 30m" \
  --name "disk-monitor"

# Create a one-shot job
hermes-scheduler add \
  --prompt "generate a weekly project status summary" \
  --schedule "30m"

# Create a cron job
hermes-scheduler add \
  --prompt "pull latest from all repos and run tests" \
  --schedule "0 9 * * *" \
  --name "morning-ci"

# List jobs
hermes-scheduler list

# Remove a job
hermes-scheduler remove --id <job_id>

# Pause / resume
hermes-scheduler pause --id <job_id>
hermes-scheduler resume --id <job_id>

# Trigger a job immediately
hermes-scheduler trigger --id <job_id>

# View recent output for a job
hermes-scheduler output --id <job_id>
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
