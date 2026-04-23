#!/usr/bin/env python3
import json
import mimetypes
import os
import pathlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


ROOT = pathlib.Path(os.getenv("SOLID_POD_ROOT", "/var/lib/solid"))
PORT = int(os.getenv("SOLID_POD_PORT", "8484"))
REQUIRE_NIP98 = os.getenv("SOLID_REQUIRE_NIP98", "false").lower() == "true"


def safe_path(url_path: str) -> pathlib.Path:
    relative = url_path.lstrip("/")
    candidate = (ROOT / relative).resolve()
    if ROOT.resolve() not in candidate.parents and candidate != ROOT.resolve():
        raise ValueError("path escape")
    return candidate


class Handler(BaseHTTPRequestHandler):
    def _check_auth(self):
        if not REQUIRE_NIP98:
            return True
        header = self.headers.get("Authorization", "")
        return header.startswith("Nostr ")

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: pathlib.Path):
        body = path.read_bytes()
        content_type, _ = mimetypes.guess_type(str(path))
        self.send_response(200)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"status": "ok", "root": str(ROOT)})
            return

        if not self._check_auth():
            self._send_json(401, {"error": "nip98_required"})
            return

        try:
            path = safe_path(self.path)
        except ValueError:
            self._send_json(400, {"error": "invalid_path"})
            return

        if path.is_dir():
            items = sorted(p.name for p in path.iterdir())
            self._send_json(200, {"path": self.path, "items": items})
            return
        if not path.exists():
            self._send_json(404, {"error": "not_found"})
            return
        self._send_file(path)

    def do_HEAD(self):
        if self.path == "/health":
            self.send_response(200)
            self.end_headers()
            return
        self.send_response(404)
        self.end_headers()

    def do_PUT(self):
        if not self._check_auth():
            self._send_json(401, {"error": "nip98_required"})
            return

        try:
            path = safe_path(self.path)
        except ValueError:
            self._send_json(400, {"error": "invalid_path"})
            return

        path.parent.mkdir(parents=True, exist_ok=True)
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        path.write_bytes(body)
        self._send_json(201, {"status": "stored", "path": self.path, "bytes": len(body)})

    def log_message(self, fmt, *args):
        print(f"solid-pod-server: {fmt % args}")


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"solid-pod-server listening on 0.0.0.0:{PORT}, root={ROOT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
