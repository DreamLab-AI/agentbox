#!/usr/bin/env python3
"""ruflo-daemon-gc — list and reap leaked ruflo/claude-flow daemons.

Pattern ported from pacphi/agentic-kit's daemons.mjs (MIT, Chris Phillipson):
registry-first discovery with a `ps` sweep fallback, staleness = workspace
gone OR older than the TTL, and a PID-REUSE GUARD — a PID is only signalled
after re-probing its live cmdline for `daemon start`; unconfirmable PIDs are
refused, never killed.

Context (agentbox): no ruflo daemon runs under supervisord and the runtime env
pins RUFLO_DAEMON_AI_WORKERS=0, so ANY daemon this finds was started ad hoc
inside a session (upstream ruflo #2661 background: leaked per-project daemons
once produced ~8.1B tokens/week). Upstream ruflo also self-reaps after a 12h
TTL — this tool is the belt-and-braces sweep between those reaps.

Usage:
  ruflo-daemon-gc.py              # preview (never signals)
  ruflo-daemon-gc.py --kill       # SIGTERM confirmed-stale daemons
  ruflo-daemon-gc.py --ttl 43200  # staleness age in seconds (default 12h)
  ruflo-daemon-gc.py --json       # machine-readable
"""

import argparse
import json
import os
import signal
import subprocess
import sys
import time

REGISTRY_FILES = ("ai-jobs.json", "workspace-leases.json", "repo-supervisors.json")


def proc_cmdline(pid):
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as fh:
            return fh.read().replace(b"\0", b" ").decode("utf-8", "ignore").strip()
    except OSError:
        return None


def proc_age_seconds(pid):
    try:
        st = os.stat(f"/proc/{pid}")
        return time.time() - st.st_mtime
    except OSError:
        return None


def is_daemon_process(pid):
    """PID-reuse guard: only True when the LIVE cmdline is a ruflo daemon."""
    cmd = proc_cmdline(pid)
    if cmd is None:
        return None  # can't confirm — refuse to touch
    return "daemon start" in cmd and ("cli.js" in cmd or "ruflo" in cmd or "claude-flow" in cmd)


def registry_daemons(cf_home):
    found = {}
    for name in REGISTRY_FILES:
        path = os.path.join(cf_home, name)
        try:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError):
            continue
        entries = data.values() if isinstance(data, dict) else data
        for e in entries if isinstance(entries, (list, type({}.values()))) else []:
            if not isinstance(e, dict):
                continue
            pid = e.get("pid")
            ws = e.get("workspace") or e.get("cwd") or e.get("repo") or "?"
            if isinstance(pid, int):
                found[pid] = {"pid": pid, "workspace": ws, "source": name}
    return found


def ps_sweep():
    found = {}
    try:
        out = subprocess.run(["ps", "axww", "-o", "pid=,args="],
                             capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return found
    for line in out.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) != 2 or "daemon start" not in parts[1]:
            continue
        if "cli.js" not in parts[1] and "ruflo" not in parts[1] and "claude-flow" not in parts[1]:
            continue
        try:
            pid = int(parts[0])
        except ValueError:
            continue
        ws = "?"
        if "--workspace " in parts[1]:
            ws = parts[1].split("--workspace ", 1)[1].split(" --")[0].strip()
        found[pid] = {"pid": pid, "workspace": ws, "source": "ps"}
    return found


def main():
    ap = argparse.ArgumentParser(description="List/reap leaked ruflo daemons (pid-reuse guarded).")
    ap.add_argument("--kill", action="store_true", help="SIGTERM confirmed-stale daemons")
    ap.add_argument("--ttl", type=int, default=43200, help="staleness age in seconds (default 43200 = 12h)")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    args = ap.parse_args()

    cf_home = os.path.expanduser("~/.claude-flow")
    daemons = registry_daemons(cf_home)
    for pid, d in ps_sweep().items():
        daemons.setdefault(pid, d)

    rows = []
    for pid, d in sorted(daemons.items()):
        confirmed = is_daemon_process(pid)
        if confirmed is False:
            continue  # registry entry whose PID now belongs to something else
        age = proc_age_seconds(pid)
        ws_gone = d["workspace"] not in ("?", "") and not os.path.isdir(d["workspace"])
        stale = ws_gone or (age is not None and age > args.ttl)
        rows.append({**d, "age_s": int(age) if age is not None else None,
                     "confirmed": bool(confirmed), "workspace_gone": ws_gone, "stale": stale})

    killed = []
    if args.kill:
        for r in rows:
            if not r["stale"]:
                continue
            if not r["confirmed"]:
                print(f"  refuse pid={r['pid']}: cmdline unconfirmable (pid reuse guard)", file=sys.stderr)
                continue
            if is_daemon_process(r["pid"]):  # re-probe immediately before signalling
                try:
                    os.kill(r["pid"], signal.SIGTERM)
                    killed.append(r["pid"])
                except OSError as e:
                    print(f"  pid={r['pid']}: kill failed ({e})", file=sys.stderr)

    if args.json:
        print(json.dumps({"daemons": rows, "killed": killed}, indent=2))
        return 0

    if not rows:
        print("✓ no ruflo/claude-flow daemons running")
        return 0
    for r in rows:
        mark = "STALE" if r["stale"] else "live "
        age = f"{r['age_s']}s" if r["age_s"] is not None else "?"
        gone = " (workspace gone)" if r["workspace_gone"] else ""
        print(f"  [{mark}] pid={r['pid']:>7} age={age:>9} src={r['source']:<22} {r['workspace']}{gone}")
    if killed:
        print(f"\nSIGTERM sent to {len(killed)} stale daemon(s): {killed}")
    elif any(r["stale"] for r in rows) and not args.kill:
        print("\nStale daemons found — re-run with --kill to reap them.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
