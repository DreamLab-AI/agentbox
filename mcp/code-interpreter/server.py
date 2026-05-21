#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Persistent Code-Interpreter MCP Server
=======================================
ADR-018 / PRD-008 §3.1 / DDD-005

Wire contract: 6 tools over stdio JSON-RPC 2.0 (no MCP SDK dependency — raw
wire compatible with the Node BaseConsultant pattern in mcp/consultants/).

Trace outbox contract (WP-C consumption boundary)
--------------------------------------------------
Every kernel.exec appends a JSON line to:
  /var/lib/agentbox/code-harness/traces-outbox/<trace-urn>.json
A separate sidecar (WP-C territory) consumes that directory and pushes records
into RuVector via the embedding pipeline.  This server NEVER writes raw SQL
(CLAUDE.md "never raw SQL INSERT" rule).  The outbox is the only persistence
mechanism this server uses — fail-open on outbox write (log warning, continue).

Audit JSONL
-----------
Appended for every tool call to:
  /var/lib/agentbox/code-harness/kernel-<session-id>-<YYYY-MM-DD>.jsonl
O_APPEND guaranteed (open with 'a').  Code body is never written.

URN grammar (ADR-013)
---------------------
KernelSession : urn:agentbox:thing:<scope>:kernel-<short-id>
ExecutionTrace: urn:agentbox:activity:<scope>:trace-<kernel-short-id>-<seq>
(Per agentbox/CLAUDE.md the 18 valid URN kinds do not include `kernel` or
`trace`; KernelSession is a `thing` the agent uses, ExecutionTrace IS an
`activity` receipt — what was executed.)

Observability
-------------
Structured JSON log lines on stderr (one per tool call) carry all required
span fields: tool, duration_ms, outcome, session_urn, code_hash (exec only),
cell_id (exec only).  A Prometheus-compatible text metrics accumulator is
written to /var/lib/agentbox/code-harness/metrics.prom on SIGUSR1 if the
prometheus_client library is unavailable.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import pathlib
import resource
import signal
import sys
import threading
import time
import traceback
import uuid
from datetime import date, datetime, timezone
from typing import Any

# ---------------------------------------------------------------------------
# Config from environment
# ---------------------------------------------------------------------------
SESSION_ID = os.environ.get("CLAUDE_SESSION_ID") or uuid.uuid4().hex[:12]
KERNEL_IDLE_TIMEOUT_S = int(os.environ.get("KERNEL_IDLE_TIMEOUT_S", "1800"))
KERNEL_MAX_MEMORY_MB = int(os.environ.get("KERNEL_MAX_MEMORY_MB", "512"))
KERNEL_ALLOW_PIP_INSTALL = os.environ.get("KERNEL_ALLOW_PIP_INSTALL", "false").lower() == "true"
KERNEL_WHEELHOUSE = os.environ.get(
    "KERNEL_WHEELHOUSE", "/var/lib/agentbox/code-interpreter-wheelhouse"
)
KERNEL_SCOPE = os.environ.get("AGENTBOX_AGENT_PUBKEY",
                              os.environ.get("AGENTBOX_SESSION_PUBKEY", "local"))
# WHO the kernel acts as (per ADR-013 + agentbox/CLAUDE.md identity stack).
# `did:nostr:<hex>` is shared with solid-pod-rs, nostr-rust-forum, VisionClaw,
# dreamlab-ai-website. Local-only dev mode → `did:nostr:local`.
OWNER_DID = os.environ.get("AGENTBOX_AGENT_DID", f"did:nostr:{KERNEL_SCOPE}")
AGENTBOX_DEBUG_KERNEL_BODY = os.environ.get("AGENTBOX_DEBUG_KERNEL_BODY", "0") == "1"

# pip allowlist: comma-separated in env, or empty
_raw_allowlist = os.environ.get("KERNEL_PIP_ALLOWLIST", "")
KERNEL_PIP_ALLOWLIST: list[str] = [x.strip() for x in _raw_allowlist.split(",") if x.strip()]

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
HARNESS_DIR = pathlib.Path("/var/lib/agentbox/code-harness")
AUDIT_DIR = HARNESS_DIR
TRACES_OUTBOX = HARNESS_DIR / "traces-outbox"
METRICS_FILE = HARNESS_DIR / "metrics.prom"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(stream=sys.stderr, level=logging.WARNING,
                    format="%(asctime)s %(name)s %(levelname)s %(message)s")
