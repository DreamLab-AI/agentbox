#!/usr/bin/env python3
"""HTTP service exposing the watermarks-remover cleaning pipeline.

Stdlib-only. The agent skill and any web app can call it over HTTP instead of
running the CLI scripts locally.

Endpoints:
    GET  /health         -> {"ok": true, "version": ...}
    GET  /capabilities   -> which optional tools / pixel backends are present
    GET  /openapi.json   -> dynamically generated OpenAPI 3.0.3 spec
    POST /inspect        -> {"file": <base64>, "name": "x.png"} -> findings JSON
    POST /clean          -> {"file": <base64>, "name": "x.png", "options": {...}}
                         -> {"cleaned": <base64>, "report": {...}}

Hardening mirrors the CLIs: input size caps, binary-as-text guard, atomic
writes, loopback-only bind by default, optional bearer API key. Run it as an
unprivileged user (the Docker image does). Intended for a trusted network;
expose through a reverse proxy if reachable from untrusted clients.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import json
import os
import sys
import tempfile
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    MAX_INPUT_BYTES,
    looks_binary,
    eprint,
    which,
)
from container_meta import clean_container, inspect_container  # noqa: E402
from format_dispatch import classify_bytes  # noqa: E402
from image_meta import clean_image, inspect_image  # noqa: E402
from text_unicode import clean_text, inspect_text  # noqa: E402

VERSION = os.environ.get("WATERMARKS_SERVER_VERSION", "dev")

# Optional bearer token: when set, every request must send
# `Authorization: Bearer <key>`. Empty means no auth (default).
API_KEY = os.environ.get("WATERMARKS_SERVER_API_KEY", "").strip()

# Body cap for the JSON envelope. Base64 inflates by 4/3, so the decoded file
# stays well under MAX_INPUT_BYTES for the same cap.
MAX_BODY_BYTES = MAX_INPUT_BYTES + (MAX_INPUT_BYTES >> 1)

ALLOWED_CLEAN_OPTIONS = {
    "nfkc": bool,
    "aggressive_homoglyphs": bool,
    "keep_non_ai_metadata": bool,
    "also_layer_a_text": bool,
    "remove_pixel": str,
    "strip_all_metadata": bool,
}


def _json_ok(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")


def capabilities() -> dict[str, Any]:
    return {
        "version": VERSION,
        "tools": {
            "c2patool": which("c2patool") is not None,
            "exiftool": which("exiftool") is not None,
            "qpdf": which("qpdf") is not None,
        },
        "pixel_backends": {
            "ctrlregen": bool(os.environ.get("NOAI_WATERMARK_DIR")),
            "diffusion": bool(os.environ.get("MARKDIFFUSION_DIR")),
        },
        "scorers": {
            "synthid": bool(os.environ.get("REVERSE_SYNTHID_DIR")),
        },
        "harnesses": {
            "markllm": bool(os.environ.get("MARKLLM_DIR")),
        },
    }


# OpenAPI generation. The spec is built from this single declarative table
# plus live runtime values (version, auth, allowed options), so it can never
# drift from the endpoints the handler actually serves. Served at /openapi.json.

def _schema(**props: Any) -> dict[str, Any]:
    return props


def _file_request(extra: dict[str, Any] | None = None) -> dict[str, Any]:
    schema: dict[str, Any] = {
        "type": "object",
        "required": ["file"],
        "properties": {
            "file": {
                "type": "string",
                "description": "Base64-encoded file bytes",
                "example": "SGVsbG8gd29ybGQ=",
            },
            "name": {
                "type": "string",
                "description": "Original filename (extension drives format routing)",
                "example": "notes.md",
            },
        },
    }
    if extra:
        schema["properties"].update(extra["properties"])
        schema["required"] = schema["required"] + extra.get("required", [])
    return schema


def _clean_request_schema() -> dict[str, Any]:
    options: dict[str, Any] = {}
    for key, kind in ALLOWED_CLEAN_OPTIONS.items():
        if kind is bool:
            options[key] = _schema(type="boolean")
        else:
            options[key] = _schema(type="string")
    return _file_request(
        {
            "properties": {"options": _schema(type="object", properties=options, additionalProperties=False)},
        }
    )


_OPENAPI_PATHS: dict[str, dict[str, Any]] = {
    "/health": {
        "get": {
            "summary": "Liveness and version",
            "responses": {
                "200": _schema(
                    type="object",
                    properties={"ok": _schema(type="boolean"), "version": _schema(type="string")},
                )
            },
        }
    },
    "/capabilities": {
        "get": {
            "summary": "Which optional tools and heavy backends are available",
            "responses": {
                "200": _schema(
                    type="object",
                    properties={
                        "ok": _schema(type="boolean"),
                        "version": _schema(type="string"),
                        "tools": _schema(
                            type="object",
                            properties={k: _schema(type="boolean") for k in ("c2patool", "exiftool", "qpdf")},
                        ),
                        "pixel_backends": _schema(
                            type="object",
                            properties={k: _schema(type="boolean") for k in ("ctrlregen", "diffusion")},
                        ),
                        "scorers": _schema(type="object", properties={"synthid": _schema(type="boolean")}),
                        "harnesses": _schema(type="object", properties={"markllm": _schema(type="boolean")}),
                    },
                )
            },
        }
    },
    "/openapi.json": {
        "get": {
            "summary": "This OpenAPI 3.0.3 document, generated dynamically",
            "responses": {
                "200": _schema(type="object", description="An OpenAPI 3.0.3 document"),
            },
        }
    },
    "/inspect": {
        "post": {
            "summary": "Inspect a file for AI provenance marks (text / image / container auto-routed)",
            "requestBody": _schema(
                required=True,
                content={"application/json": _schema(schema=_file_request())},
            ),
            "responses": {
                "200": _schema(
                    type="object",
                    properties={
                        "ok": _schema(type="boolean"),
                        "kind": _schema(type="string", enum=["text", "image", "container"]),
                        "suspicious": _schema(type="boolean"),
                        "report": _schema(type="object"),
                    },
                )
            },
        }
    },
    "/clean": {
        "post": {
            "summary": "Clean a file; returns the cleaned bytes and an actions/stats report",
            "requestBody": _schema(
                required=True,
                content={"application/json": _schema(schema=_clean_request_schema())},
            ),
            "responses": {
                "200": _schema(
                    type="object",
                    properties={
                        "ok": _schema(type="boolean"),
                        "kind": _schema(type="string", enum=["text", "image", "container"]),
                        "cleaned": _schema(type="string", description="Base64-encoded cleaned file bytes"),
                        "report": _schema(type="object"),
                    },
                )
            },
        }
    },
}

_ERROR_SCHEMA = _schema(
    type="object",
    properties={"ok": _schema(type="boolean", enum=[False]), "error": _schema(type="string")},
)
_COMMON_ERRORS = {
    "400": {"description": "Bad request", "content": {"application/json": {"schema": _ERROR_SCHEMA}}},
    "401": {"description": "Missing/invalid bearer token", "content": {"application/json": {"schema": _ERROR_SCHEMA}}},
    "404": {"description": "Not found", "content": {"application/json": {"schema": _ERROR_SCHEMA}}},
    "413": {"description": "Request body too large", "content": {"application/json": {"schema": _ERROR_SCHEMA}}},
    "500": {"description": "Internal error", "content": {"application/json": {"schema": _ERROR_SCHEMA}}},
}


def openapi_spec() -> dict[str, Any]:
    paths: dict[str, Any] = {}
    for path, ops in _OPENAPI_PATHS.items():
        for method, op in ops.items():
            responses = dict(_COMMON_ERRORS)
            for status, body in op["responses"].items():
                responses[status] = {
                    "description": "Success",
                    "content": {"application/json": {"schema": body}},
                }
            paths.setdefault(path, {})[method] = {
                "summary": op["summary"],
                "responses": responses,
                **(op.get("requestBody") and {"requestBody": op["requestBody"]} or {}),
            }

    spec: dict[str, Any] = {
        "openapi": "3.0.3",
        "info": {
            "title": "watermarks-remover service",
            "version": VERSION,
            "description": "Strip multi-vendor AI provenance marks (Unicode, C2PA/EXIF/XMP, containers). "
            "Files are passed base64-encoded in JSON; cleaned bytes come back base64-encoded.",
        },
        "paths": paths,
    }
    if API_KEY:
        spec["components"] = {
            "securitySchemes": {
                "bearerAuth": {"type": "http", "scheme": "bearer"},
            }
        }
        spec["security"] = [{"bearerAuth": []}]
    return spec


def _safe_name(name: str) -> str:
    """Reduce a client-supplied filename to a bare basename safe for temp use.

    CodeQL (uncontrolled data in path expression): a name like '../../x'
    would otherwise let the write below escape the request temp dir. Fold
    Windows separators too, and fall back to a neutral name for '.', '..' or
    empty results.
    """
    base = Path(name.replace("\\", "/")).name
    if base in ("", ".", ".."):
        return "input"
    return base


def _tmp_path(tmpdir: Path, *parts: str) -> Path:
    """Join *parts* under *tmpdir* and refuse anything that escapes it.

    Defense-in-depth for the CodeQL "uncontrolled data in path expression"
    findings: even if a caller slips a separator through, the write can never
    land outside the request temp dir.
    """
    path = tmpdir.joinpath(*parts)
    if path.parent != tmpdir:
        raise ValueError("unsafe filename")
    return path


def _decode_input(body: dict[str, Any]) -> tuple[bytes, str]:
    raw = body.get("file")
    if not isinstance(raw, str):
        raise ValueError("missing string field 'file' (base64-encoded bytes)")
    name = body.get("name")
    if name is not None and not isinstance(name, str):
        raise ValueError("'name' must be a string")
    try:
        data = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError):
        raise ValueError("'file' is not valid base64")
    return data, _safe_name(name or "")


class Handler(BaseHTTPRequestHandler):
    server_version = f"watermarks-remover/{VERSION}"

    def log_message(self, fmt: str, *args: object) -> None:
        eprint("%s - %s" % (self.address_string(), fmt % args))

    def _authorized(self) -> bool:
        if not API_KEY:
            return True
        header = self.headers.get("Authorization", "")
        return header == f"Bearer {API_KEY}"

    def _read_json(self) -> dict[str, Any] | None:
        raw = self.headers.get("Content-Length")
        if raw is None or not raw.isdigit():
            return None
        length = int(raw)
        if length > MAX_BODY_BYTES:
            return None
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError, OSError):
            return None
        if not isinstance(body, dict):
            return None
        return body

    def _respond(self, status: int, payload: dict[str, Any]) -> None:
        data = _json_ok(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802 (http.server API)
        path = urlparse(self.path).path
        if not self._authorized():
            self._respond(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "unauthorized"})
            return
        if path == "/health":
            self._respond(HTTPStatus.OK, {"ok": True, "version": VERSION})
        elif path == "/capabilities":
            self._respond(HTTPStatus.OK, {"ok": True, **capabilities()})
        elif path == "/openapi.json":
            self._respond(HTTPStatus.OK, openapi_spec())
        else:
            self._respond(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802 (http.server API)
        path = urlparse(self.path).path
        if not self._authorized():
            self._respond(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "unauthorized"})
            return
        if path not in ("/inspect", "/clean"):
            self._respond(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not found"})
            return
        body = self._read_json()
        if body is None:
            raw_len = self.headers.get("Content-Length")
            oversized = raw_len is not None and raw_len.isdigit() and int(raw_len) > MAX_BODY_BYTES
            self._respond(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE if oversized else HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": "invalid request body"},
            )
            return
        try:
            data, name = _decode_input(body)
        except ValueError as e:
            self._respond(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(e)})
            return
        try:
            if path == "/inspect":
                self._handle_inspect(data, name)
            else:
                self._handle_clean(data, name, body)
        except ValueError as e:
            self._respond(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(e)})
        except Exception as e:  # noqa: BLE001 — report, do not leak internals
            eprint(f"error handling {path}: {e!r}")
            self._respond(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": "internal error"})

    def _handle_inspect(self, data: bytes, name: str) -> None:
        kind = classify_bytes(data, Path(name).suffix)
        with tempfile.TemporaryDirectory(prefix="wm-inspect-") as tmp:
            path = _tmp_path(Path(tmp), name or "input")
            path.write_bytes(data)
            if kind == "text":
                if looks_binary(data):
                    raise ValueError("refusing to inspect bytes that look like a binary container as text")
                report = inspect_text(data.decode("utf-8", errors="surrogateescape")).to_dict()
            elif kind == "image":
                report = inspect_image(path).to_dict()
            else:
                report = inspect_container(path).to_dict()
        suspicious = bool(report.get("suspicious_total")) or bool(
            report.get("has_c2pa") or report.get("has_ai_metadata")
        )
        self._respond(HTTPStatus.OK, {"ok": True, "kind": kind, "report": report, "suspicious": suspicious})

    def _handle_clean(self, data: bytes, name: str, body: dict[str, Any]) -> None:
        kind = classify_bytes(data, Path(name).suffix)
        options = body.get("options")
        if options is None:
            options = {}
        if not isinstance(options, dict):
            raise ValueError("'options' must be an object")
        for key in options:
            if key not in ALLOWED_CLEAN_OPTIONS:
                raise ValueError(f"unknown option: {key}")

        with tempfile.TemporaryDirectory(prefix="wm-clean-") as tmp:
            tmpdir = Path(tmp)
            src = _tmp_path(tmpdir, name or "input")
            src.write_bytes(data)
            if kind == "text":
                if looks_binary(data):
                    raise ValueError("refusing to clean bytes that look like a binary container as text")
                text = data.decode("utf-8", errors="surrogateescape")
                cleaned, stats = clean_text(
                    text,
                    nfkc=bool(options.get("nfkc")),
                    aggressive_homoglyphs=bool(options.get("aggressive_homoglyphs")),
                )
                cleaned_bytes = cleaned.encode("utf-8", errors="surrogateescape")
                report: dict[str, Any] = {"kind": "text", "stats": stats, "length": len(cleaned)}
            elif kind == "image":
                dest = tmpdir / "out.png"
                strip_all = not bool(options.get("keep_non_ai_metadata"))
                if "strip_all_metadata" in options:
                    strip_all = bool(options["strip_all_metadata"])
                remove_pixel = options.get("remove_pixel")
                if remove_pixel not in (None, "ctrlregen", "diffusion"):
                    raise ValueError("remove_pixel must be one of: ctrlregen, diffusion")
                result = clean_image(
                    src,
                    dest,
                    strip_all_metadata=strip_all,
                    remove_pixel=remove_pixel,
                )
                cleaned_bytes = dest.read_bytes()
                report = {"kind": "image", **result}
            else:
                dest = _tmp_path(tmpdir, f"out{Path(name).suffix}")
                result = clean_container(src, dest, also_layer_a_text=bool(options.get("also_layer_a_text", True)))
                cleaned_bytes = dest.read_bytes()
                report = {"kind": "container", **result}
            report.pop("input", None)
            report.pop("output", None)
        self._respond(
            HTTPStatus.OK,
            {
                "ok": True,
                "kind": kind,
                "cleaned": base64.b64encode(cleaned_bytes).decode("ascii"),
                "report": report,
            },
        )


def main() -> int:
    global API_KEY  # noqa: PLW0603 — CLI overrides env
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--host", default=os.environ.get("WATERMARKS_SERVER_HOST", "127.0.0.1"))
    p.add_argument("--port", type=int, default=int(os.environ.get("WATERMARKS_SERVER_PORT", "8765")))
    p.add_argument("--api-key", default=API_KEY, help="require this bearer token (default: none)")
    p.add_argument("-V", "--version", action="store_true", help="print version and exit")
    args = p.parse_args()

    if args.version:
        print(VERSION)
        return 0

    API_KEY = args.api_key

    if args.host not in ("127.0.0.1", "localhost", "::1"):
        eprint(f"warning: binding {args.host} — intended for a trusted network only")
    if API_KEY:
        eprint("API key required for requests")
    else:
        eprint("warning: no API key set — only bind to loopback or a trusted network")

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    eprint(f"watermarks-remover service {VERSION} on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        eprint("shutting down")
        server.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
