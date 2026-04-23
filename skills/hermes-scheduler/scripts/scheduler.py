#!/usr/bin/env python3
"""
Hermes Scheduler — background cron daemon for Claude Code agent tasks.

Adapted from NousResearch/hermes-agent cron patterns. Standalone, no Hermes deps.
Jobs stored in ~/.claude/scheduler/jobs.json, output in ~/.claude/scheduler/output/.
Executes jobs via `claude --print "<prompt>"` subprocess.

Usage:
    python3 scheduler.py start          # Start daemon (background)
    python3 scheduler.py stop           # Stop daemon
    python3 scheduler.py status         # Check if running
    python3 scheduler.py tick           # Run one tick (for testing)
    python3 scheduler.py add --prompt "..." --schedule "every 30m" [--name "..."]
    python3 scheduler.py list           # List all jobs
    python3 scheduler.py remove --id ID
    python3 scheduler.py pause --id ID
    python3 scheduler.py resume --id ID
    python3 scheduler.py trigger --id ID
    python3 scheduler.py output --id ID [--lines N]
"""

import argparse
import copy
import json
import logging
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import fcntl
except ImportError:
    fcntl = None

try:
    from croniter import croniter
    HAS_CRONITER = True
except ImportError:
    HAS_CRONITER = False

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCHEDULER_DIR = Path.home() / ".claude" / "scheduler"
JOBS_FILE = SCHEDULER_DIR / "jobs.json"
OUTPUT_DIR = SCHEDULER_DIR / "output"
PID_FILE = SCHEDULER_DIR / "scheduler.pid"
LOCK_FILE = SCHEDULER_DIR / ".tick.lock"
LOG_FILE = SCHEDULER_DIR / "scheduler.log"
TICK_INTERVAL = 60  # seconds
ONESHOT_GRACE_SECONDS = 120

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("hermes-scheduler")


def _now() -> datetime:
    return datetime.now(timezone.utc).astimezone()


def _ensure_dirs():
    SCHEDULER_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(SCHEDULER_DIR, 0o700)
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Schedule Parsing (adapted from hermes-agent cron/jobs.py)
# ---------------------------------------------------------------------------

def parse_duration(s: str) -> int:
    """Parse duration string to minutes. '30m'->30, '2h'->120, '1d'->1440."""
    s = s.strip().lower()
    match = re.match(r"^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$", s)
    if not match:
        raise ValueError(f"Invalid duration: '{s}'. Use '30m', '2h', or '1d'")
    value = int(match.group(1))
    unit = match.group(2)[0]
    return value * {"m": 1, "h": 60, "d": 1440}[unit]


def parse_schedule(schedule: str) -> Dict[str, Any]:
    """Parse schedule string into structured format."""
    schedule = schedule.strip()
    original = schedule
    lower = schedule.lower()

    # "every X" -> recurring interval
    if lower.startswith("every "):
        minutes = parse_duration(schedule[6:].strip())
        return {"kind": "interval", "minutes": minutes, "display": f"every {minutes}m"}

    # Cron expression (5+ space-separated fields of digits/*/-, /)
    parts = schedule.split()
    if len(parts) >= 5 and all(re.match(r"^[\d\*\-,/]+$", p) for p in parts[:5]):
        if not HAS_CRONITER:
            raise ValueError("Cron expressions require 'croniter'. Install: pip install croniter")
        try:
            croniter(schedule)
        except Exception as e:
            raise ValueError(f"Invalid cron expression '{schedule}': {e}")
        return {"kind": "cron", "expr": schedule, "display": schedule}

    # ISO timestamp
    if "T" in schedule or re.match(r"^\d{4}-\d{2}-\d{2}", schedule):
        try:
            dt = datetime.fromisoformat(schedule.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.astimezone()
            return {"kind": "once", "run_at": dt.isoformat(), "display": f"once at {dt:%Y-%m-%d %H:%M}"}
        except ValueError as e:
            raise ValueError(f"Invalid timestamp '{schedule}': {e}")

    # Duration -> one-shot from now
    try:
        minutes = parse_duration(schedule)
        run_at = _now() + timedelta(minutes=minutes)
        return {"kind": "once", "run_at": run_at.isoformat(), "display": f"once in {original}"}
    except ValueError:
        pass

    raise ValueError(
        f"Invalid schedule '{original}'. Use:\n"
        f"  Duration: '30m', '2h' (one-shot)\n"
        f"  Interval: 'every 30m' (recurring)\n"
        f"  Cron: '0 9 * * *'\n"
        f"  Timestamp: '2026-04-07T09:00'"
    )


def _ensure_aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=_now().tzinfo)
    return dt.astimezone(_now().tzinfo)