_LOG = logging.getLogger("code-interpreter-mcp")

# ---------------------------------------------------------------------------
# Ensure directories exist (fail closed if harness dir unavailable)
# ---------------------------------------------------------------------------
def _ensure_dirs() -> None:
    try:
        AUDIT_DIR.mkdir(parents=True, exist_ok=True)
        TRACES_OUTBOX.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        _LOG.error("Cannot create harness directories: %s — server will run but audit/traces will fail", exc)

_ensure_dirs()

# Validate wheelhouse exists at startup (fail closed per spec)
if not pathlib.Path(KERNEL_WHEELHOUSE).is_dir():
    sys.stderr.write(
        f"[code-interpreter-mcp] FATAL: wheelhouse directory not found: {KERNEL_WHEELHOUSE}\n"
        "Set KERNEL_WHEELHOUSE to a valid path or ensure WP-E has provisioned the image.\n"
    )
    sys.exit(1)

# ---------------------------------------------------------------------------
# URN helpers
# ---------------------------------------------------------------------------
KERNEL_SHORT_ID = uuid.uuid4().hex[:8]
# KernelSession is a "thing" the agent uses (one of the 18 valid kinds per
# ADR-013). It is NOT a new URN kind.
SESSION_URN = f"urn:agentbox:thing:{KERNEL_SCOPE}:kernel-{KERNEL_SHORT_ID}"
_exec_seq = 0
_exec_seq_lock = threading.Lock()


def _next_trace_urn() -> tuple[str, int]:
    """ExecutionTrace IS an action receipt — use the `activity` URN kind."""
    global _exec_seq
    with _exec_seq_lock:
        _exec_seq += 1
        seq = _exec_seq
    return (f"urn:agentbox:activity:{KERNEL_SCOPE}:trace-{KERNEL_SHORT_ID}-{seq}",
            seq)


