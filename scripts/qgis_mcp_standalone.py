#!/usr/bin/env python3
"""QGIS MCP bridge (agentbox-main side).

DECONFLATED 2026-07-14: QGIS itself moved to the GPU sidecar (gui-tools-service),
because nix-built QGIS in agentbox-main cannot reach the nvidia driver libraries
injected into /usr/lib (nix RPATHs exclude it) and has no GPU GL context. This
program used to be a local stub; it is now a thin TCP proxy that bridges the local
QGIS MCP port to the sidecar, mirroring skills/blender/tools/blender-mcp-proxy.js.

Env:
  GUI_CONTAINER_HOST   upstream QGIS host   (default: gui-tools-service)
  QGIS_UPSTREAM_PORT   upstream QGIS port   (default: 9877)
  QGIS_LOCAL_PORT      local listen port    (default: 9877)
"""
import os
import socket
import threading
import time

UPSTREAM_HOST = os.environ.get("GUI_CONTAINER_HOST", "gui-tools-service")
UPSTREAM_PORT = int(os.environ.get("QGIS_UPSTREAM_PORT", "9877"))
LOCAL_PORT = int(os.environ.get("QGIS_LOCAL_PORT", "9877"))

_last_warn = 0.0


def _warn(reason):
    global _last_warn
    now = time.time()
    if now - _last_warn < 15:
        return
    _last_warn = now
    print(f"qgis-mcp-proxy: upstream {UPSTREAM_HOST}:{UPSTREAM_PORT} unreachable ({reason}). "
          f"The gui-tools GPU sidecar is not running; start it (agentbox.sh gui-tools up).",
          flush=True)


def _pipe(src, dst):
    try:
        while True:
            data = src.recv(65536)
            if not data:
                break
            dst.sendall(data)
    except OSError:
        pass
    finally:
        for s in (src, dst):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


def _handle(client):
    try:
        upstream = socket.create_connection((UPSTREAM_HOST, UPSTREAM_PORT), timeout=8)
    except OSError as e:
        _warn(e.strerror or str(e))
        client.close()
        return
    threading.Thread(target=_pipe, args=(client, upstream), daemon=True).start()
    threading.Thread(target=_pipe, args=(upstream, client), daemon=True).start()


def main():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("0.0.0.0", LOCAL_PORT))
    srv.listen(16)
    print(f"qgis-mcp-proxy: 0.0.0.0:{LOCAL_PORT} -> {UPSTREAM_HOST}:{UPSTREAM_PORT}", flush=True)
    while True:
        client, _ = srv.accept()
        _handle(client)


if __name__ == "__main__":
    main()
