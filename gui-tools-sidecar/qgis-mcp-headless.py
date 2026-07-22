#!/usr/bin/env python3
"""Standalone headless QGIS MCP server.

Initialises QgsApplication (offscreen Qt platform) and runs the nkarasiak
qgis_mcp_plugin `QgisMCPServer` on its own Qt event loop. This is the reliable path in
the GPU sidecar: the full QGIS *desktop* app hangs in GUI init headlessly (no window
manager on the Xvfb display, and `--code` only runs after the main window loads), so we
skip it. `iface` is None here, so canvas/render tools are unavailable; the layer,
feature, processing-algorithm and layout-export tools work.

Binds ${QGIS_MCP_BIND:-0.0.0.0}:${QGIS_MCP_PORT:-9877} so the agentbox qgis-mcp proxy can
reach it across the docker network. The agentbox skill client speaks 4-byte
length-prefixed JSON straight to this socket.
"""
import os
import signal
import sys

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

# QGIS's built-in python + plugins dirs (for `import processing`) and our installed
# qgis_mcp_plugin under the profile.
for _p in (
    "/usr/share/qgis/python",
    "/usr/share/qgis/python/plugins",
    os.path.expanduser("~/.local/share/QGIS/QGIS3/profiles/default/python/plugins"),
):
    if os.path.isdir(_p) and _p not in sys.path:
        sys.path.insert(0, _p)


def _log(msg):
    print(f"[qgis-mcp-headless] {msg}", flush=True)


def main():
    from qgis.core import QgsApplication

    QgsApplication.setPrefixPath(os.environ.get("QGIS_PREFIX_PATH", "/usr"), True)
    # GUI enabled so the QApplication event loop + QTimer work, but offscreen platform
    # means no real display is required.
    qgs = QgsApplication([], True)
    qgs.initQgis()
    _log("QGIS initialised")

    # Processing framework so run_processing / native algorithms are available.
    try:
        from processing.core.Processing import Processing
        Processing.initialize()
        _log("Processing framework initialised")
    except Exception as exc:  # noqa: BLE001
        _log(f"Processing init warning: {exc}")

    from qgis_mcp_plugin.plugin import QgisMCPServer

    host = os.environ.get("QGIS_MCP_BIND") or os.environ.get("QGIS_MCP_HOST") or "0.0.0.0"
    port = int(os.environ.get("QGIS_MCP_PORT", "9877"))
    srv = QgisMCPServer(host=host, port=port, iface=None)
    if not srv.start():
        _log("QgisMCPServer.start() returned False")
        return 1
    _log(f"serving on {host}:{port} (iface=None, headless)")

    def _shutdown(*_):
        try:
            srv.stop()
        except Exception:
            pass
        qgs.exitQgis()
        sys.exit(0)

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    # Qt6 (QGIS 4.x) renamed exec_() -> exec(); keep a Qt5 fallback.
    run_loop = getattr(qgs, "exec", None) or qgs.exec_
    return run_loop()


if __name__ == "__main__":
    sys.exit(main())