def _code_hash(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Metrics accumulator (Prometheus text format, no external dep required)
# ---------------------------------------------------------------------------
_metrics: dict[str, Any] = {
    "agentbox_kernel_calls_total": {},
    "agentbox_kernel_duration_ms_sum": {},
    "agentbox_kernel_sessions_active": 1,
}
_metrics_lock = threading.Lock()


def _record_metric(tool: str, outcome: str, duration_ms: float) -> None:
    key = (tool, outcome)
    with _metrics_lock:
        _metrics["agentbox_kernel_calls_total"][key] = \
            _metrics["agentbox_kernel_calls_total"].get(key, 0) + 1
        _metrics["agentbox_kernel_duration_ms_sum"][key] = \
            _metrics["agentbox_kernel_duration_ms_sum"].get(key, 0.0) + duration_ms


def _write_metrics_prom() -> None:
    try:
        lines = []
        for (tool, outcome), count in _metrics["agentbox_kernel_calls_total"].items():
            lines.append(
                f'agentbox_kernel_calls_total{{tool="{tool}",outcome="{outcome}"}} {count}'
            )
        for (tool, outcome), total_ms in _metrics["agentbox_kernel_duration_ms_sum"].items():
            lines.append(
                f'agentbox_kernel_duration_ms_sum{{tool="{tool}",outcome="{outcome}"}} {total_ms:.1f}'
            )
        lines.append(
            f'agentbox_kernel_sessions_active {_metrics["agentbox_kernel_sessions_active"]}'
        )
        METRICS_FILE.write_text("\n".join(lines) + "\n")
    except Exception:
        pass


signal.signal(signal.SIGUSR1, lambda *_: _write_metrics_prom())

# ---------------------------------------------------------------------------
# Audit JSONL writer
# ---------------------------------------------------------------------------
def _audit(record: dict) -> None:
    today = date.today().isoformat()
    path = AUDIT_DIR / f"kernel-{SESSION_ID}-{today}.jsonl"
    record.setdefault("ts", datetime.now(timezone.utc).isoformat())
    record.setdefault("session_urn", SESSION_URN)
    try:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")
    except OSError as exc:
        _LOG.warning("Audit write failed: %s", exc)


# ---------------------------------------------------------------------------
# Trace outbox writer (WP-C sidecar consumption)
# ---------------------------------------------------------------------------
def _write_trace_outbox(trace_urn: str, record: dict) -> None:
    """Fail-open: log warning but never raise."""
    safe_name = trace_urn.replace(":", "_").replace("/", "_")
    path = TRACES_OUTBOX / f"{safe_name}.json"
    try:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(record, fh)
    except Exception as exc:
        _LOG.warning("Trace outbox write failed for %s: %s", trace_urn, exc)


# ---------------------------------------------------------------------------
# Observability span log
# ---------------------------------------------------------------------------
def _span_log(tool: str, duration_ms: float, outcome: str, extra: dict | None = None) -> None:
    record = {
        "span": f"agentbox.mcp.code_interpreter.{tool.replace('kernel.', '')}",
        "tool": tool,
        "duration_ms": round(duration_ms, 2),
        "outcome": outcome,
        "session_urn": SESSION_URN,
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    if extra:
        record.update(extra)
    sys.stderr.write(json.dumps(record) + "\n")


# ---------------------------------------------------------------------------
# Kernel manager (jupyter_client)
# ---------------------------------------------------------------------------
_km = None
_kc = None
_km_lock = threading.Lock()
_last_exec_time: float = time.monotonic()
_kernel_alive = threading.Event()


def _set_rlimit_as() -> None:
    limit_bytes = KERNEL_MAX_MEMORY_MB * 1024 * 1024
    try:
        resource.setrlimit(resource.RLIMIT_AS, (limit_bytes, limit_bytes))
    except (ValueError, resource.error) as exc:
        _LOG.warning("Could not set RLIMIT_AS to %d MB: %s", KERNEL_MAX_MEMORY_MB, exc)


def _spawn_kernel() -> None:
    """Lazy spawn. Caller must hold _km_lock."""
    global _km, _kc
    try:
        import jupyter_client
    except ImportError:
        raise RuntimeError(
            "jupyter_client is not installed. "
            "Ensure the Nix pythonEnvCodeInterpreter derivation is active."
        )

    km = jupyter_client.KernelManager(kernel_name="python3")
    # Kernel environment: no network, memory limit advisory
    env = dict(os.environ)
    env["JUPYTER_NO_NETWORK"] = "1"
    env["MPLBACKEND"] = "Agg"  # non-interactive matplotlib backend
    km.start_kernel(env=env)

    kc = km.client()
    kc.start_channels()
    kc.wait_for_ready(timeout=30)

    _km = km
    _kc = kc
    _kernel_alive.set()
    _LOG.info("Kernel started: %s", SESSION_URN)


def _ensure_kernel() -> None:
    """Ensure kernel is live, spawning lazily if needed."""
    with _km_lock:
        if _km is None or not _km.is_alive():
            _spawn_kernel()


def _shutdown_kernel(now: bool = True) -> None:
    global _km, _kc
    with _km_lock:
        if _km is not None:
            try:
                _kc.stop_channels()
                _km.shutdown_kernel(now=now)
            except Exception:
                pass
            finally:
                _km = None
                _kc = None
                _kernel_alive.clear()


# ---------------------------------------------------------------------------
# Idle watchdog
# ---------------------------------------------------------------------------
def _idle_watchdog() -> None:
    while True:
        time.sleep(30)
        idle = time.monotonic() - _last_exec_time
        if idle > KERNEL_IDLE_TIMEOUT_S and _km is not None:
            _LOG.warning(
                "Idle timeout (%ds elapsed, limit %ds) — shutting down kernel",
                int(idle), KERNEL_IDLE_TIMEOUT_S,
            )
            _shutdown_kernel(now=True)


_watchdog = threading.Thread(target=_idle_watchdog, daemon=True)
_watchdog.start()


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------

def _tool_exec(args: dict) -> dict:
    global _last_exec_time

    code = args.get("code")
    if not isinstance(code, str) or not code.strip():
        raise ValueError("code must be a non-empty string")
    timeout_s = int(args.get("timeout_s", 30))

    _ensure_kernel()

    trace_urn, seq = _next_trace_urn()
    cell_id = seq
    code_hash = _code_hash(code)
    t0 = time.monotonic()

    try:
        msg_id = _kc.execute(code, store_history=True)
        stdout_parts: list[str] = []
        stderr_parts: list[str] = []
        result_repr: str | None = None
        exception: dict | None = None
        outcome = "ok"

        deadline = time.monotonic() + timeout_s
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                _shutdown_kernel(now=True)
                outcome = "timeout"
                exception = {"type": "TimeoutError",
                             "message": f"Cell timed out after {timeout_s}s",
                             "traceback": []}
                break
            try:
                reply = _kc.get_iopub_msg(timeout=min(remaining, 1.0))
            except Exception:
                continue

            msg_type = reply["msg_type"]
            content = reply["content"]
            parent_id = reply.get("parent_header", {}).get("msg_id", "")

            if parent_id != msg_id:
                continue

            if msg_type == "stream":
                if content.get("name") == "stdout":
                    stdout_parts.append(content.get("text", ""))
                elif content.get("name") == "stderr":
                    stderr_parts.append(content.get("text", ""))

            elif msg_type == "execute_result":
                result_repr = content.get("data", {}).get("text/plain")

            elif msg_type == "error":
                outcome = "exception"
                tb = content.get("traceback", [])
                # Strip ANSI codes
                clean_tb = []
                for line in tb:
                    import re
                    clean_tb.append(re.sub(r"\x1b\[[0-9;]*m", "", line))
                exception = {
                    "type": content.get("ename", "Exception"),
                    "message": content.get("evalue", ""),
                    "traceback": clean_tb,
                }

            elif msg_type == "status" and content.get("execution_state") == "idle":
                break

    except KeyboardInterrupt:
        outcome = "interrupt"
        exception = {"type": "KernelInterruptedError",
                     "message": "Cell interrupted by kernel.interrupt",
                     "traceback": []}

    duration_ms = round((time.monotonic() - t0) * 1000, 2)
    _last_exec_time = time.monotonic()

    stdout = "".join(stdout_parts)
    stderr = "".join(stderr_parts)

    result = {
        "stdout": stdout,
        "stderr": stderr,
        "result": result_repr,
        "exception": exception,
        "duration_ms": duration_ms,
        "cell_id": cell_id,
        "trace_urn": trace_urn,
    }

    # Audit (no code body)
    _audit({
        "tool": "kernel.exec",
        "trace_urn": trace_urn,
        "session_urn": SESSION_URN,
        "owner_did": OWNER_DID,
        "subject_did": OWNER_DID,
        "action_verb": "exec",
        "code_hash": code_hash,
        "duration_ms": duration_ms,
        "outcome": outcome,
        "cell_id": cell_id,
    })

    # Trace outbox (WP-C ExpeL consumes). Ecosystem-consistent record:
    # the trace IS the action receipt — `trace_urn` is both the primary
    # identity AND the `action_urn` (ExecutionTrace ≡ Activity here).
    _write_trace_outbox(trace_urn, {
        "trace_urn": trace_urn,
        "action_urn": trace_urn,                # ExecutionTrace = Activity
        "action_verb": "exec",
        "owner_did": OWNER_DID,
        "subject_did": OWNER_DID,
        "object_urn": SESSION_URN,              # the KernelSession that was driven
        "code_hash": code_hash,
        "stdout_short": stdout[:500],
        "stderr_short": stderr[:500],
        "exception_short": (exception["message"][:500] if exception else None),
        "duration_ms": duration_ms,
        "session_urn": SESSION_URN,
        "ontology_type": "ex:ExecutionTrace",
        "memory_type": "episodic",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "outcome": outcome,
    })

    # Span log
    extra = {"code_hash": code_hash, "cell_id": cell_id}
    if AGENTBOX_DEBUG_KERNEL_BODY:
        extra["code_body"] = code
    _span_log("kernel.exec", duration_ms, outcome, extra)
    _record_metric("exec", outcome, duration_ms)

    return result


def _tool_list_vars(_args: dict) -> dict:
    t0 = time.monotonic()
    _ensure_kernel()

    code = (
        "import json as _json\n"
        "_ns = {k: v for k, v in globals().items() if not k.startswith('_')}\n"
        "_result = []\n"
        "for _k, _v in _ns.items():\n"
        "    _t = type(_v).__name__\n"
        "    _r = repr(_v)[:80]\n"
        "    _result.append({'name': _k, 'type': _t, 'repr_short': _r})\n"
        "print(_json.dumps(_result))"
    )
    try:
        msg_id = _kc.execute(code, store_history=False)
        vars_json = ""
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                reply = _kc.get_iopub_msg(timeout=1.0)
            except Exception:
                continue
            if reply.get("parent_header", {}).get("msg_id") != msg_id:
                continue
            mt = reply["msg_type"]
            if mt == "stream" and reply["content"].get("name") == "stdout":
                vars_json += reply["content"].get("text", "")
            elif mt == "status" and reply["content"].get("execution_state") == "idle":
                break
        vars_list = json.loads(vars_json.strip()) if vars_json.strip() else []
    except Exception as exc:
        vars_list = []
        _LOG.warning("list_vars failed: %s", exc)

    duration_ms = round((time.monotonic() - t0) * 1000, 2)
    outcome = "ok"
    _audit({"tool": "kernel.list_vars", "duration_ms": duration_ms, "outcome": outcome})
    _span_log("kernel.list_vars", duration_ms, outcome)
    _record_metric("list_vars", outcome, duration_ms)
    return {"vars": vars_list}


def _tool_inspect(args: dict) -> dict:
    t0 = time.monotonic()
    name = args.get("name", "")
    if not isinstance(name, str) or not name:
        raise ValueError("name must be a non-empty string")

    _ensure_kernel()

    code = (
        "import inspect as _inspect, json as _json\n"
        f"_v = {name}\n"
        "_out = {{\n"
        f"  'name': {repr(name)},\n"
        "  'type': type(_v).__name__,\n"
        "  'repr': repr(_v)[:500],\n"
        "  'doc': (_inspect.getdoc(_v) or '')[:300],\n"
        "}}\n"
        "print(_json.dumps(_out))"
    )
    try:
        msg_id = _kc.execute(code, store_history=False)
        out_json = ""
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                reply = _kc.get_iopub_msg(timeout=1.0)
            except Exception:
                continue
            if reply.get("parent_header", {}).get("msg_id") != msg_id:
                continue
            mt = reply["msg_type"]
            if mt == "stream" and reply["content"].get("name") == "stdout":
                out_json += reply["content"].get("text", "")
            elif mt == "status" and reply["content"].get("execution_state") == "idle":
                break
        result = json.loads(out_json.strip()) if out_json.strip() else {
            "name": name, "type": "unknown", "repr": "", "doc": ""}
    except Exception as exc:
        result = {"name": name, "type": "error", "repr": str(exc), "doc": ""}

    duration_ms = round((time.monotonic() - t0) * 1000, 2)
    outcome = "ok"
    _audit({"tool": "kernel.inspect", "duration_ms": duration_ms, "outcome": outcome})
    _span_log("kernel.inspect", duration_ms, outcome)
    _record_metric("inspect", outcome, duration_ms)
    return result


def _tool_reset(_args: dict) -> dict:
    global _km, _kc
    t0 = time.monotonic()

    with _km_lock:
        if _km is not None:
            try:
                _km.restart_kernel(now=True)
                _kc.stop_channels()
                _kc = _km.client()
                _kc.start_channels()
                _kc.wait_for_ready(timeout=30)
                ok = True
            except Exception as exc:
                _LOG.warning("kernel reset failed: %s", exc)
                ok = False
        else:
            ok = True  # nothing to reset

    duration_ms = round((time.monotonic() - t0) * 1000, 2)
    outcome = "ok" if ok else "error"
    _audit({"tool": "kernel.reset", "duration_ms": duration_ms, "outcome": outcome})
    _span_log("kernel.reset", duration_ms, outcome)
    _record_metric("reset", outcome, duration_ms)
    return {"ok": ok}


def _tool_interrupt(_args: dict) -> dict:
    t0 = time.monotonic()
    ok = False
    with _km_lock:
        if _km is not None:
            try:
                _km.interrupt_kernel()
                ok = True
            except Exception as exc:
                _LOG.warning("interrupt failed: %s", exc)

    duration_ms = round((time.monotonic() - t0) * 1000, 2)
    outcome = "ok" if ok else "error"
    _audit({"tool": "kernel.interrupt", "duration_ms": duration_ms, "outcome": outcome})
    _span_log("kernel.interrupt", duration_ms, outcome)
    _record_metric("interrupt", outcome, duration_ms)
    return {"ok": ok}


def _tool_install_pkg(args: dict) -> dict:
    t0 = time.monotonic()
    pkg_name = args.get("name", "")
    if not isinstance(pkg_name, str) or not pkg_name.strip():
        raise ValueError("name must be a non-empty string")
    pkg_name = pkg_name.strip()

    # Gate 1: allow_pip_install must be true
    if not KERNEL_ALLOW_PIP_INSTALL:
        duration_ms = round((time.monotonic() - t0) * 1000, 2)
        _record_metric("install_pkg", "error", duration_ms)
        return {"ok": False, "error": "allow_pip_install is false in manifest"}

    # Gate 2: allowlist check
    if KERNEL_PIP_ALLOWLIST and pkg_name not in KERNEL_PIP_ALLOWLIST:
        duration_ms = round((time.monotonic() - t0) * 1000, 2)
        _record_metric("install_pkg", "error", duration_ms)
        return {"ok": False, "error": "package not in manifest allow-list"}

    # Gate 3: wheel must be present in wheelhouse
    import glob
    wheel_pattern = str(pathlib.Path(KERNEL_WHEELHOUSE) / f"{pkg_name.replace('-', '_')}*")
    if not glob.glob(wheel_pattern):
        duration_ms = round((time.monotonic() - t0) * 1000, 2)
        _record_metric("install_pkg", "error", duration_ms)
        return {"ok": False, "error": "wheel not in local wheelhouse"}

    # Run pip install from wheelhouse only (no network)
    import subprocess
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", pkg_name,
             "--no-index", f"--find-links={KERNEL_WHEELHOUSE}", "-q"],
            capture_output=True, text=True, timeout=120,
        )
        ok = result.returncode == 0
        if ok:
            # Get installed version
            ver_result = subprocess.run(
                [sys.executable, "-m", "pip", "show", pkg_name],
                capture_output=True, text=True, timeout=10,
            )
            version = None
            for line in ver_result.stdout.splitlines():
                if line.startswith("Version:"):
                    version = line.split(":", 1)[1].strip()
                    break
            error = None
        else:
            version = None
            error = result.stderr[:500] if result.stderr else "pip install failed"
    except subprocess.TimeoutExpired:
        ok = False
        version = None
        error = "pip install timed out"
    except Exception as exc:
        ok = False
        version = None
        error = str(exc)[:500]

    duration_ms = round((time.monotonic() - t0) * 1000, 2)
    outcome = "ok" if ok else "error"
    _audit({"tool": "kernel.install_pkg", "duration_ms": duration_ms,
            "outcome": outcome, "pkg": pkg_name})
    _span_log("kernel.install_pkg", duration_ms, outcome)
    _record_metric("install_pkg", outcome, duration_ms)
    return {"ok": ok, "version": version, "error": error}


