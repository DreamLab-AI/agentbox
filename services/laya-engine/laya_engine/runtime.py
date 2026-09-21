"""Checkpoint loading and batched typed-question inference.

This module reproduces `laya.agent.Agent.system_one` from laya's own primitives
(`build_sequence`, `collate_items`, `temp_bucket`, `confidence_from_probs`)
rather than calling it, for three reasons the façade depends on:

* **per-request budgets** — `max_len` / `head_max_len` are plain cfg keys and the
  façade may raise them (a measured choice, ADR-2094 addendum §4); the SDK reads
  them from the checkpoint config only;
* **`truncate_left`** — `build_sequence` can keep the *tail* of the state, which
  is what compaction needs and what `Agent.system_one` never enables;
* **structured errors** — the SDK raises `ValueError("question %r options exceed
  head_max_len=%d")`. Parsing that string to find the question id would be a
  stringly-typed contract; here the id and the token accounting come out as data.

The decode path (temperature bucket, entropy confidence, answer shape including
Laya's own `action` metadata) is byte-for-byte what the SDK produces.
"""

from __future__ import annotations

import os
import threading
import time
import traceback
from typing import Any, Dict, List, Optional, Union

import numpy as np
import torch
from laya import QTYPES, confidence_from_probs, render_options
from laya.agent import Agent
from laya.common import build_sequence, collate_items, serialize_state, temp_bucket

from .config import ModelSpec, Settings

#: `laya/common.py:build_sequence` hard-truncates every rendered option to this
#: many tokens, unconditionally, before any budget logic runs. The façade must
#: compress rubrics to fit deliberately rather than let the tokeniser amputate
#: them (ADR-2094 addendum §1), so the engine reports the cap and the real
#: per-option token counts instead of hiding them.
OPTION_TOKEN_CAP = 48

#: Below this remaining head budget the SDK silently squeezes every option to
#: `max(4, (head_max_len - 16) // n)` tokens. The façade must never reach this
#: path; when it does, the engine says so in `engine.questions.<id>.squeezed`.
SQUEEZE_FLOOR = 16

_VALID_TYPES = ("choice", "score", "noul")


class RequestError(Exception):
    """A caller error: HTTP 4xx with a machine-readable code."""

    def __init__(self, code: str, message: str, status: int = 400, **detail: Any) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.detail = detail


def validate_questions(questions: Dict[str, Any], max_questions: int) -> None:
    """Reject malformed question sets before any tokenisation happens."""
    if not isinstance(questions, dict) or not questions:
        raise RequestError("no_questions", "`questions` must be a non-empty object")
    if len(questions) > max_questions:
        raise RequestError(
            "too_many_questions",
            f"{len(questions)} questions exceeds the engine limit of {max_questions}",
            status=413,
        )
    for qid, qdef in questions.items():
        if not isinstance(qdef, dict):
            raise RequestError("bad_question", f"question {qid!r} must be an object", question=qid)
        qtype = qdef.get("type")
        if qtype not in _VALID_TYPES:
            raise RequestError(
                "bad_question_type",
                f"question {qid!r} has type {qtype!r}; expected one of {_VALID_TYPES}",
                question=qid,
            )
        if not qdef.get("instructions"):
            raise RequestError(
                "missing_instructions",
                f"question {qid!r} has no instructions",
                question=qid,
            )
        crit = qdef.get("criteria")
        if qtype == "choice":
            if not isinstance(crit, (dict, list)) or len(crit) < 2:
                raise RequestError(
                    "bad_criteria",
                    f"choice question {qid!r} needs at least two options",
                    question=qid,
                )
        elif qtype == "score":
            if not isinstance(crit, list) or len(crit) < 2:
                raise RequestError(
                    "bad_criteria",
                    f"score question {qid!r} needs a list of at least two levels",
                    question=qid,
                )


