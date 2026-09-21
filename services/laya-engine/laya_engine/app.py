"""FastAPI surface for the laya engine.

Three endpoints, no business logic:

* ``GET  /health``     — liveness plus the honest state of every checkpoint and
  of CUDA, including the SDK's silent CPU fallback.
* ``GET  /v1/models``  — the real ``max_len`` / ``head_max_len`` of each LOADED
  checkpoint, so the façade learns the budget instead of hard-coding it.
* ``POST /predict``    — ``{state, questions}`` → ``{answers, usage, ms, engine}``,
  every question batched into a single forward pass.

Shortlisting and windowing are deliberately absent: they are the façade's job
(ADR-2094 §3), and an engine that quietly reshaped a request would make the
façade's `sso` honesty block a fiction.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, Optional, Union

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .config import Settings
from .runtime import OPTION_TOKEN_CAP, Registry, RequestError, validate_questions

log = logging.getLogger("laya-engine")


class PredictRequest(BaseModel):
    """`/predict` body. Budget overrides are per request so the façade can raise
    them without restarting the engine; omitted, the checkpoint's own values win."""

    state: Union[str, Dict[str, Any], list] = ""
    questions: Dict[str, Any] = Field(default_factory=dict)
    model: Optional[str] = None
    max_len: Optional[int] = None
    head_max_len: Optional[int] = None
    #: Keep the TAIL of the state rather than the head. Recency is what
    #: compaction cares about (ADR-2094 addendum §5). Overridable per question
    #: with a `truncate_left` key inside the question object.
    truncate_left: bool = False


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    settings = settings or Settings.from_env()
    registry = Registry(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        # Cold load is ~7-10 s per checkpoint; doing it before the server
        # accepts traffic means the first real request is warm and /health is
        # truthful from the first probe.
        started = time.monotonic()
        await run_in_threadpool(registry.preload)
        health = registry.health()
        log.info(
            "preload finished in %.1fs: status=%s loaded=%s failed=%s",
            time.monotonic() - started,
            health["status"],
            health["models_loaded"],
            list(health["models_failed"]),
        )
        yield

    app = FastAPI(
        lifespan=lifespan,
        title="laya-engine",
        version="1.0.0",
        summary="Local typed-decision engine (laya) behind the Sovereign System One façade",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.settings = settings
    app.state.registry = registry

    @app.exception_handler(RequestError)
    def _request_error(_: Request, exc: RequestError) -> JSONResponse:
        body: Dict[str, Any] = {"error": {"code": exc.code, "message": exc.message}}
        if exc.detail:
            body["error"].update(exc.detail)
        return JSONResponse(status_code=exc.status, content=body)

    @app.get("/health")
    def health() -> JSONResponse:
        payload = registry.health()
        # A missing checkpoint degrades the service; it never crash-loops the
        # container. 503 only when NOTHING can answer.
        status = 503 if payload["status"] == "unavailable" else 200
        return JSONResponse(status_code=status, content=payload)

    @app.get("/v1/models")
    def models() -> Dict[str, Any]:
        return {
            "object": "list",
            "default": settings.default_model,
            "option_token_cap": OPTION_TOKEN_CAP,
            "data": [handle.describe() for handle in registry.handles.values()],
        }

    @app.post("/predict")
    def predict(body: PredictRequest) -> Dict[str, Any]:
        validate_questions(body.questions, settings.max_questions)
        handle = registry.resolve(body.model)
        started = time.monotonic()
        result = handle.predict(
            body.state,
            body.questions,
            max_len=body.max_len,
            head_max_len=body.head_max_len,
            truncate_left=body.truncate_left,
        )
        if settings.request_log:
            log.info(
                "predict model=%s questions=%d input_tokens=%d ms=%.1f",
                result["model"],
                len(body.questions),
                result["usage"]["input_tokens"],
                (time.monotonic() - started) * 1000.0,
            )
        return result

    return app


app = create_app()