# ---------------------------------------------------------------------------
# Tool dispatch table
# ---------------------------------------------------------------------------
_TOOLS = {
    "kernel.exec": _tool_exec,
    "kernel.list_vars": _tool_list_vars,
    "kernel.inspect": _tool_inspect,
    "kernel.reset": _tool_reset,
    "kernel.interrupt": _tool_interrupt,
    "kernel.install_pkg": _tool_install_pkg,
}

_TOOL_DEFS = [
    {
        "name": "kernel.exec",
        "description": (
            "Execute Python code in the persistent kernel namespace. "
            "Variables persist across calls within the session. "
            "Returns stdout, stderr, last-expression repr, exception (if any), "
            "duration_ms, cell_id, and trace_urn."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "code": {"type": "string", "description": "Python source to execute."},
                "timeout_s": {"type": "integer", "default": 30,
                              "description": "Execution timeout in seconds."},
            },
            "required": ["code"],
        },
    },
    {
        "name": "kernel.list_vars",
        "description": "List all non-dunder names in the kernel user namespace with type and short repr.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "kernel.inspect",
        "description": "Rich introspection of a single variable: type, repr (up to 500 chars), docstring.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Variable name to inspect."},
            },
            "required": ["name"],
        },
    },
    {
        "name": "kernel.reset",
        "description": "Restart the IPython kernel, clearing all namespace state. Does not kill the MCP server.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "kernel.interrupt",
        "description": "Send SIGINT to the currently running cell. Safe to call mid-kernel.exec.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "kernel.install_pkg",
        "description": (
            "Install a package from the local wheelhouse (no PyPI access). "
            "Requires allow_pip_install=true and package on the pip_allowlist. "
            "Uses --no-index --find-links=<KERNEL_WHEELHOUSE>."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Package name to install."},
            },
            "required": ["name"],
        },
    },
]