def ensure_local(spec: ModelSpec, model_dir: str, token: Optional[str]) -> str:
    """Materialise a checkpoint on disk and return the directory to load.

    Downloads into `model_dir/<name>` with `local_dir`, so the tree is real files
    rather than symlinks into the blob store: `laya.agent._fix_tokenizer_config`
    rewrites `tokenizer_config.json` in place, and doing that through a blob
    symlink would corrupt the content-addressed cache entry.

    `allow_patterns` is explicit rather than `*.json`, because
    `huggingface_hub` matches with `fnmatch`, where `*` also matches `/` — a
    `*.json` pattern would drag the multilingual checkpoint in with it.
    """
    if os.path.isdir(spec.repo):
        path = os.path.join(spec.repo, spec.subfolder) if spec.subfolder else spec.repo
        if not os.path.isdir(path):
            raise FileNotFoundError(f"local checkpoint not found: {path}")
        return path

    from huggingface_hub import snapshot_download

    if spec.subfolder:
        patterns = [f"{spec.subfolder}/*"]
    else:
        patterns = [
            "rl_agent_config.json",
            "model.safetensors",
            "encoder/*",
            "tokenizer/*",
        ]
    root = snapshot_download(
        spec.repo,
        allow_patterns=patterns,
        local_dir=os.path.join(model_dir, spec.name),
        token=token,
    )
    return os.path.join(root, spec.subfolder) if spec.subfolder else root


