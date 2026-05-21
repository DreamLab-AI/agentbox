#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
mcp_call.py — Minimal stdio JSON-RPC 2.0 client for code-interpreter MCP.

Usage (from test scripts):
    from lib.mcp_call import MCPClient

    with MCPClient(["python3", "-u", "/opt/agentbox/mcp/code-interpreter/server.py"]) as client:
        result = client.call("kernel.exec", {"code": "x = 1"})
        print(result)

Environment:
    MCP_SERVER_CMD   Override the server command (space-split string).
                     Default: python3 -u /opt/agentbox/mcp/code-interpreter/server.py
"""

from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
import time
from typing import Any

_DEFAULT_CMD = os.environ.get(
    "MCP_SERVER_CMD",
    "python3 -u /opt/agentbox/mcp/code-interpreter/server.py",
)


class MCPClient:
    """Subprocess stdio JSON-RPC 2.0 client for one MCP server process."""

    def __init__(self, cmd: list[str] | None = None) -> None:
        self._cmd = cmd or shlex.split(_DEFAULT_CMD)
        self._proc: subprocess.Popen | None = None
        self._req_id = 0
        self._env = dict(os.environ)
        # Ensure wheelhouse exists for tests (may be a temp dir)
        if "KERNEL_WHEELHOUSE" not in self._env:
            self._env["KERNEL_WHEELHOUSE"] = "/var/lib/agentbox/code-interpreter-wheelhouse"

    def __enter__(self) -> "MCPClient":
        self.start()
        return self

    def __exit__(self, *_: Any) -> None:
        self.stop()

    def start(self) -> None:
        self._proc = subprocess.Popen(
            self._cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=self._env,
            bufsize=1,
        )
        # Send initialize handshake
        resp = self._rpc("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "mcp_call_test", "version": "0.1.0"},
        })
        if "error" in resp:
            raise RuntimeError(f"MCP initialize failed: {resp['error']}")
        # Send initialized notification
        self._send_notification("notifications/initialized", {})
        time.sleep(0.1)  # brief pause for server readiness

    def stop(self) -> None:
        if self._proc is not None:
            try:
                self._proc.terminate()
                self._proc.wait(timeout=5)
            except Exception:
                try:
                    self._proc.kill()
                except Exception:
                    pass
            self._proc = None

    def _next_id(self) -> int:
        self._req_id += 1
        return self._req_id

    def _send(self, obj: dict) -> None:
        assert self._proc and self._proc.stdin
        line = json.dumps(obj) + "\n"
        self._proc.stdin.write(line)
        self._proc.stdin.flush()

    def _recv(self, timeout: float = 60.0) -> dict:
        assert self._proc and self._proc.stdout
        self._proc.stdout.readline  # type: ignore
        import select
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            rlist, _, _ = select.select([self._proc.stdout], [], [], 1.0)
            if rlist:
                raw = self._proc.stdout.readline()
                if raw:
                    return json.loads(raw)
        raise TimeoutError(f"No response within {timeout}s")

    def _rpc(self, method: str, params: dict, timeout: float = 60.0) -> dict:
        req_id = self._next_id()
        self._send({"jsonrpc": "2.0", "id": req_id, "method": method, "params": params})
        while True:
            resp = self._recv(timeout=timeout)
            if resp.get("id") == req_id:
                return resp

    def _send_notification(self, method: str, params: dict) -> None:
        self._send({"jsonrpc": "2.0", "method": method, "params": params})

    def call(self, tool: str, arguments: dict | None = None,
             timeout: float = 60.0) -> dict:
        """Call a tool and return the parsed JSON content of the first content item."""
        resp = self._rpc("tools/call", {"name": tool, "arguments": arguments or {}},
                         timeout=timeout)
        if "error" in resp:
            raise RuntimeError(f"RPC error calling {tool}: {resp['error']}")
        result = resp.get("result", {})
        content = result.get("content", [])
        if content and content[0].get("type") == "text":
            return json.loads(content[0]["text"])
        return result

    def list_tools(self) -> list[dict]:
        resp = self._rpc("tools/list", {})
        return resp.get("result", {}).get("tools", [])