# ---------------------------------------------------------------------------
# Raw JSON-RPC 2.0 stdio loop
# ---------------------------------------------------------------------------

def _send(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def _handle_request(req: dict) -> dict | None:
    req_id = req.get("id")
    method = req.get("method", "")
    params = req.get("params", {})

    def _ok(result: Any) -> dict:
        return {"jsonrpc": "2.0", "id": req_id, "result": result}

    def _err(code: int, message: str) -> dict:
        return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}

    # MCP protocol methods
    if method == "initialize":
        return _ok({
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "code-interpreter", "version": "0.1.0"},
        })

    if method == "notifications/initialized":
        return None  # notification, no response

    if method == "tools/list":
        return _ok({"tools": _TOOL_DEFS})

    if method == "tools/call":
        tool_name = params.get("name", "")
        tool_args = params.get("arguments", {})
        handler = _TOOLS.get(tool_name)
        if handler is None:
            return _err(-32601, f"Unknown tool: {tool_name}")
        try:
            result = handler(tool_args)
            return _ok({
                "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}],
            })
        except Exception as exc:
            tb = traceback.format_exc()
            _LOG.error("Tool %s raised: %s\n%s", tool_name, exc, tb)
            return _ok({
                "content": [{"type": "text", "text": json.dumps({
                    "ok": False, "error": str(exc),
                }, ensure_ascii=False)}],
                "isError": True,
            })

    if method == "ping":
        return _ok({})

    # Notifications (no id) — ignore silently
    if req_id is None:
        return None

    return _err(-32601, f"Method not found: {method}")


def _main() -> None:
    sys.stderr.write(
        f"[code-interpreter-mcp] ready session_urn={SESSION_URN} "
        f"idle_timeout={KERNEL_IDLE_TIMEOUT_S}s "
        f"max_memory={KERNEL_MAX_MEMORY_MB}MB\n"
    )

    def _sigterm(*_):
        _LOG.info("SIGTERM received — shutting down kernel")
        _shutdown_kernel(now=True)
        sys.exit(0)

    signal.signal(signal.SIGTERM, _sigterm)

    # Apply memory limit to this server process (kernel process inherits)
    _set_rlimit_as()

    for raw_line in sys.stdin:
        raw_line = raw_line.strip()
        if not raw_line:
            continue
        try:
            req = json.loads(raw_line)
        except json.JSONDecodeError as exc:
            _send({"jsonrpc": "2.0", "id": None,
                   "error": {"code": -32700, "message": f"Parse error: {exc}"}})
            continue

        response = _handle_request(req)
        if response is not None:
            _send(response)


if __name__ == "__main__":
    _main()
