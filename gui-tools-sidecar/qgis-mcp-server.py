#!/usr/bin/env python3
"""QGIS MCP endpoint — moved from agentbox-main (scripts/qgis_mcp_standalone.py) into
the GPU sidecar so QGIS rendering has a real GPU GL context. This remains the same
STUB it was in agentbox-main: it advertises the feature flag and is the seam where a
concrete QGIS MCP adapter (PyQGIS processing / rendering bridge) gets wired. QGIS
itself runs as a sibling supervised program with GPU GL via VirtualGL."""
import os
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BIND = os.environ.get("QGIS_MCP_BIND", "0.0.0.0")
PORT = int(os.environ.get("QGIS_MCP_PORT", "9877"))


class Handler(BaseHTTPRequestHandler):
    def _respond(self):
        body = json.dumps({
            "service": "qgis-mcp",
            "status": "stub",
            "location": "gui-tools-service",
            "message": "QGIS runs here with GPU GL; wire your concrete PyQGIS MCP adapter at this seam.",
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._respond()

    def do_POST(self):
        self._respond()

    def log_message(self, fmt, *args):
        print(f"qgis-mcp: {fmt % args}")


if __name__ == "__main__":
    print(f"qgis-mcp stub serving on {BIND}:{PORT}")
    ThreadingHTTPServer((BIND, PORT), Handler).serve_forever()
