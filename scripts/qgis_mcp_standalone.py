#!/usr/bin/env python3
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        payload = {
            "status": "placeholder",
            "message": "QGIS feature flag enabled; wire your concrete MCP adapter here.",
        }
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(f"qgis-mcp: {fmt % args}")


ThreadingHTTPServer(("0.0.0.0", 9877), Handler).serve_forever()