def compute_next_run(schedule: Dict[str, Any], last_run_at: Optional[str] = None) -> Optional[str]:
    now = _now()
    kind = schedule["kind"]

    if kind == "once":
        if last_run_at:
            return None
        run_at = schedule.get("run_at")
        if not run_at:
            return None
        run_at_dt = _ensure_aware(datetime.fromisoformat(run_at))
        if run_at_dt >= now - timedelta(seconds=ONESHOT_GRACE_SECONDS):
            return run_at
        return None

    if kind == "interval":
        minutes = schedule["minutes"]
        if last_run_at:
            last = _ensure_aware(datetime.fromisoformat(last_run_at))
            return (last + timedelta(minutes=minutes)).isoformat()
        return (now + timedelta(minutes=minutes)).isoformat()

    if kind == "cron" and HAS_CRONITER:
        cron = croniter(schedule["expr"], now)
        return cron.get_next(datetime).isoformat()

    return None


def _compute_grace_seconds(schedule: Dict[str, Any]) -> int:
    MIN_GRACE, MAX_GRACE = 120, 7200
    kind = schedule.get("kind")
    if kind == "interval":
        period = schedule.get("minutes", 1) * 60
        return max(MIN_GRACE, min(period // 2, MAX_GRACE))
    if kind == "cron" and HAS_CRONITER:
        try:
            now = _now()
            cron = croniter(schedule["expr"], now)
            first = cron.get_next(datetime)
            second = cron.get_next(datetime)
            period = int((second - first).total_seconds())
            return max(MIN_GRACE, min(period // 2, MAX_GRACE))
        except Exception:
            pass
    return MIN_GRACE


# ---------------------------------------------------------------------------
# Job CRUD
# ---------------------------------------------------------------------------

def load_jobs() -> List[Dict[str, Any]]:
    _ensure_dirs()
    if not JOBS_FILE.exists():
        return []
    try:
        with open(JOBS_FILE, "r") as f:
            return json.load(f).get("jobs", [])
    except (json.JSONDecodeError, IOError):
        return []


def save_jobs(jobs: List[Dict[str, Any]]):
    _ensure_dirs()
    fd, tmp = tempfile.mkstemp(dir=str(SCHEDULER_DIR), suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump({"jobs": jobs, "updated_at": _now().isoformat()}, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, JOBS_FILE)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def create_job(prompt: str, schedule: str, name: Optional[str] = None,
               repeat: Optional[int] = None, workdir: Optional[str] = None) -> Dict[str, Any]:
    parsed = parse_schedule(schedule)
    if repeat is not None and repeat <= 0:
        repeat = None
    if parsed["kind"] == "once" and repeat is None:
        repeat = 1

    job = {
        "id": uuid.uuid4().hex[:12],
        "name": name or prompt[:50].strip(),
        "prompt": prompt,
        "schedule": parsed,
        "schedule_display": parsed.get("display", schedule),
        "repeat": {"times": repeat, "completed": 0},
        "enabled": True,
        "state": "scheduled",
        "workdir": workdir,
        "created_at": _now().isoformat(),
        "next_run_at": compute_next_run(parsed),
        "last_run_at": None,
        "last_status": None,
        "last_error": None,
    }

    jobs = load_jobs()
    jobs.append(job)
    save_jobs(jobs)
    return job


def get_due_jobs() -> List[Dict[str, Any]]:
    now = _now()
    raw = load_jobs()
    jobs = copy.deepcopy(raw)
    due = []
    dirty = False

    for job in jobs:
        if not job.get("enabled", True):
            continue
        next_run = job.get("next_run_at")
        if not next_run:
            continue

        next_dt = _ensure_aware(datetime.fromisoformat(next_run))
        if next_dt > now:
            continue

        schedule = job.get("schedule", {})
        kind = schedule.get("kind")
        grace = _compute_grace_seconds(schedule)

        # Fast-forward stale recurring jobs
        if kind in ("cron", "interval") and (now - next_dt).total_seconds() > grace:
            new_next = compute_next_run(schedule, now.isoformat())
            if new_next:
                logger.info("Job '%s' stale (missed by %ds, grace=%ds). Fast-forwarding to %s",
                            job.get("name", job["id"]),
                            int((now - next_dt).total_seconds()), grace, new_next)
                for rj in raw:
                    if rj["id"] == job["id"]:
                        rj["next_run_at"] = new_next
                        dirty = True
                continue

        due.append(job)

    if dirty:
        save_jobs(raw)
    return due


def advance_next_run(job_id: str) -> bool:
    jobs = load_jobs()
    for job in jobs:
        if job["id"] == job_id:
            kind = job.get("schedule", {}).get("kind")
            if kind not in ("cron", "interval"):
                return False
            new_next = compute_next_run(job["schedule"], _now().isoformat())
            if new_next and new_next != job.get("next_run_at"):
                job["next_run_at"] = new_next
                save_jobs(jobs)
                return True
    return False


def mark_job_run(job_id: str, success: bool, error: Optional[str] = None):
    jobs = load_jobs()
    for i, job in enumerate(jobs):
        if job["id"] != job_id:
            continue
        now = _now().isoformat()
        job["last_run_at"] = now
        job["last_status"] = "ok" if success else "error"
        job["last_error"] = error if not success else None

        if job.get("repeat"):
            job["repeat"]["completed"] = job["repeat"].get("completed", 0) + 1
            times = job["repeat"].get("times")
            completed = job["repeat"]["completed"]
            if times is not None and times > 0 and completed >= times:
                jobs.pop(i)
                save_jobs(jobs)
                return

        job["next_run_at"] = compute_next_run(job["schedule"], now)
        if job["next_run_at"] is None:
            job["enabled"] = False
            job["state"] = "completed"
        elif job.get("state") != "paused":
            job["state"] = "scheduled"

        save_jobs(jobs)
        return
    save_jobs(jobs)


def save_job_output(job_id: str, output: str) -> Path:
    _ensure_dirs()
    job_dir = OUTPUT_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    timestamp = _now().strftime("%Y-%m-%d_%H-%M-%S")
    outfile = job_dir / f"{timestamp}.md"
    outfile.write_text(output, encoding="utf-8")
    return outfile


def remove_job(job_id: str) -> bool:
    jobs = load_jobs()
    before = len(jobs)
    jobs = [j for j in jobs if j["id"] != job_id]
    if len(jobs) < before:
        save_jobs(jobs)
        return True
    return False


def pause_job(job_id: str) -> bool:
    jobs = load_jobs()
    for job in jobs:
        if job["id"] == job_id:
            job["enabled"] = False
            job["state"] = "paused"
            job["paused_at"] = _now().isoformat()
            save_jobs(jobs)
            return True
    return False


def resume_job(job_id: str) -> bool:
    jobs = load_jobs()
    for job in jobs:
        if job["id"] == job_id:
            job["enabled"] = True
            job["state"] = "scheduled"
            job["paused_at"] = None
            job["next_run_at"] = compute_next_run(job["schedule"])
            save_jobs(jobs)
            return True
    return False


def trigger_job(job_id: str) -> bool:
    jobs = load_jobs()
    for job in jobs:
        if job["id"] == job_id:
            job["enabled"] = True
            job["state"] = "scheduled"
            job["next_run_at"] = _now().isoformat()
            save_jobs(jobs)
            return True
    return False


# ---------------------------------------------------------------------------
# Job Execution
# ---------------------------------------------------------------------------

def run_job(job: Dict[str, Any]) -> tuple:
    """Execute a job via claude --print. Returns (success, output, error)."""
    prompt = job["prompt"]
    workdir = job.get("workdir") or str(Path.home() / "workspace")

    logger.info("Running job '%s': %s", job.get("name", job["id"]), prompt[:80])

    try:
        result = subprocess.run(
            ["claude", "--print", prompt],
            capture_output=True,
            text=True,
            timeout=600,  # 10 minute timeout
            cwd=workdir,
            env={**os.environ, "CLAUDE_NO_TELEMETRY": "1"},
        )
        output = result.stdout or ""
        if result.returncode != 0:
            error = result.stderr or f"Exit code {result.returncode}"
            return False, output + "\n\n---\nSTDERR:\n" + error, error
        return True, output, None
    except subprocess.TimeoutExpired:
        return False, "", "Job timed out after 600s"
    except FileNotFoundError:
        return False, "", "claude CLI not found in PATH"
    except Exception as e:
        return False, "", str(e)


# ---------------------------------------------------------------------------
# Tick (single scheduler cycle)
# ---------------------------------------------------------------------------

def tick() -> int:
    _ensure_dirs()
    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)

    lock_fd = None
    try:
        lock_fd = open(LOCK_FILE, "w")
        if fcntl:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (OSError, IOError):
        logger.debug("Tick skipped — another instance holds the lock")
        if lock_fd:
            lock_fd.close()
        return 0

    try:
        due = get_due_jobs()
        if not due:
            return 0

        logger.info("%d job(s) due", len(due))
        executed = 0

        for job in due:
            try:
                advance_next_run(job["id"])
                success, output, error = run_job(job)
                outfile = save_job_output(job["id"], output)
                logger.info("Job '%s' %s. Output: %s",
                            job.get("name", job["id"]),
                            "succeeded" if success else f"failed: {error}",
                            outfile)
                mark_job_run(job["id"], success, error)
                executed += 1
            except Exception as e:
                logger.error("Error processing job %s: %s", job["id"], e)
                mark_job_run(job["id"], False, str(e))

        return executed
    finally:
        if fcntl and lock_fd:
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
        if lock_fd:
            lock_fd.close()


# ---------------------------------------------------------------------------
# Daemon
# ---------------------------------------------------------------------------

def _write_pid():
    PID_FILE.write_text(str(os.getpid()))


def _read_pid() -> Optional[int]:
    if PID_FILE.exists():
        try:
            return int(PID_FILE.read_text().strip())
        except (ValueError, IOError):
            pass
    return None


def _is_running() -> bool:
    pid = _read_pid()
    if pid is None:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def daemon_start():
    if _is_running():
        print(f"Scheduler already running (PID {_read_pid()})")
        return

    _ensure_dirs()

    # Set up file logging for daemon
    fh = logging.FileHandler(LOG_FILE)
    fh.setLevel(logging.INFO)
    fh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    logger.addHandler(fh)

    # Fork to background
    pid = os.fork()
    if pid > 0:
        print(f"Scheduler started (PID {pid})")
        print(f"  Jobs: {JOBS_FILE}")
        print(f"  Output: {OUTPUT_DIR}")
        print(f"  Log: {LOG_FILE}")
        return

    # Child — detach
    os.setsid()
    pid2 = os.fork()
    if pid2 > 0:
        os._exit(0)

    # Grandchild — the actual daemon
    sys.stdin.close()
    sys.stdout = open(LOG_FILE, "a")
    sys.stderr = sys.stdout

    _write_pid()

    def _shutdown(signum, frame):
        logger.info("Scheduler stopping (signal %d)", signum)
        try:
            PID_FILE.unlink()
        except OSError:
            pass
        os._exit(0)

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    logger.info("Scheduler daemon started (PID %d, tick every %ds)", os.getpid(), TICK_INTERVAL)

    while True:
        try:
            tick()
        except Exception as e:
            logger.error("Tick error: %s", e)
        time.sleep(TICK_INTERVAL)


def daemon_stop():
    pid = _read_pid()
    if pid is None or not _is_running():
        print("Scheduler not running")
        try:
            PID_FILE.unlink()
        except OSError:
            pass
        return
    os.kill(pid, signal.SIGTERM)
    print(f"Scheduler stopped (PID {pid})")


def daemon_status():
    pid = _read_pid()
    if pid and _is_running():
        jobs = load_jobs()
        enabled = [j for j in jobs if j.get("enabled", True)]
        print(f"Scheduler running (PID {pid})")
        print(f"  Jobs: {len(enabled)} enabled / {len(jobs)} total")
        if enabled:
            for j in enabled:
                next_run = j.get("next_run_at", "unknown")
                last = j.get("last_status", "never")
                print(f"  - [{j['id']}] {j.get('name', '?')} | next: {next_run} | last: {last}")
    else:
        print("Scheduler not running")
        if PID_FILE.exists():
            PID_FILE.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Hermes Scheduler for Claude Code")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("start", help="Start scheduler daemon")
    sub.add_parser("stop", help="Stop scheduler daemon")
    sub.add_parser("status", help="Show scheduler status")
    sub.add_parser("tick", help="Run one tick (foreground)")

    add_p = sub.add_parser("add", help="Add a job")
    add_p.add_argument("--prompt", required=True, help="Natural language task")
    add_p.add_argument("--schedule", required=True, help="Schedule: '30m', 'every 2h', '0 9 * * *'")
    add_p.add_argument("--name", help="Friendly name")
    add_p.add_argument("--repeat", type=int, help="Repeat count (omit for forever)")
    add_p.add_argument("--workdir", help="Working directory (default: ~/workspace)")

    sub.add_parser("list", help="List all jobs")

    rm_p = sub.add_parser("remove", help="Remove a job")
    rm_p.add_argument("--id", required=True, help="Job ID")

    pause_p = sub.add_parser("pause", help="Pause a job")
    pause_p.add_argument("--id", required=True, help="Job ID")

    resume_p = sub.add_parser("resume", help="Resume a paused job")
    resume_p.add_argument("--id", required=True, help="Job ID")

    trig_p = sub.add_parser("trigger", help="Trigger a job immediately")
    trig_p.add_argument("--id", required=True, help="Job ID")

    out_p = sub.add_parser("output", help="View recent output")
    out_p.add_argument("--id", required=True, help="Job ID")
    out_p.add_argument("--lines", type=int, default=50, help="Lines to show")

    args = parser.parse_args()

    if args.command == "start":
        daemon_start()
    elif args.command == "stop":
        daemon_stop()
    elif args.command == "status":
        daemon_status()
    elif args.command == "tick":
        n = tick()
        print(f"Tick complete: {n} job(s) executed")
    elif args.command == "add":
        job = create_job(args.prompt, args.schedule, args.name, args.repeat, args.workdir)
        print(f"Job created: {job['id']}")
        print(f"  Name: {job['name']}")
        print(f"  Schedule: {job['schedule_display']}")
        print(f"  Next run: {job['next_run_at']}")
    elif args.command == "list":
        jobs = load_jobs()
        if not jobs:
            print("No jobs")
            return
        for j in jobs:
            status = j.get("state", "?")
            last = j.get("last_status", "never")
            rep = j.get("repeat", {})
            count = f"{rep.get('completed', 0)}/{rep.get('times') or '∞'}"
            print(f"  [{j['id']}] {j.get('name', '?')} | {j.get('schedule_display', '?')} | "
                  f"state={status} last={last} runs={count}")
    elif args.command == "remove":
        if remove_job(args.id):
            print(f"Job {args.id} removed")
        else:
            print(f"Job {args.id} not found")
    elif args.command == "pause":
        if pause_job(args.id):
            print(f"Job {args.id} paused")
        else:
            print(f"Job {args.id} not found")
    elif args.command == "resume":
        if resume_job(args.id):
            print(f"Job {args.id} resumed")
        else:
            print(f"Job {args.id} not found")
    elif args.command == "trigger":
        if trigger_job(args.id):
            print(f"Job {args.id} triggered — will run on next tick")
        else:
            print(f"Job {args.id} not found")
    elif args.command == "output":
        job_dir = OUTPUT_DIR / args.id
        if not job_dir.exists():
            print(f"No output for job {args.id}")
            return
        files = sorted(job_dir.glob("*.md"), reverse=True)
        if not files:
            print(f"No output files for job {args.id}")
            return
        latest = files[0]
        print(f"--- {latest.name} ---")
        lines = latest.read_text().splitlines()
        for line in lines[-args.lines:]:
            print(line)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
