#!/usr/bin/env python3
"""Isaac Sim sidecar job runner (ADR-2149).

A stdlib-only HTTP control plane that runs inside the isaac-sim sidecar. It
stays dependency-free on purpose: it executes under the interpreter the NVIDIA
image already ships, independently of Isaac Lab's simulation dependencies.

State model (mirrors skills/blender/tools/blender-job.js):

  <root>/jobs/<id>/{job.json,job.log,pid,exit_code,cancelled,manifest.json,result/}

  queued    job.json present, no pid file
  running   pid file "<pid> <starttime>" whose starttime still matches /proc
  succeeded exit_code 0 AND every required output validated (manifest.json written)
  failed    exit_code != 0, or exit 0 with a required output missing/empty
  cancelled `cancelled` marker present
  lost      pid recorded but the process is gone and no exit_code was written
            (sidecar restart, OOM kill). Never resubmitted automatically.

A pid is trusted only while its /proc start time matches, so a recycled pid after
a restart is never reported as running and never signalled.

Environment:
  ISAAC_RUNNER_ROOT        job tree (default /exchange/isaac)
  ISAAC_RUNNER_BIND/PORT   listen address (default 0.0.0.0:9890; internal network only)
  ISAAC_PYTHON             interpreter for job scripts (default /isaac-sim/python.sh)
  ISAAC_MAX_CONCURRENT     simultaneous jobs (default 1)
  ISAAC_MIN_FREE_GIB       refuse submission below this free space (default 20)
  ISAAC_RUNNER_VERSIONS    JSON file with image/sim/lab revisions (default /etc/isaac-sim-versions.json)
"""
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.environ.get("ISAAC_RUNNER_ROOT", "/exchange/isaac")
PYTHON = os.environ.get("ISAAC_PYTHON", "/isaac-sim/python.sh")
MAX_CONCURRENT = int(os.environ.get("ISAAC_MAX_CONCURRENT", "1"))
MIN_FREE_GIB = float(os.environ.get("ISAAC_MIN_FREE_GIB", "20"))
BAKED_FIXTURES = os.environ.get("ISAAC_BAKED_FIXTURES", "/opt/isaac-sim-assets/fixtures")
# fixture script -> the health level(s) its verified success proves. No render fixture exists yet,
# so gpu_rendering can never become true; it is not inferred from anything else.
FIXTURE_PROVES = {"fall_box.py": ("smoke:fall", {"simulator_initialised", "physics_stepping"}),
                  "pendulum.py": ("smoke:articulation", {"simulator_initialised"})}
VERSIONS_FILE = os.environ.get("ISAAC_RUNNER_VERSIONS", "/etc/isaac-sim-versions.json")
JOB_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
MAX_LOG_LINES = 2000
MAX_LOG_BYTES = 4 << 20  # current file plus one rotation: at most 8 MiB per job
TERMINAL = {"succeeded", "failed", "cancelled", "lost"}

_lock = threading.RLock()
_children = {}  # id -> Popen, for jobs this process launched


# ── filesystem helpers ────────────────────────────────────────────────────────
def jobs_dir():
    return os.path.join(ROOT, "jobs")


def job_dir(jid):
    if not JOB_ID_RE.match(jid):
        raise ValueError("invalid job id")
    return os.path.join(jobs_dir(), jid)