class ModelHandle:
    """One loaded checkpoint plus everything `/health` and `/v1/models` report."""

    def __init__(self, spec: ModelSpec, settings: Settings) -> None:
        self.spec = spec
        self.settings = settings
        self.agent: Optional[Agent] = None
        self.error: Optional[str] = None
        self.local_path: Optional[str] = None
        self.load_seconds: Optional[float] = None
        self.requested_device = settings.device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.cpu_fallback = False
        self.cpu_fallback_reason: Optional[str] = None
        self.predictions = 0
        self.lock = threading.Lock()

    # ── lifecycle ────────────────────────────────────────────────────────────

    def load(self) -> None:
        """Load the checkpoint. Failure is recorded, never raised: a missing or
        broken checkpoint must degrade `/health`, not restart the container."""
        started = time.monotonic()
        try:
            self.local_path = ensure_local(self.spec, self.settings.model_dir, self.settings.hf_token)
            agent = Agent(self.local_path, device=self.settings.device)
            self.agent = agent
            self.error = None
            # The SDK falls back to CPU (with a printed warning) when it cannot
            # place the model on the requested device. Surface it as state.
            if self.requested_device.startswith("cuda") and agent.device.type != "cuda":
                self.cpu_fallback = True
                self.cpu_fallback_reason = "checkpoint could not be placed on CUDA at load"
        except Exception as exc:  # noqa: BLE001 — degrade, do not crash
            self.agent = None
            self.error = f"{type(exc).__name__}: {exc}"
            traceback.print_exc()
        finally:
            self.load_seconds = round(time.monotonic() - started, 3)

    @property
    def loaded(self) -> bool:
        return self.agent is not None

    # ── budget ───────────────────────────────────────────────────────────────

    def _cfg_int(self, key: str, fallback: int) -> int:
        if self.agent is None:
            return fallback
        try:
            return int(self.agent.cfg.get(key, fallback))
        except (TypeError, ValueError):
            return fallback

    @property
    def checkpoint_max_len(self) -> int:
        return self._cfg_int("max_len", 512)

    @property
    def checkpoint_head_max_len(self) -> int:
        return self._cfg_int("head_max_len", 192)

    @property
    def max_len(self) -> int:
        return self.settings.max_len_override or self.checkpoint_max_len

    @property
    def head_max_len(self) -> int:
        return self.settings.head_max_len_override or self.checkpoint_head_max_len

    def describe(self) -> Dict[str, Any]:
        """The `/v1/models` record. Budgets are the REAL loaded values."""
        return {
            "id": self.spec.name,
            "source": self.spec.source,
            "local_path": self.local_path,
            "loaded": self.loaded,
            "error": self.error,
            "device": str(self.agent.device) if self.agent else None,
            "dtype": str(self.agent.dtype) if self.agent else None,
            "encoder": (self.agent.cfg.get("encoder") if self.agent else None),
            "max_len": self.max_len,
            "head_max_len": self.head_max_len,
            "checkpoint_max_len": self.checkpoint_max_len,
            "checkpoint_head_max_len": self.checkpoint_head_max_len,
            "max_len_source": "env" if self.settings.max_len_override else "checkpoint",
            "head_max_len_source": "env" if self.settings.head_max_len_override else "checkpoint",
            "option_token_cap": OPTION_TOKEN_CAP,
            # The façade reads `option_max_len`; same number, its name for it.
            "option_max_len": OPTION_TOKEN_CAP,
            "squeeze_floor": SQUEEZE_FLOOR,
            "load_seconds": self.load_seconds,
            "cpu_fallback": self.cpu_fallback,
            "cpu_fallback_reason": self.cpu_fallback_reason,
            "predictions": self.predictions,
        }

    # ── inference ────────────────────────────────────────────────────────────

    def predict(
        self,
        state: Union[str, dict, list],
        questions: Dict[str, Any],
        max_len: Optional[int] = None,
        head_max_len: Optional[int] = None,
        truncate_left: bool = False,
    ) -> Dict[str, Any]:
        """Answer every question in ONE batched forward pass.

        Questions are independent sequences; batching them is what makes a
        multi-question call cost one encoder pass rather than N.
        """
        if self.agent is None:
            raise RequestError(
                "model_unavailable",
                f"model {self.spec.name!r} is not loaded: {self.error or 'unknown reason'}",
                status=503,
                model=self.spec.name,
            )
        agent = self.agent
        tok = agent.tok
        eff_max_len = int(max_len or self.max_len)
        eff_head_max_len = int(head_max_len or self.head_max_len)
        if eff_head_max_len >= eff_max_len:
            raise RequestError(
                "bad_budget",
                f"head_max_len ({eff_head_max_len}) must be smaller than max_len ({eff_max_len})",
            )

        qids = list(questions.keys())
        items: List[Dict[str, Any]] = []
        diagnostics: Dict[str, Any] = {}

        state_tokens_total = len(
            tok(_safe_state(tok, state), add_special_tokens=False)["input_ids"]
        )

        for qid in qids:
            qdef = questions[qid]
            q = Agent._to_internal(qdef)
            per_question_left = bool(qdef.get("truncate_left", truncate_left))
            opts = render_options(q)
            opt_lens = [
                1 + len(tok(" " + _mask_free(tok, o), add_special_tokens=False)["input_ids"][:OPTION_TOKEN_CAP])
                for o in opts
            ]
            ins_tokens = len(
                tok("%s question: %s" % (q["t"], _mask_free(tok, str(q["ins"]))), add_special_tokens=False)[
                    "input_ids"
                ]
            )
            head_cost = sum(opt_lens)
            squeezed = (eff_head_max_len - head_cost) < SQUEEZE_FLOOR

            seq, markers = build_sequence(
                tok, state, q, eff_max_len, eff_head_max_len, truncate_left=per_question_left
            )
            if len(markers) != len(opts):
                # ADR-2094 §3.1 step 5 / addendum §3: never guess.
                raise RequestError(
                    "options_unfittable",
                    (
                        f"question {qid!r}: {len(opts)} options need {head_cost} head tokens "
                        f"but head_max_len is {eff_head_max_len}; only {len(markers)} option "
                        "markers survived"
                    ),
                    status=422,
                    question=qid,
                    options=len(opts),
                    markers_kept=len(markers),
                    option_tokens=opt_lens,
                    head_tokens_required=head_cost,
                    head_max_len=eff_head_max_len,
                    option_token_cap=OPTION_TOKEN_CAP,
                )

            head_block = markers[-1] + opt_lens[-1] + 1 if markers else 0
            state_used = max(0, len(seq) - head_block - 1)
            diagnostics[qid] = {
                "type": q["t"],
                "options": len(opts),
                "option_tokens": opt_lens,
                "option_tokens_capped": sum(1 for o, n in zip(opts, opt_lens) if n - 1 >= OPTION_TOKEN_CAP),
                "instruction_tokens": ins_tokens,
                "head_tokens": head_cost,
                "squeezed": squeezed,
                "state_tokens_used": state_used,
                "state_tokens_total": state_tokens_total,
                "state_truncated": state_used < state_tokens_total,
                "truncate_left": per_question_left,
                "sequence_tokens": len(seq),
            }
            items.append({"ids": seq, "markers": markers, "qtype": QTYPES[q["t"]]})

        batch = collate_items([items], tok.pad_token_id)
        started = time.monotonic()
        with self.lock:
            logits, act = self._forward(batch)
            self.predictions += 1
        engine_ms_precise = (time.monotonic() - started) * 1000.0

        answers = {}
        for row, qid in enumerate(qids):
            q = Agent._to_internal(questions[qid])
            answers[qid] = self._decode(q, logits[row], len(items[row]["markers"]), act[row])

        return {
            "model": self.spec.name,
            "answers": answers,
            "usage": {"input_tokens": int(batch["attention_mask"].sum()), "output_tokens": 0},
            # INTEGER by contract: the façade reads `ms` as a u64, so a float
            # here is a parse error rather than extra precision. The exact value
            # stays available one level down.
            "ms": int(round(engine_ms_precise)),
            "engine": {
                "model": self.spec.name,
                "device": str(agent.device),
                "dtype": str(agent.dtype),
                "max_len": eff_max_len,
                "head_max_len": eff_head_max_len,
                "option_token_cap": OPTION_TOKEN_CAP,
                "batched_questions": len(qids),
                "ms_precise": round(engine_ms_precise, 3),
                "cpu_fallback": self.cpu_fallback,
                "cpu_fallback_reason": self.cpu_fallback_reason,
                "questions": diagnostics,
            },
        }

    @torch.no_grad()
    def _forward(self, batch: Dict[str, Any]):
        """One encoder pass, with the SDK's CUDA-OOM CPU fallback made explicit."""
        agent = self.agent
        assert agent is not None
        try:
            return self._run(batch)
        except (RuntimeError, torch.cuda.OutOfMemoryError) as exc:  # noqa: PERF203
            text = str(exc).lower()
            if agent.device.type != "cpu" and ("memory" in text or "cuda" in text):
                # Same fallback the SDK performs, but recorded rather than printed:
                # a silently halved throughput is an operational lie in /health.
                agent.device = torch.device("cpu")
                agent.dtype = torch.float32
                agent.model.to(agent.device)
                self.cpu_fallback = True
                self.cpu_fallback_reason = f"CUDA fallback during inference: {exc}"
                torch.cuda.empty_cache()
                return self._run(batch)
            raise

    def _run(self, batch: Dict[str, Any]):
        agent = self.agent
        assert agent is not None
        device = agent.device
        use_amp = device.type == "cuda"
        with torch.autocast(device_type=device.type, dtype=agent.dtype, enabled=use_amp):
            logits, act = agent.model(
                batch["input_ids"].to(device),
                batch["attention_mask"].to(device),
                batch["marker_pos"].to(device),
                batch["marker_mask"].to(device),
                batch["qtype"].to(device),
            )
        return logits.float().cpu().numpy(), torch.softmax(act.float(), -1).cpu().numpy()

    def _decode(self, q: Dict[str, Any], row_logits: np.ndarray, k: int, act_row: np.ndarray) -> Dict[str, Any]:
        """Temperature, softmax and answer shape exactly as `Agent.system_one`."""
        agent = self.agent
        assert agent is not None
        qt = QTYPES[q["t"]]
        t_scale = agent.temperature_by_options.get(temp_bucket(qt, k), agent.temperature[qt])
        z = row_logits[:k] / max(1e-3, float(t_scale))
        p = np.exp(z - z.max())
        p = p / p.sum()
        conf = round(confidence_from_probs(p, k), 4)
        ext = {"act_probability": round(float(act_row[0]), 4)}

        if q["t"] == "choice":
            keys = list(q["crit"].keys())
            return {
                "type": "choice",
                "choice": keys[int(p.argmax())],
                "probabilities": {kk: round(float(v), 4) for kk, v in zip(keys, p)},
                "confidence": conf,
                "action": ext,
            }
        if q["t"] == "score":
            return {
                "type": "score",
                "score": round(float((np.arange(k) * p).sum()), 4),
                "legend": {str(i): c for i, c in enumerate(q["crit"])},
                "probabilities": {str(i): round(float(v), 4) for i, v in enumerate(p)},
                "confidence": conf,
                "action": ext,
            }
        return {
            "type": "noul",
            "noul": round(float(p[1]), 4),
            "confidence": round(max(float(p[1]), 1.0 - float(p[1])), 4),
            "action": ext,
        }


