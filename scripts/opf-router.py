#!/usr/bin/env python3
"""
opf-router.py — OpenAI Privacy Filter sidecar.

Loopback HTTP service in front of openai/privacy-filter. Exposes:

    POST /classify   { text, entities? }             → { spans: [...] }
    POST /redact     { text, entities?, mask? }      → { text, replaced: [...] }
    GET  /health                                     → { status, model, device }
    GET  /metrics                                    → Prometheus text

Environment:

    OPF_PORT     default 9092
    OPF_MODE     "local-gpu" | "local-cpu" (if absent or "off" → /health reports disabled)
    OPF_DTYPE    "bf16" (default) | "f32" | "q4"
    OPF_MODEL    HF model id, default "openai/privacy-filter"

Contract: ADR-008. The router is middleware for the five adapter slots plus
the inbound/outbound prompt path. Failure semantics (strict vs soft) are
enforced by the adapter caller, not here — this service is stateless.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
from typing import Any

from aiohttp import web

LOG = logging.getLogger("opf-router")
logging.basicConfig(
    level=os.environ.get("OPF_LOG_LEVEL", "info").upper(),
    format='{"ts":"%(asctime)s","level":"%(levelname)s","msg":%(message)s}',
)

PORT        = int(os.environ.get("OPF_PORT", "9092"))
MODE        = os.environ.get("OPF_MODE", "off")
DTYPE       = os.environ.get("OPF_DTYPE", "bf16")
MODEL_ID    = os.environ.get("OPF_MODEL", "openai/privacy-filter")
HF_HOME     = os.environ.get("HF_HOME", "/workspace/.cache/huggingface")

ALLOWED_ENTITIES = {
    "account_number", "private_address", "private_email",
    "private_person",  "private_phone",   "private_url",
    "private_date",    "secret",
}

# ─── metrics (minimal Prometheus text exporter) ───────────────────────────────

_METRICS: dict[str, dict[tuple[str, ...], float]] = {
    "opf_requests_total":            {},
    "opf_redactions_total":          {},
    "opf_fail_closed_total":         {},
    "opf_fail_open_total":           {},
    "opf_latency_ms_sum":            {},
    "opf_latency_ms_count":          {},
}

def _inc(name: str, labels: tuple[str, ...], value: float = 1.0) -> None:
    bucket = _METRICS.setdefault(name, {})
    bucket[labels] = bucket.get(labels, 0.0) + value

def _render_metrics() -> str:
    out: list[str] = []
    for metric, buckets in _METRICS.items():
        if not buckets:
            continue
        for labels, value in buckets.items():
            label_str = ",".join(labels) if labels else ""
            out.append(f"{metric}{{{label_str}}} {value}")
    return "\n".join(out) + "\n"

# ─── model loading ────────────────────────────────────────────────────────────

_pipeline: Any = None
_device_desc: str = "unloaded"

def _torch_dtype():
    import torch  # local import so /health works even if torch missing
    return {
        "bf16": torch.bfloat16,
        "f32":  torch.float32,
        "q4":   torch.float32,  # q4 path uses bitsandbytes-style loading; fallback here
    }.get(DTYPE, torch.bfloat16)

def _device():
    import torch
    if MODE == "local-gpu" and torch.cuda.is_available():
        return 0
    return -1

def _load_model() -> None:
    """Load the pipeline once at startup. Errors surface as HTTP 503 via _pipeline=None."""
    global _pipeline, _device_desc
    if MODE == "off":
        _device_desc = "disabled"
        return
    try:
        import torch
        from transformers import pipeline

        device = _device()
        _pipeline = pipeline(
            task="token-classification",
            model=MODEL_ID,
            aggregation_strategy="simple",
            device=device,
            torch_dtype=_torch_dtype(),
        )
        _device_desc = (
            f"cuda:{device}" if device >= 0 else "cpu"
        ) + f"/{DTYPE}"
        LOG.info(json.dumps({"event": "model_loaded", "device": _device_desc, "model": MODEL_ID}))
    except Exception as exc:
        _pipeline = None
        _device_desc = f"load_error: {type(exc).__name__}"
        LOG.error(json.dumps({"event": "model_load_failed", "error": repr(exc)}))

# ─── classification + redaction ───────────────────────────────────────────────

def _filter_entities(spans: list[dict[str, Any]], allow: set[str] | None) -> list[dict[str, Any]]:
    if not allow:
        return spans
    return [s for s in spans if s.get("entity_group") in allow or s.get("entity") in allow]

def _classify(text: str, entities: list[str] | None) -> list[dict[str, Any]]:
    if _pipeline is None:
        raise RuntimeError("privacy-filter pipeline unavailable")
    allow = set(entities) & ALLOWED_ENTITIES if entities else None
    raw = _pipeline(text)
    spans = [
        {
            "entity_group": r.get("entity_group") or r.get("entity"),
            "start":        int(r.get("start", 0)),
            "end":          int(r.get("end", 0)),
            "score":        float(r.get("score", 0.0)),
            "text":         r.get("word") or text[int(r.get("start", 0)):int(r.get("end", 0))],
        }
        for r in raw
    ]
    return _filter_entities(spans, allow)

def _redact(text: str, spans: list[dict[str, Any]], mask_template: str | None) -> str:
    if not spans:
        return text
    ordered = sorted(spans, key=lambda s: s["start"], reverse=True)
    redacted = text
    for s in ordered:
        placeholder = (mask_template or "[{ENTITY}]").replace("{ENTITY}", s["entity_group"].upper())
        redacted = redacted[: s["start"]] + placeholder + redacted[s["end"] :]
    return redacted

# ─── HTTP handlers ────────────────────────────────────────────────────────────

async def health(_req: web.Request) -> web.Response:
    status = "ready" if (_pipeline is not None or MODE == "off") else "unavailable"
    return web.json_response({
        "status":  status,
        "mode":    MODE,
        "model":   MODEL_ID,
        "device":  _device_desc,
        "dtype":   DTYPE,
    })

async def metrics(_req: web.Request) -> web.Response:
    return web.Response(text=_render_metrics(), content_type="text/plain")

async def classify(req: web.Request) -> web.Response:
    t0 = time.perf_counter()
    try:
        payload = await req.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)
    if _pipeline is None:
        return web.json_response({"error": "model_unavailable", "detail": _device_desc}, status=503)

    text     = payload.get("text", "")
    entities = payload.get("entities")
    slot     = payload.get("slot", "unknown")

    if not isinstance(text, str):
        return web.json_response({"error": "text_must_be_string"}, status=400)

    try:
        spans = await asyncio.get_event_loop().run_in_executor(None, _classify, text, entities)
    except Exception as exc:
        _inc("opf_fail_closed_total", (f"slot=\"{slot}\"",))
        LOG.error(json.dumps({"event": "classify_failed", "slot": slot, "error": repr(exc)}))
        return web.json_response({"error": "classify_failed", "detail": str(exc)}, status=500)

    dt_ms = (time.perf_counter() - t0) * 1000.0
    _inc("opf_requests_total",   (f"slot=\"{slot}\"", "op=\"classify\""))
    _inc("opf_latency_ms_sum",   (f"slot=\"{slot}\"", "op=\"classify\""), dt_ms)
    _inc("opf_latency_ms_count", (f"slot=\"{slot}\"", "op=\"classify\""))
    for s in spans:
        _inc("opf_redactions_total", (f"slot=\"{slot}\"", f"entity=\"{s['entity_group']}\""))
    return web.json_response({"spans": spans, "latency_ms": dt_ms})

async def redact(req: web.Request) -> web.Response:
    t0 = time.perf_counter()
    try:
        payload = await req.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)
    if _pipeline is None:
        return web.json_response({"error": "model_unavailable", "detail": _device_desc}, status=503)

    text      = payload.get("text", "")
    entities  = payload.get("entities")
    mask      = payload.get("mask")
    slot      = payload.get("slot", "unknown")

    if not isinstance(text, str):
        return web.json_response({"error": "text_must_be_string"}, status=400)

    try:
        spans    = await asyncio.get_event_loop().run_in_executor(None, _classify, text, entities)
        redacted = _redact(text, spans, mask)
    except Exception as exc:
        _inc("opf_fail_closed_total", (f"slot=\"{slot}\"",))
        LOG.error(json.dumps({"event": "redact_failed", "slot": slot, "error": repr(exc)}))
        return web.json_response({"error": "redact_failed", "detail": str(exc)}, status=500)

    dt_ms = (time.perf_counter() - t0) * 1000.0
    _inc("opf_requests_total",   (f"slot=\"{slot}\"", "op=\"redact\""))
    _inc("opf_latency_ms_sum",   (f"slot=\"{slot}\"", "op=\"redact\""), dt_ms)
    _inc("opf_latency_ms_count", (f"slot=\"{slot}\"", "op=\"redact\""))
    for s in spans:
        _inc("opf_redactions_total", (f"slot=\"{slot}\"", f"entity=\"{s['entity_group']}\""))
    return web.json_response({
        "text":       redacted,
        "replaced":   spans,
        "latency_ms": dt_ms,
    })

# ─── main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    if MODE == "off":
        LOG.info(json.dumps({"event": "start", "mode": "off"}))
        # keep the supervisor happy with a minimal HTTP server reporting disabled
        _load_model()
    else:
        _load_model()

    app = web.Application()
    app.router.add_get("/health",   health)
    app.router.add_get("/metrics",  metrics)
    app.router.add_post("/classify", classify)
    app.router.add_post("/redact",   redact)
    LOG.info(json.dumps({"event": "listen", "port": PORT, "mode": MODE, "device": _device_desc}))
    web.run_app(app, host="127.0.0.1", port=PORT, print=None)
    return 0

if __name__ == "__main__":
    sys.exit(main())