def safe_read(path, limit=1 << 20):
    """Read a state file refusing symlinks (the share is untrusted)."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError:
        return None
    with os.fdopen(fd, "rb") as fh:
        return fh.read(limit).decode("utf-8", "replace")


def atomic_write(path, text):
    tmp = f"{path}.tmp.{os.getpid()}"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o644)
    with os.fdopen(fd, "w") as fh:
        fh.write(text)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def resolve_under(base, rel):
    """Resolve `rel` under `base`, refusing escapes and symlinks."""
    if os.path.isabs(rel) or ".." in rel.split("/"):
        raise ValueError(f"path escapes the share: {rel}")
    cur = os.path.realpath(base)
    full = os.path.join(cur, rel)
    probe = cur
    for part in rel.split("/"):
        probe = os.path.join(probe, part)
        if os.path.islink(probe):
            raise ValueError(f"symbolic link refused: {rel}")
    if not os.path.realpath(full).startswith(cur + os.sep) and os.path.realpath(full) != cur:
        raise ValueError(f"path escapes the share: {rel}")
    return full


def proc_starttime(pid):
    """Field 22 of /proc/<pid>/stat, or None if the process is gone."""
    try:
        with open(f"/proc/{pid}/stat") as fh:
            stat = fh.read()
        return stat[stat.rindex(")") + 2:].split()[19]
    except (OSError, ValueError, IndexError):
        return None


def free_gib(path):
    return shutil.disk_usage(path).free / (1 << 30)


# ── job state ─────────────────────────────────────────────────────────────────
def read_job(jid):
    raw = safe_read(os.path.join(job_dir(jid), "job.json"))
    return json.loads(raw) if raw else None


def job_state(jid):
    d = job_dir(jid)
    if safe_read(os.path.join(d, "cancelled")) is not None:
        return "cancelled", None
    code_raw = safe_read(os.path.join(d, "exit_code"))
    if code_raw is not None:
        code = int(code_raw.strip() or "1")
        if code != 0:
            return "failed", code
        return ("succeeded", 0) if safe_read(os.path.join(d, "manifest.json")) else ("failed", 0)
    pid_raw = safe_read(os.path.join(d, "pid"))
    if pid_raw is None:
        return "queued", None
    try:
        pid, start = pid_raw.split()
    except ValueError:
        return "lost", None
    if proc_starttime(int(pid)) == start:
        return "running", None
    return "lost", None


def describe(jid):
    job = read_job(jid)
    if job is None:
        return None
    state, code = job_state(jid)
    out = {k: job.get(k) for k in ("id", "name", "kind", "submitted_at", "idempotency_key")}
    out.update(state=state, exit_code=code, receipt=f"jobs/{jid}/job.json")
    if state in ("failed", "lost") and safe_read(os.path.join(job_dir(jid), "failure.txt")):
        out["failure"] = safe_read(os.path.join(job_dir(jid), "failure.txt")).strip()
    return out


def list_ids():
    try:
        names = [n for n in os.listdir(jobs_dir()) if JOB_ID_RE.match(n)]
    except OSError:
        return []

    def key(n):
        j = read_job(n)
        return (j or {}).get("submitted_at", 0)
    return sorted(names, key=key, reverse=True)


# ── submission ────────────────────────────────────────────────────────────────
def idempotency_key(spec, script_hash, input_hashes):
    basis = json.dumps(
        {"script": script_hash, "inputs": input_hashes, "args": spec.get("args", []),
         "seed": spec.get("seed"), "params": spec.get("params", {}), "gpu": spec.get("gpu")},
        sort_keys=True,
    )
    return hashlib.sha256(basis.encode()).hexdigest()[:32]


def gpu_inventory():
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=uuid,name,memory.total,memory.used,driver_version",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10, check=True).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    gpus = []
    for line in out.strip().splitlines():
        uuid_, name, total, used, drv = [p.strip() for p in line.split(",")]
        gpus.append({"uuid": uuid_, "name": name, "memory_total_mib": int(total),
                     "memory_used_mib": int(used), "driver": drv})
    return gpus


def submit(spec):
    """Create a job from a spec; returns (http_status, body)."""
    for req in ("script",):
        if not spec.get(req):
            return 400, {"error": f"missing field: {req}"}
    os.makedirs(jobs_dir(), exist_ok=True)
    if free_gib(ROOT) < max(MIN_FREE_GIB, float(spec.get("min_free_gib", 0))):
        return 507, {"error": "insufficient free storage",
                     "free_gib": round(free_gib(ROOT), 1), "required_gib": MIN_FREE_GIB}
    try:
        script = resolve_under(ROOT, spec["script"])
        script_hash = sha256_file(script)
        inputs = {rel: sha256_file(resolve_under(ROOT, rel)) for rel in spec.get("inputs", [])}
    except (ValueError, OSError) as exc:
        return 400, {"error": str(exc)}
    for rel in spec.get("required_outputs", []):
        if os.path.isabs(rel) or ".." in rel.split("/"):
            return 400, {"error": f"required output escapes the job: {rel}"}
    key = spec.get("idempotency_key") or idempotency_key(spec, script_hash, inputs)
    with _lock:
        for existing in list_ids():
            job = read_job(existing) or {}
            if job.get("idempotency_key") == key and not spec.get("rerun"):
                return 200, {"duplicate": True, **describe(existing)}
        jid = spec.get("id") or time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
        if not JOB_ID_RE.match(jid):
            return 400, {"error": "invalid job id"}
        d = job_dir(jid)
        if os.path.exists(d):
            return 409, {"error": "job id exists", "id": jid}
        os.makedirs(os.path.join(d, "result"))
        versions = json.loads(safe_read(VERSIONS_FILE) or "{}")
        job = {
            "id": jid, "name": spec.get("name", jid), "kind": spec.get("kind", "adhoc"),
            "submitted_at": time.time(), "idempotency_key": key,
            "script": spec["script"], "script_sha256": script_hash,
            "inputs": inputs, "args": spec.get("args", []), "params": spec.get("params", {}),
            "seed": spec.get("seed", 0), "gpu": spec.get("gpu") or os.environ.get("NVIDIA_VISIBLE_DEVICES"),
            "required_outputs": spec.get("required_outputs", []),
            "solver": spec.get("solver", {}), "versions": versions,
            "result_dir": f"jobs/{jid}/result",
        }
        atomic_write(os.path.join(d, "job.json"), json.dumps(job, indent=2))
    schedule()
    return 202, describe(jid)


def running_count():
    return sum(1 for i in list_ids() if job_state(i)[0] == "running")


def schedule():
    """Start queued jobs, oldest first, up to MAX_CONCURRENT."""
    with _lock:
        queued = [i for i in reversed(list_ids()) if job_state(i)[0] == "queued"]
        for jid in queued:
            if running_count() >= MAX_CONCURRENT:
                return
            launch(jid)


def launch(jid):
    d = job_dir(jid)
    job = read_job(jid)
    env = dict(os.environ)
    env.update(ISAAC_JOB_DIR=os.path.join(d, "result"), ISAAC_JOB_ID=jid,
               ISAAC_ROOT=ROOT, ISAAC_SEED=str(job["seed"]),
               ISAAC_PARAMS=json.dumps(job["params"]))
    script = resolve_under(ROOT, job["script"])
    log = os.open(os.path.join(d, "job.log"), os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o644)
    try:
        proc = subprocess.Popen([PYTHON, script, *job["args"]], cwd=d, env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                stdin=subprocess.DEVNULL, start_new_session=True)
    except OSError as exc:
        os.close(log)
        atomic_write(os.path.join(d, "failure.txt"), f"launch failed: {exc}")
        atomic_write(os.path.join(d, "exit_code"), "127")
        return
    reader = threading.Thread(target=capture_log, args=(jid, proc.stdout, log), daemon=True)
    reader.start()
    start = proc_starttime(proc.pid) or "0"
    atomic_write(os.path.join(d, "pid"), f"{proc.pid} {start}")
    _children[jid] = proc
    threading.Thread(target=reap, args=(jid, proc, reader), daemon=True).start()


def capture_log(jid, stream, fd):
    """Drain child output without allowing a verbose simulator to fill the volume."""
    path = os.path.join(job_dir(jid), "job.log")
    output = os.fdopen(fd, "ab", buffering=0)
    size = os.fstat(fd).st_size
    try:
        with stream:
            while True:
                chunk = stream.read1(min(65536, MAX_LOG_BYTES))
                if not chunk:
                    break
                if size + len(chunk) > MAX_LOG_BYTES:
                    output.close()
                    os.replace(path, path + ".1")
                    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o644)
                    output = os.fdopen(fd, "ab", buffering=0)
                    size = 0
                # FileIO may perform a partial write, so retain the unwritten suffix.
                remaining = memoryview(chunk)
                while remaining:
                    written = output.write(remaining)
                    remaining = remaining[written:]
                size += len(chunk)
    except OSError:
        # Closing the pipe makes a failed capture visible to a still-writing child.
        stream.close()
    finally:
        output.close()


def reap(jid, proc, reader):
    code = proc.wait()
    # Normally EOF drains immediately. A background descendant retaining stdout
    # must not prevent the foreground job from reaching a terminal state.
    reader.join(timeout=2)
    d = job_dir(jid)
    _children.pop(jid, None)
    try:
        if safe_read(os.path.join(d, "cancelled")) is None:
            finalise(jid, code)
        schedule()
    except OSError:
        pass  # the job directory was removed underneath us; nothing left to record


def finalise(jid, code):
    """Validate required outputs, then write the completion manifest (only on success)."""
    d = job_dir(jid)
    job = read_job(jid)
    result = os.path.join(d, "result")
    if code == 0:
        artefacts, missing = [], []
        for rel in job["required_outputs"]:
            p = os.path.join(result, rel)
            if not os.path.isfile(p) or os.path.islink(p) or os.path.getsize(p) == 0:
                missing.append(rel)
        if missing:
            atomic_write(os.path.join(d, "failure.txt"), f"required outputs missing or empty: {missing}")
        else:
            for dirpath, _, files in os.walk(result):
                for name in sorted(files):
                    p = os.path.join(dirpath, name)
                    if os.path.islink(p):
                        continue
                    artefacts.append({"name": os.path.relpath(p, result), "size": os.path.getsize(p),
                                      "sha256": sha256_file(p), "type": guess_type(name)})
            atomic_write(os.path.join(d, "manifest.json"), json.dumps({
                "id": jid, "completed_at": time.time(), "script_sha256": job["script_sha256"],
                "inputs": job["inputs"], "seed": job["seed"], "gpu": job["gpu"],
                "versions": job["versions"], "artefacts": artefacts}, indent=2))
    atomic_write(os.path.join(d, "exit_code"), str(code))


def guess_type(name):
    ext = os.path.splitext(name)[1].lower()
    return {".usd": "usd", ".usda": "usd", ".usdc": "usd", ".json": "json", ".jsonl": "jsonl",
            ".mp4": "video", ".png": "image", ".log": "log", ".npz": "numpy"}.get(ext, "binary")


# ── cancel / reconcile ────────────────────────────────────────────────────────
def cancel(jid):
    state, _ = job_state(jid)
    if state in TERMINAL:
        return 200, {"id": jid, "state": state, "note": "already terminal"}
    d = job_dir(jid)
    atomic_write(os.path.join(d, "cancelled"), str(time.time()))
    if state == "running":
        pid, start = safe_read(os.path.join(d, "pid")).split()
        pid = int(pid)
        if proc_starttime(pid) == start:
            # The job is its own session leader (start_new_session), so its pgid == its pid.
            # Signalling that group touches only this job's descendants.
            try:
                os.killpg(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            deadline = time.time() + 8
            while time.time() < deadline and proc_starttime(pid) == start:
                time.sleep(0.2)
            if proc_starttime(pid) == start:
                try:
                    os.killpg(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
    schedule()
    return 200, describe(jid)


def reconcile():
    """On start: running jobs whose process is gone become `lost`; queued jobs resume."""
    for jid in list_ids():
        state, _ = job_state(jid)
        if state == "lost":
            atomic_write(os.path.join(job_dir(jid), "failure.txt"),
                         "interrupted: process no longer exists (sidecar restart or kill); not resubmitted")
    schedule()


# ── capabilities / health ─────────────────────────────────────────────────────
def verified_fixtures():
    """Fixture runs that count as evidence, keyed by smoke kind (newest wins).

    A job counts only if it ran the exact baked fixture bytes (sha256 of the image copy, not the
    client's label or the writable shared copy), succeeded, and its own verification.json says
    pass: true. A client-chosen `kind` proves nothing.
    """
    out = {}
    for jid in reversed(list_ids()):
        job = read_job(jid) or {}
        base = os.path.basename(job.get("script", ""))
        if base not in FIXTURE_PROVES or not job.get("script", "").startswith("fixtures/fixtures/"):
            continue
        baked = os.path.join(BAKED_FIXTURES, base)
        if not os.path.isfile(baked) or sha256_file(baked) != job.get("script_sha256"):
            continue
        state, _ = job_state(jid)
        if state != "succeeded":
            continue
        try:
            report = json.loads(safe_read(os.path.join(job_dir(jid), "result", "verification.json")) or "{}")
        except json.JSONDecodeError:
            continue
        if report.get("pass") is True:
            out[FIXTURE_PROVES[base][0]] = {"job": jid, "at": job.get("submitted_at"), "script_sha256": job["script_sha256"]}
    return out


def submitted_kinds():
    """Client-labelled kinds and their last terminal state. Informational only; never feeds health."""
    seen = {}
    for jid in reversed(list_ids()):
        job = read_job(jid) or {}
        state, _ = job_state(jid)
        if state in TERMINAL and job.get("kind", "adhoc") != "adhoc":
            seen[job["kind"]] = {"job": jid, "state": state, "at": job.get("submitted_at")}
    return seen


def capabilities():
    versions = json.loads(safe_read(VERSIONS_FILE) or "{}")
    fixtures_dir = os.path.join(ROOT, "fixtures", "fixtures")
    verified = verified_fixtures()
    proven = set()
    for base, (kind, levels) in FIXTURE_PROVES.items():
        if kind in verified:
            proven |= levels
    return {
        "versions": versions,
        "gpus": gpu_inventory(),
        "assigned_gpu": os.environ.get("NVIDIA_VISIBLE_DEVICES"),
        "storage": {"root": ROOT, "free_gib": round(free_gib(ROOT), 1), "min_free_gib": MIN_FREE_GIB},
        "concurrency": {"max": MAX_CONCURRENT, "running": running_count()},
        "paths": {"root": ROOT, "client_hint": "agentbox mounts the same volume at /home/devuser/gui-tools/isaac; "
                                              "gui-tools-service at /home/devuser/exchange/isaac"},
        "installed": {"fixtures": sorted(os.listdir(fixtures_dir)) if os.path.isdir(fixtures_dir) else [],
                      "interpreter": os.path.exists(PYTHON)},
        "formats": {"scene": ["usd", "usda", "usdc", "urdf", "mjcf"], "motion": ["isaac-motion-export/1"]},
        "verified": verified,
        "submitted_kinds": submitted_kinds(),
        "health": {  # four levels; only 'control' is true without a verified baked-fixture run
            "control": True,
            "simulator_initialised": "simulator_initialised" in proven,
            "physics_stepping": "physics_stepping" in proven,
            "gpu_rendering": False,
        },
    }


# ── HTTP ──────────────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    server_version = "isaac-runner/1"

    def log_message(self, fmt, *args):  # quiet; the job log is the record
        pass

    def send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        # Refuse CORS "simple" requests: a page elsewhere on the network can send text/plain
        # without a preflight, so JSON must be declared.
        if (self.headers.get("content-type") or "").split(";")[0].strip().lower() != "application/json":
            raise ValueError("content-type must be application/json")
        n = int(self.headers.get("content-length") or 0)
        if n > (1 << 20):
            raise ValueError("body too large")
        return json.loads(self.rfile.read(n) or b"{}")

    def route(self, method):
        url = urlparse(self.path)
        parts = [p for p in url.path.split("/") if p]
        q = parse_qs(url.query)
        try:
            if parts == ["healthz"]:
                return self.send(200, {"ok": True})
            if parts == ["v1", "capabilities"] and method == "GET":
                return self.send(200, capabilities())
            if parts == ["v1", "jobs"]:
                if method == "GET":
                    return self.send(200, {"jobs": [describe(i) for i in list_ids()[:100]]})
                if method == "POST":
                    status, body = submit(self.body())
                    return self.send(status, body)
            if len(parts) >= 3 and parts[:2] == ["v1", "jobs"]:
                jid = parts[2]
                if read_job(jid) is None:
                    return self.send(404, {"error": "unknown job", "id": jid})
                if len(parts) == 3 and method == "GET":
                    return self.send(200, {**describe(jid), "job": read_job(jid)})
                if parts[3:] == ["log"] and method == "GET":
                    n = min(int(q.get("lines", ["60"])[0]), MAX_LOG_LINES)
                    lines = (safe_read(os.path.join(job_dir(jid), "job.log"), 4 << 20) or "").splitlines()
                    return self.send(200, {"id": jid, "lines": lines[-n:], "total_lines": len(lines)})
                if parts[3:] == ["artefacts"] and method == "GET":
                    raw = safe_read(os.path.join(job_dir(jid), "manifest.json"))
                    state, _ = job_state(jid)
                    if raw is None:
                        return self.send(200, {"id": jid, "state": state, "complete": False, "artefacts": []})
                    m = json.loads(raw)
                    return self.send(200, {"id": jid, "state": state, "complete": True,
                                           "result_dir": f"jobs/{jid}/result", "artefacts": m["artefacts"]})
                if parts[3:] == ["cancel"] and method == "POST":
                    status, body = cancel(jid)
                    return self.send(status, body)
            return self.send(404, {"error": "not found"})
        except (ValueError, json.JSONDecodeError) as exc:
            return self.send(400, {"error": str(exc)})
        except Exception as exc:  # never let a handler bug take the control plane down
            return self.send(500, {"error": f"{type(exc).__name__}: {exc}"})

    def do_GET(self):
        self.route("GET")

    def do_POST(self):
        self.route("POST")


def main():
    os.makedirs(jobs_dir(), exist_ok=True)
    reconcile()
    bind = os.environ.get("ISAAC_RUNNER_BIND", "0.0.0.0")
    port = int(os.environ.get("ISAAC_RUNNER_PORT", "9890"))
    srv = ThreadingHTTPServer((bind, port), Handler)
    print(f"isaac-runner listening on {bind}:{port} root={ROOT} python={PYTHON}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    sys.exit(main())
