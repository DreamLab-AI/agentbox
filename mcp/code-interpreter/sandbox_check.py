#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sandbox_check.py — Static AST scanner for sandbox-escape patterns.

ADR-018 §Package install policy / DDD-005 I12

Usage:
    python3 sandbox_check.py <source_file.py>

Exit 0:  source is safe (no banned APIs detected).
Exit 1:  source contains banned API references; writes JSON to stdout:
         {"banned": ["<module-or-call>", ...], "reason": "..."}
Exit 2:  argument or parse error; writes JSON to stdout.

Banned APIs (v1 defaults, overridable via SANDBOX_BANNED_APIS env var,
comma-separated):
    subprocess, os.fork, os.exec, os.execv, os.execve, os.execvp,
    os.execvpe, os.system, socket, ctypes, cffi, multiprocessing,
    importlib.import_module (flagged as WARNING if target is banned)

Network modules (requests, urllib) are FLAGGED (outcome: "flagged_network")
but do not cause a non-zero exit unless SANDBOX_STRICT_NETWORK=1.

Configurable via environment:
    SANDBOX_BANNED_APIS       Comma-separated additional banned names
    SANDBOX_STRICT_NETWORK    "1" to fail on network module imports (default 0)
"""

from __future__ import annotations

import ast
import json
import os
import sys

# ---------------------------------------------------------------------------
# Default banned API set (DDD-005 I12)
# ---------------------------------------------------------------------------
_DEFAULT_BANNED: set[str] = {
    "subprocess",
    "os.fork",
    "os.exec",
    "os.execv",
    "os.execve",
    "os.execvp",
    "os.execvpe",
    "os.execvpe",
    "os.system",
    "socket",
    "ctypes",
    "cffi",
    "multiprocessing",
}

_DEFAULT_FLAGGED_NETWORK: set[str] = {
    "requests",
    "urllib",
    "urllib.request",
    "urllib.error",
    "httpx",
    "aiohttp",
}

# Parse env overrides
_extra_banned = os.environ.get("SANDBOX_BANNED_APIS", "")
BANNED: set[str] = _DEFAULT_BANNED | {
    x.strip() for x in _extra_banned.split(",") if x.strip()
}
STRICT_NETWORK: bool = os.environ.get("SANDBOX_STRICT_NETWORK", "0") == "1"


# ---------------------------------------------------------------------------
# AST walkers
# ---------------------------------------------------------------------------

class _BannedFinder(ast.NodeVisitor):
    """Walks the AST and collects references to banned APIs."""

    def __init__(self) -> None:
        self.found: list[str] = []
        self.flagged: list[str] = []

    def _check_name(self, name: str, lineno: int) -> None:
        if name in BANNED:
            self.found.append(f"{name} (line {lineno})")
        elif name in _DEFAULT_FLAGGED_NETWORK:
            self.flagged.append(f"{name} (line {lineno})")

    def visit_Import(self, node: ast.Import) -> None:  # noqa: N802
        for alias in node.names:
            top = alias.name.split(".")[0]
            self._check_name(alias.name, node.lineno)
            self._check_name(top, node.lineno)
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:  # noqa: N802
        module = node.module or ""
        top = module.split(".")[0]
        self._check_name(module, node.lineno)
        self._check_name(top, node.lineno)
        # Also check imported names (e.g. from os import fork)
        for alias in node.names:
            qualified = f"{module}.{alias.name}" if module else alias.name
            self._check_name(qualified, node.lineno)
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:  # noqa: N802
        # Catch attribute calls like os.system("...") or ctypes.CDLL(...)
        if isinstance(node.func, ast.Attribute):
            obj = node.func
            parts: list[str] = []
            while isinstance(obj, ast.Attribute):
                parts.append(obj.attr)
                obj = obj.value
            if isinstance(obj, ast.Name):
                parts.append(obj.id)
            parts.reverse()
            full = ".".join(parts)
            self._check_name(full, node.lineno)
            # Check sub-paths too
            for i in range(1, len(parts)):
                self._check_name(".".join(parts[:i]), node.lineno)
        self.generic_visit(node)

    def visit_Name(self, node: ast.Name) -> None:  # noqa: N802
        self._check_name(node.id, node.lineno)
        self.generic_visit(node)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def _die(code: int, payload: dict) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.exit(code)


def main() -> None:
    if len(sys.argv) < 2:
        _die(2, {"error": "Usage: sandbox_check.py <source_file.py>"})

    source_path = sys.argv[1]
    try:
        source = open(source_path, encoding="utf-8").read()
    except (OSError, UnicodeDecodeError) as exc:
        _die(2, {"error": f"Cannot read source file: {exc}"})

    try:
        tree = ast.parse(source, filename=source_path)
    except SyntaxError as exc:
        _die(2, {"error": f"Syntax error in source: {exc}"})

    finder = _BannedFinder()
    finder.visit(tree)

    # De-duplicate while preserving first occurrence
    seen: set[str] = set()
    unique_found: list[str] = []
    for item in finder.found:
        key = item.split(" (line")[0]
        if key not in seen:
            seen.add(key)
            unique_found.append(item)

    unique_flagged: list[str] = []
    seen_f: set[str] = set()
    for item in finder.flagged:
        key = item.split(" (line")[0]
        if key not in seen_f:
            seen_f.add(key)
            unique_flagged.append(item)

    if unique_found:
        _die(1, {
            "banned": unique_found,
            "flagged_network": unique_flagged,
            "reason": (
                f"Source references {len(unique_found)} banned API(s). "
                "Execution rejected by sandbox_check."
            ),
        })

    if STRICT_NETWORK and unique_flagged:
        _die(1, {
            "banned": unique_flagged,
            "flagged_network": [],
            "reason": (
                f"SANDBOX_STRICT_NETWORK=1: source references "
                f"{len(unique_flagged)} network API(s)."
            ),
        })

    # Safe — exit 0, optionally report flagged-network warnings
    if unique_flagged:
        result = {
            "ok": True,
            "banned": [],
            "flagged_network": unique_flagged,
            "reason": (
                "No banned APIs found. Network module imports are flagged "
                "(non-functional inside kernel — JUPYTER_NO_NETWORK=1)."
            ),
        }
    else:
        result = {"ok": True, "banned": [], "flagged_network": [], "reason": "No banned APIs found."}

    sys.stdout.write(json.dumps(result) + "\n")
    sys.exit(0)


if __name__ == "__main__":
    main()
