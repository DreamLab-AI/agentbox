"""FastAPI surface for the openjev engine.

The same three routes, request shapes and response shapes as
``services/laya-engine`` — deliberately one dialect, so the façade is
indifferent to which engine is behind it and can be repointed with a single
environment variable:

* ``GET  /health``    — liveness plus the honest state of the checkpoint, of
  CUDA, of any chunk reduction and of the CPU fallback.
* ``GET  /v1/models`` — the real ``max_len`` and the SSO §11.4 capability
  fields (``scores_options_independently``, ``option_max_len``,
  ``head_max_len``), which the façade reads instead of hard-coding behaviour.
* ``POST /predict``   — ``{state, questions}`` → ``{answers, usage, ms, engine}``.

Shortlisting, windowing and the §11.3 ``none`` threshold are all absent on
purpose: they are the façade's, and an engine that quietly reshaped a request
or declined on the caller's behalf would make the façade's ``sso`` honesty
block a fiction.
"""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional, Union

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .config import DEFAULT_MAX_LEN, PINNED_REVISION, Settings
from .runtime import Registry, RequestError, validate_questions

log = logging.getLogger("openjev-engine")


class PredictRequest(BaseModel):
    """`/predict` body.

    `head_max_len` is accepted and ignored: this engine has no shared head
    budget, so honouring it would be pretending to a constraint that does not
    exist. A façade reading `/v1/models` will not send one; one that does is
    told so in `engine.ignored`.
    """

    state: Union[str, Dict[str, Any], list] = ""
    questions: Dict[str, Any] = Field(default_factory=dict)
    model: Optional[str] = None
    max_len: Optional[int] = None
    head_max_len: Optional[int] = None
    #: Keep the TAIL of the state rather than the head. Recency is what
    #: compaction cares about. Overridable per question.
    truncate_left: bool = False
    #: `entailment` or `ent_vs_contra`; omitted, the deployment default. Both
    #: readings are reported in every noul answer regardless.
    noul_mode: Optional[str] = None


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    settings = settings or Settings.from_env()
    registry = Registry(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        # Cold load of a 4B bf16 checkpoint is tens of seconds (and the first
        # boot also downloads ~8.5 GiB). Doing it before the server accepts
        # traffic means the first real request is warm and /health is truthful
        # from the first probe.
        started = time.monotonic()
        await run_in_threadpool(registry.preload)
        health = registry.health()
        log.info(
            "preload finished in %.1fs: status=%s loaded=%s failed=%s revision=%s",
            time.monotonic() - started,
            health["status"],
            health["models_loaded"],
            list(health["models_failed"]),
            PINNED_REVISION,
        )
        yield

    app = FastAPI(
        lifespan=lifespan,
        title="openjev-engine",
        version="1.0.0",
        summary="Local typed-decision engine (openjev NLI cross-encoder) behind the "
        "Sovereign System One façade",
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
        # A checkpoint that would not load degrades the service; it never
        # crash-loops the container. 503 only when NOTHING can answer.
        status = 503 if payload["status"] == "unavailable" else 200
        return JSONResponse(status_code=status, content=payload)

    @app.get("/v1/models")
    def models() -> Dict[str, Any]:
        default = registry.handles.get(settings.default_model)
        return {
            "object": "list",
            "engine": "openjev",
            "default": settings.default_model,
            # Flat mirrors of the default model's capability fields, for a
            # consumer that reads the payload's top level rather than `data`.
            "scores_options_independently": True,
            "option_max_len": None,
            "head_max_len": None,
            # NEVER null and never absent. The façade distinguishes the two
            # caps' `null` ("this limit does not exist") from their absence
            # ("engine did not declare itself" ⇒ assume laya's shape), but for
            # `max_len` both null and absent mean "fall back to 512" — which
            # would window a 4k-context engine as if it were a 512-token one.
            # So a misconfigured default name degrades to the real ceiling
            # rather than to a silently wrong small number.
            "max_len": default.max_len if default else DEFAULT_MAX_LEN,
            "pinned_revision": PINNED_REVISION,
            "data": [handle.describe() for handle in registry.handles.values()],
        }

    @app.post("/predict")
    def predict(body: PredictRequest) -> Dict[str, Any]:
        validate_questions(body.questions, settings.max_questions, settings.max_options)
        handle = registry.resolve(body.model)
        started = time.monotonic()
        result = handle.predict(
            body.state,
            body.questions,
            max_len=body.max_len,
            truncate_left=body.truncate_left,
            noul_mode=body.noul_mode,
        )
        if body.head_max_len is not None:
            result["engine"]["ignored"] = {
                "head_max_len": body.head_max_len,
                "reason": "this engine scores options independently; there is no shared "
                "head budget (see /v1/models: head_max_len = null)",
            }
        if settings.request_log:
            log.info(
                "predict model=%s questions=%d hypotheses=%d input_tokens=%d ms=%.1f",
                result["model"],
                len(body.questions),
                result["engine"]["hypotheses_scored"],
                result["usage"]["input_tokens"],
                (time.monotonic() - started) * 1000.0,
            )
        return result

    return app


app = create_app()