def _mask_free(tok, text: str) -> str:
    mask = getattr(tok, "mask_token", None)
    return text.replace(mask, " ") if mask else text


def _safe_state(tok, state: Union[str, dict, list]) -> str:
    return _mask_free(tok, serialize_state(state))


class Registry:
    """All configured checkpoints, preloaded at startup."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.handles: Dict[str, ModelHandle] = {
            spec.name: ModelHandle(spec, settings) for spec in settings.models
        }
        self.started_at = time.time()

    def preload(self) -> None:
        for handle in self.handles.values():
            handle.load()

    def resolve(self, name: Optional[str]) -> ModelHandle:
        """Resolve a model name, accepting the façade's aliases.

        `laya-latest` and an empty name mean "the deployment default", mirroring
        how the Jev consumers send `jev-latest`.
        """
        key = (name or "").strip()
        if not key or key in ("laya-latest", "latest", "default", "jev-latest"):
            key = self.settings.default_model
        handle = self.handles.get(key)
        if handle is None:
            raise RequestError(
                "unknown_model",
                f"model {key!r} is not served; available: {sorted(self.handles)}",
                status=404,
                model=key,
            )
        return handle

    def cuda_state(self) -> Dict[str, Any]:
        available = torch.cuda.is_available()
        devices: List[Dict[str, Any]] = []
        if available:
            for idx in range(torch.cuda.device_count()):
                props = torch.cuda.get_device_properties(idx)
                devices.append(
                    {
                        "index": idx,
                        "name": props.name,
                        "capability": f"{props.major}.{props.minor}",
                        "total_memory_mb": round(props.total_memory / (1024 * 1024)),
                    }
                )
        return {
            "torch": torch.__version__,
            "cuda_available": available,
            "cuda_version": torch.version.cuda,
            "device_count": len(devices),
            "devices": devices,
        }

    def health(self) -> Dict[str, Any]:
        loaded = [h for h in self.handles.values() if h.loaded]
        failed = {h.spec.name: h.error for h in self.handles.values() if not h.loaded}
        fallbacks = {
            h.spec.name: h.cpu_fallback_reason for h in self.handles.values() if h.cpu_fallback
        }
        if not self.handles:
            status = "unavailable"
        elif not loaded:
            status = "unavailable"
        elif failed or fallbacks:
            status = "degraded"
        else:
            status = "ok"
        default_handle = self.handles.get(self.settings.default_model)
        return {
            "status": status,
            "models_loaded": sorted(h.spec.name for h in loaded),
            "models_failed": failed,
            # BOOLEAN by contract: the façade deserialises `cpu_fallback` as a
            # bool ("did the engine quietly halve its throughput?"). The reasons
            # are richer, so they get their own key rather than overloading this
            # one into a map the consumer cannot read.
            "cpu_fallback": bool(fallbacks),
            "cpu_fallback_detail": fallbacks,
            # Flat `model`/`device` for the same consumer: it reports one
            # engine, and this is the one it will actually call.
            "model": self.settings.default_model,
            "device": str(default_handle.agent.device)
            if default_handle is not None and default_handle.agent is not None
            else None,
            "default_model": self.settings.default_model,
            "uptime_s": round(time.time() - self.started_at, 1),
            "gpu": self.cuda_state(),
        }
