"""Checkpoint loading and typed-question inference for openjev.

openjev is a Qwen3.5-4B decoder with a three-class NLI head
(`contradiction`, `entailment`, `neutral`) pooled off the last non-pad token.
It answers exactly one primitive — *does this premise entail this hypothesis* —
and the three typed System One questions are mapped onto it in
:mod:`openjev_engine.primitives`, which is pure and separately testable. This
module owns only the parts that need a GPU and a network: the checkpoint, the
sequence budget, the batching, the OOM behaviour and the health surface.

What is deliberately NOT here:

* the §11.3 `none` threshold — the engine returns honest per-option entailment
  and the façade decides, because only the façade holds the caller's original
  option set and only the façade re-expands mass over it;
* shortlisting and windowing (§3) — an engine that quietly reshaped a request
  would make the façade's `sso` honesty block a fiction;
* rubric compression (§11.2) — there is no shared head budget to protect, and
  compressing anyway would discard the reason this engine exists.
"""

from __future__ import annotations

import hashlib
import importlib.util
import os
import threading
import time
import traceback
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

import numpy as np
import torch

from .config import (
    DEFAULT_MAX_LEN,
    PINNED_REVISION,
    VENDORED_MODELING_SHA256,
    ModelSpec,
    Settings,
)
from .primitives import (  # noqa: F401  (re-exported for importers of `runtime`)
    CON,
    ENT,
    LABELS,
    NEU,
    NOUL_MODES,
    RequestError,
    confidence_from_probs,
    decode,
    premise_budget,
    render_choice_options,
    resolve_noul_mode,
    serialize_state,
    shared_prefix,
    validate_questions,
)

#: Tokens held back from the sequence budget so a boundary merge between the
#: premise and the template cannot push a sequence over `max_len` and let the
#: tokeniser truncate the HYPOTHESIS away — the one truncation that turns a
#: judgement into noise.
SEQUENCE_MARGIN = 8

#: Below this many tokens of premise budget a question is refused rather than
#: answered over a stump.
MIN_STATE_TOKENS = 16


# ── vendored helper ──────────────────────────────────────────────────────────


def vendor_path(vendor_dir: Optional[str] = None) -> Path:
    """Where the vendored upstream helper lives."""
    root = Path(vendor_dir) if vendor_dir else Path(__file__).resolve().parent.parent / "vendor"
    return root / "modeling_openjev.py"


def load_vendored_modeling(vendor_dir: Optional[str] = None):
    """Import `modeling_openjev` from the vendored, digest-pinned copy.

    Not `trust_remote_code`: the checkpoint's `config.json` carries no
    `auto_map` and names `Qwen3_5ForSequenceClassification`, a class native to
    transformers 5, so the *weights* need no remote code at all. What needs
    pinning is this **helper**, whose documented install is "download it from a
    four-day-old repository's default branch" — code that can be replaced under
    us between two identical `docker compose up` runs, with no diff to review.
    It is vendored at :data:`PINNED_REVISION` and verified here, so it cannot
    change without a reviewable commit in this repository.
    """
    path = vendor_path(vendor_dir)
    if not path.is_file():
        raise FileNotFoundError(f"vendored modeling_openjev.py not found at {path}")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != VENDORED_MODELING_SHA256:
        raise RuntimeError(
            f"vendored modeling_openjev.py digest mismatch: expected "
            f"{VENDORED_MODELING_SHA256}, found {digest}. Refusing to load remote code "
            "that changed under the pin (vendor/PROVENANCE.md explains the refresh)."
        )
    spec = importlib.util.spec_from_file_location("modeling_openjev", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not import {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def ensure_local(spec: ModelSpec, model_dir: str, token: Optional[str], allow_unpinned: bool) -> str:
    """Materialise ONE checkpoint on disk and return the directory to load.

    The repository is ~87.6 GB in total — four checkpoints, per-task MLP heads,
    training code and replay videos — and we want one ~8.5 GiB subfolder.
    `allow_patterns` is therefore explicit and subfolder-scoped:
    `huggingface_hub` matches with `fnmatch`, where `*` also matches `/`, so
    `*.json` is not the filter it looks like; it would pull every other
    checkpoint's config too. Verify with `find /models -type f` after a first
    boot, as `services/laya-engine` learned to.

    `local_dir` keeps the tree as real files rather than blob symlinks, and
    `revision` is the pinned commit — never `main`.
    """
    if spec.is_local:
        path = os.path.join(spec.repo, spec.subfolder) if spec.subfolder else spec.repo
        if not os.path.isdir(path):
            raise FileNotFoundError(f"local checkpoint not found: {path}")
        return path

    if not spec.revision and not allow_unpinned:
        raise RuntimeError(
            f"model {spec.name!r} ({spec.source}) has no pinned revision. Weights and "
            "remote code that track a moving branch can change between two identical "
            "deployments; pin `@<commit-sha>` in OPENJEV_MODELS, or set "
            "OPENJEV_ALLOW_UNPINNED=1 deliberately."
        )

    from huggingface_hub import snapshot_download

    patterns = [f"{spec.subfolder}/*"] if spec.subfolder else ["*.json", "*.safetensors"]
    root = snapshot_download(
        spec.repo,
        revision=spec.revision,
        allow_patterns=patterns,
        local_dir=os.path.join(model_dir, spec.name),
        token=token,
    )
    return os.path.join(root, spec.subfolder) if spec.subfolder else root


def _is_oom(exc: BaseException) -> bool:
    if isinstance(exc, torch.cuda.OutOfMemoryError):
        return True
    text = str(exc).lower()
    return isinstance(exc, RuntimeError) and ("out of memory" in text or "cuda error" in text)


class ModelHandle:
    """One loaded checkpoint plus everything `/health` and `/v1/models` report."""

    def __init__(self, spec: ModelSpec, settings: Settings) -> None:
        self.spec = spec
        self.settings = settings
        self.encoder: Any = None
        self.error: Optional[str] = None
        self.local_path: Optional[str] = None
        self.load_seconds: Optional[float] = None
        self.requested_device = settings.device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.cpu_fallback = False
        self.cpu_fallback_reason: Optional[str] = None
        self.chunk = max(1, settings.hypothesis_chunk)
        self.chunk_reductions = 0
        self.predictions = 0
        # RLock, and it guards the WHOLE of a `predict` call rather than just
        # the forward pass. Three pieces of state are shared and mutable:
        #
        # 1. the fast tokeniser. It is Rust-backed and keeps truncation/padding
        #    state ON THE SHARED OBJECT; every `tok(...)` call goes through
        #    `set_truncation_and_padding`, which takes a RefCell-style mutable
        #    borrow. Two threads tokenising at once raise
        #    `RuntimeError: Already borrowed` — and FastAPI runs sync endpoint
        #    bodies in a threadpool, so ANY concurrent traffic reaches it. This
        #    cost an eval run: 85 of 86 routes failed while /health stayed
        #    green, because the container was perfectly healthy and only the
        #    requests were dying.
        # 2. `encoder.max_len`, which this engine sets per request.
        # 3. the CUDA context and the model itself.
        #
        # Locking only the forward pass was the bug: `_plan` tokenises outside
        # it (hypothesis lengths, template cost, the state decode) and so does
        # the vendored `predict_hypotheses` internally. The honest critical
        # section is the request, not the matmul. It costs almost nothing:
        # a 4B forward pass dominates by orders of magnitude and was already
        # serial, so this converts an invisible race into a visible queue —
        # reported as `engine.queue_ms`.
        self.lock = threading.RLock()

    # ── lifecycle ────────────────────────────────────────────────────────────

    def load(self) -> None:
        """Load the checkpoint. Failure is recorded, never raised: a missing or
        broken checkpoint must degrade `/health`, not crash-loop the container."""
        started = time.monotonic()
        try:
            modeling = load_vendored_modeling(os.environ.get("OPENJEV_VENDOR_DIR") or None)
            self.local_path = ensure_local(
                self.spec,
                self.settings.model_dir,
                self.settings.hf_token,
                self.settings.allow_unpinned,
            )
            device = self.requested_device
            dtype = self._resolve_dtype(device)
            # The snapshot directory already IS the subfolder, so `subfolder`
            # is folded into the path rather than passed twice.
            encoder = modeling.OpenJevCrossEncoder(
                self.local_path,
                subfolder=None,
                device=device,
                dtype=dtype,
                bs=self.settings.batch_size,
                max_len=self.max_len,
            )
            self.encoder = encoder
            self.error = None
            if str(device).startswith("cuda") and not str(encoder.device).startswith("cuda"):
                self.cpu_fallback = True
                self.cpu_fallback_reason = "checkpoint could not be placed on CUDA at load"
        except Exception as exc:  # noqa: BLE001 — degrade, do not crash
            self.encoder = None
            self.error = f"{type(exc).__name__}: {exc}"
            traceback.print_exc()
        finally:
            self.load_seconds = round(time.monotonic() - started, 3)

    def _resolve_dtype(self, device: str) -> torch.dtype:
        configured = (self.settings.dtype or "").strip().lower()
        if configured:
            resolved = getattr(torch, configured, None)
            if isinstance(resolved, torch.dtype):
                return resolved
        if str(device).startswith("cuda"):
            # The checkpoint is STORED bf16 and both estate architectures
            # (sm_86 Ampere, sm_89 Ada) have native bf16 tensor cores, so this
            # is a load in the trained dtype, not a cast: ~8.5 GiB of weights
            # against 48 GB of card.
            return torch.bfloat16
        # bf16 on CPU is emulated and pathologically slow; a CPU deployment or
        # a post-OOM fallback runs float32.
        return torch.float32

    @property
    def loaded(self) -> bool:
        return self.encoder is not None

    @property
    def max_len(self) -> int:
        return self.settings.max_len_override or DEFAULT_MAX_LEN

    @property
    def max_position_embeddings(self) -> Optional[int]:
        if self.encoder is None:
            return None
        try:
            return int(self.encoder.model.config.get_text_config().max_position_embeddings)
        except Exception:  # noqa: BLE001 — a diagnostic, never load-bearing
            return None

    def describe(self) -> Dict[str, Any]:
        """The `/v1/models` record.

        The three capability fields of SSO §11.4 are reported HONESTLY from what
        this engine does, because the façade drives itself off them and must
        never branch on an engine's name:

        * `scores_options_independently: true` — each option is its own
          sequence, so there is no shared head budget;
        * `option_max_len: null` — no per-option cap ⇒ the façade must SKIP
          rubric compression;
        * `head_max_len: null` — no head budget ⇒ shortlisting is cost control,
          not correctness.

        `max_len` is real and still bounds the premise, so state windowing stays
        live for 25k-token compaction states. It is the model card's 4k context
        and the vendored class's own ceiling — NOT `max_position_embeddings`
        (262,144), which is the backbone's claim rather than a budget this
        checkpoint was trained to judge at. Reporting the larger number would
        hand the façade a lie it would act on.
        """
        return {
            "id": self.spec.name,
            "source": self.spec.source,
            "revision": self.spec.revision,
            "revision_pinned": bool(self.spec.revision) or self.spec.is_local,
            "local_path": self.local_path,
            "loaded": self.loaded,
            "error": self.error,
            "device": str(self.encoder.device) if self.encoder else None,
            "dtype": str(getattr(self.encoder.model, "dtype", None)) if self.encoder else None,
            "architecture": "Qwen3_5ForSequenceClassification",
            "labels": list(LABELS),
            "nli_template": self.encoder.template if self.encoder else None,
            # ── §11.4 capability fields ──────────────────────────────────────
            "scores_options_independently": True,
            "option_max_len": None,
            "head_max_len": None,
            "max_len": self.max_len,
            "max_len_source": "env" if self.settings.max_len_override else "model_card",
            "max_position_embeddings": self.max_position_embeddings,
            # ── cost shape (§11.5) ───────────────────────────────────────────
            "hypothesis_chunk": self.chunk,
            "hypothesis_chunk_configured": self.settings.hypothesis_chunk,
            "chunk_reductions": self.chunk_reductions,
            "shared_prefix_min_hypotheses": 3,
            "noul_mode": self.settings.noul_mode,
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
        truncate_left: bool = False,
        noul_mode: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Answer every question: one shared-prefix batch per chunk of options."""
        if self.encoder is None:
            raise RequestError(
                "model_unavailable",
                f"model {self.spec.name!r} is not loaded: {self.error or 'unknown reason'}",
                status=503,
                model=self.spec.name,
            )
        enc = self.encoder
        tok = enc.tok
        eff_max_len = int(max_len or self.max_len)
        if eff_max_len < 64:
            raise RequestError("bad_budget", f"max_len ({eff_max_len}) is below the 64-token floor")
        mode = resolve_noul_mode(noul_mode, self.settings.noul_mode)

        state_text = serialize_state(state)

        answers: Dict[str, Any] = {}
        diagnostics: Dict[str, Any] = {}
        input_tokens = 0
        queued_at = time.monotonic()

        # EVERYTHING that touches the tokeniser, `encoder.max_len` or the GPU is
        # inside one critical section — see the lock's own comment. Tokenising
        # the state was outside it before, which was enough on its own to raise
        # `Already borrowed` against a concurrent request's `_score`.
        with self.lock:
            started_all = time.monotonic()
            queue_ms = (started_all - queued_at) * 1000.0
            enc.max_len = eff_max_len
            state_ids = tok(state_text, add_special_tokens=False)["input_ids"] if state_text else []

            for qid, qdef in questions.items():
                plan = self._plan(qid, qdef, state_ids, eff_max_len, truncate_left, tok)
                rows, cost = self._score(plan["premise"], plan["hypotheses"], tok, eff_max_len)
                self.predictions += 1
                input_tokens += cost["forward_tokens"]
                answers[qid] = decode(plan["type"], plan["keys"], rows, mode)
                diagnostics[qid] = {**plan["diagnostics"], **cost}

        total_ms = (time.monotonic() - started_all) * 1000.0
        return {
            "model": self.spec.name,
            "answers": answers,
            # What the ENGINE consumed. The shared prefix is prefilled once per
            # chunk, so this is prefix + suffixes — not the naive sum of whole
            # sequences, which is reported per question as
            # `sequence_tokens_naive`. The gap between the two IS the cost
            # argument of §11.5, so both are visible rather than one being
            # quietly substituted for the other.
            "usage": {"input_tokens": int(input_tokens), "output_tokens": 0},
            # INTEGER by contract: the façade reads `ms` as a u64.
            "ms": int(round(total_ms)),
            "engine": {
                "engine": "openjev",
                "model": self.spec.name,
                "revision": self.spec.revision,
                "device": str(enc.device),
                "dtype": str(getattr(enc.model, "dtype", None)),
                "max_len": eff_max_len,
                "scores_options_independently": True,
                "option_max_len": None,
                "head_max_len": None,
                "noul_mode": mode,
                "hypothesis_chunk": self.chunk,
                "hypotheses_scored": sum(d["hypotheses"] for d in diagnostics.values()),
                "questions_answered": len(answers),
                "ms_precise": round(total_ms, 3),
                # Time spent waiting for the model lock, i.e. behind another
                # request. `ms` deliberately excludes it — it is not work this
                # request caused — but hiding it entirely would make a queue
                # look like a slow model, so it is reported as its own number.
                "queue_ms": round(queue_ms, 3),
                "cpu_fallback": self.cpu_fallback,
                "cpu_fallback_reason": self.cpu_fallback_reason,
                "questions": diagnostics,
            },
        }

    # ── planning: hypotheses, premise budget, truncation ─────────────────────

    def _plan(
        self,
        qid: str,
        qdef: Dict[str, Any],
        state_ids: Sequence[int],
        max_len: int,
        truncate_left: bool,
        tok: Any,
    ) -> Dict[str, Any]:
        """Build the premise and hypotheses, fitting the PREMISE to the budget.

        The hypothesis is never truncated and the instructions are never
        truncated; only the state is, from whichever end the caller asks to
        keep. A question that cannot fit even with an empty state is refused
        (422) rather than guessed.
        """
        settings = self.settings
        qtype = qdef["type"]
        instructions = str(qdef.get("instructions", ""))
        per_question_left = bool(qdef.get("truncate_left", truncate_left))

        if qtype == "choice":
            keys, rendered = render_choice_options(
                qdef.get("criteria") or {},
                str(qdef.get("option_format") or settings.option_format),
            )
            template = str(qdef.get("hypothesis_template") or settings.choice_hypothesis)
            hypotheses = [template.format(option=o, instructions=instructions) for o in rendered]
            premise_template = str(qdef.get("premise_template") or settings.choice_premise)
        elif qtype == "score":
            keys = [str(level) for level in qdef.get("criteria") or []]
            template = str(qdef.get("hypothesis_template") or settings.score_hypothesis)
            hypotheses = [template.format(option=level, instructions=instructions) for level in keys]
            premise_template = str(qdef.get("premise_template") or settings.choice_premise)
        else:  # noul — the statement IS the hypothesis, so the premise is the state
            keys = []
            template = str(qdef.get("hypothesis_template") or settings.noul_hypothesis)
            hypotheses = [template.format(option=instructions, instructions=instructions)]
            premise_template = str(qdef.get("premise_template") or settings.noul_premise)

        if "{state}" not in premise_template:
            raise RequestError(
                "bad_premise_template",
                f"question {qid!r}: premise template must contain '{{state}}'",
                question=qid,
            )
        head_text, _, tail_text = premise_template.partition("{state}")
        head_text = head_text.format(instructions=instructions)
        tail_text = tail_text.format(instructions=instructions)

        wrapper = len(tok(self.encoder.template.format(premise="", hypothesis=""))["input_ids"])
        hyp_lens = [len(tok(h, add_special_tokens=False)["input_ids"]) for h in hypotheses]
        head_len = len(tok(head_text, add_special_tokens=False)["input_ids"]) if head_text else 0
        tail_len = len(tok(tail_text, add_special_tokens=False)["input_ids"]) if tail_text else 0
        budget = premise_budget(max_len, wrapper, max(hyp_lens), head_len, tail_len, SEQUENCE_MARGIN)
        if budget < MIN_STATE_TOKENS:
            raise RequestError(
                "question_unfittable",
                (
                    f"question {qid!r}: instructions plus the longest hypothesis need "
                    f"{max_len - budget} tokens of a {max_len}-token sequence, leaving "
                    f"{budget} for the state (floor {MIN_STATE_TOKENS}). Shorten the "
                    "instructions or the longest option, or raise max_len."
                ),
                status=422,
                question=qid,
                hypotheses=len(hypotheses),
                longest_hypothesis_tokens=max(hyp_lens),
                fixed_tokens=max_len - budget,
                max_len=max_len,
            )

        used = list(state_ids)
        truncated = len(used) > budget
        if truncated:
            used = used[-budget:] if per_question_left else used[:budget]
        state_text = tok.decode(used, skip_special_tokens=True) if used else ""
        premise = f"{head_text}{state_text}{tail_text}"

        return {
            "type": qtype,
            "keys": keys,
            "hypotheses": hypotheses,
            "premise": premise,
            "diagnostics": {
                "type": qtype,
                "hypotheses": len(hypotheses),
                "hypothesis_tokens_max": max(hyp_lens),
                "hypothesis_tokens_total": sum(hyp_lens),
                # Uncompressed and uncapped by design (§11.2). The zero is here
                # so an operator can SEE that nothing was amputated, rather than
                # having to infer it from the absence of a warning.
                "hypothesis_tokens_capped": 0,
                "instruction_tokens": head_len + tail_len,
                "state_tokens_total": len(state_ids),
                "state_tokens_used": len(used),
                "state_truncated": truncated,
                "truncate_left": per_question_left,
                "premise_budget_tokens": budget,
            },
        }

    # ── scoring ──────────────────────────────────────────────────────────────

    def _score(
        self, premise: str, hypotheses: List[str], tok: Any, max_len: int
    ) -> Tuple[np.ndarray, Dict[str, Any]]:
        """Score every hypothesis against the premise, chunked, with accounting.

        `predict_hypotheses` prefills the shared token prefix once and branches
        the KV cache and the recurrent linear-attention state across the batch,
        so k options cost one prefill plus k short suffixes rather than k full
        passes. The branched cache is what scales with the chunk — at a 3k-token
        premise the full-attention layers alone are ~100 MB per branch — which
        is why the chunk exists and why the model card warns to "split very
        large option sets into smaller calls".
        """
        texts = [
            self.encoder.template.format(premise=premise.strip(), hypothesis=h.strip())
            for h in hypotheses
        ]
        # One extra batch tokenisation per question, in exchange for an EXACT
        # `usage.input_tokens` rather than an estimate. The fast tokeniser runs
        # this in Rust in single-digit milliseconds against seconds of forward
        # pass, so the honesty is close to free.
        sequences = tok(texts, truncation=True, max_length=max_len)["input_ids"]
        naive_tokens = sum(len(s) for s in sequences)

        rows: List[np.ndarray] = []
        forward_tokens = 0
        prefix_tokens = 0
        chunks = 0
        started = time.monotonic()
        index = 0
        while index < len(hypotheses):
            size = max(1, self.chunk)
            batch = hypotheses[index : index + size]
            batch_seqs = sequences[index : index + size]
            rows.append(self._score_chunk(premise, batch))
            common = shared_prefix(batch_seqs)
            prefix_tokens += common
            forward_tokens += common + sum(len(s) - common for s in batch_seqs)
            chunks += 1
            index += len(batch)

        probs = np.concatenate(rows, 0) if len(rows) > 1 else rows[0]
        return probs, {
            "chunks": chunks,
            "chunk_size": self.chunk,
            "shared_prefix_tokens": prefix_tokens,
            "forward_tokens": forward_tokens,
            "sequence_tokens_naive": naive_tokens,
            "prefix_sharing_saved_tokens": naive_tokens - forward_tokens,
            "ms": round((time.monotonic() - started) * 1000.0, 3),
        }

    def _score_chunk(self, premise: str, hypotheses: List[str]) -> np.ndarray:
        """One `predict_hypotheses` call, bisecting on CUDA OOM, CPU last.

        Order matters: a smaller batch is a cheap and lossless fix for an OOM on
        a branched cache, while moving to CPU costs two orders of magnitude of
        latency. So the batch is halved first and the reduction STICKS (and is
        reported at `/health` as `chunk_reduced`), and CPU is the last resort —
        surfaced as data, never merely printed, because a silently halved
        throughput is an operational lie.
        """
        try:
            return np.asarray(
                self.encoder.predict_hypotheses(premise, hypotheses), dtype=np.float64
            )
        except Exception as exc:  # noqa: BLE001
            if not _is_oom(exc) or str(self.encoder.device).startswith("cpu"):
                raise
            torch.cuda.empty_cache()
            if len(hypotheses) > 1:
                half = max(1, len(hypotheses) // 2)
                if half < self.chunk:
                    self.chunk = half
                    self.chunk_reductions += 1
                left = self._score_chunk(premise, hypotheses[:half])
                right = self._score_chunk(premise, hypotheses[half:])
                return np.concatenate([left, right], 0)
            self._fall_back_to_cpu(exc)
            return np.asarray(
                self.encoder.predict_hypotheses(premise, hypotheses), dtype=np.float64
            )

    def _fall_back_to_cpu(self, exc: BaseException) -> None:
        enc = self.encoder
        enc.model.to("cpu", dtype=torch.float32)
        enc.device = "cpu"
        self.cpu_fallback = True
        self.cpu_fallback_reason = f"CUDA fallback during inference: {exc}"
        torch.cuda.empty_cache()


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

        `laya-*` is accepted so that repointing the façade at this engine is a
        one-variable change (`SSO_ENGINE_URL`) rather than a coordinated
        two-variable one — but every response names the model that really
        answered, so nothing downstream can be misled about which engine ran.
        """
        key = (name or "").strip()
        aliases = ("openjev-latest", "latest", "default", "jev-latest", "laya-latest",
                   "laya-typed-decisions")
        if not key or (key not in self.handles and key in aliases):
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
                        "allocated_mb": round(torch.cuda.memory_allocated(idx) / (1024 * 1024)),
                        "reserved_mb": round(torch.cuda.memory_reserved(idx) / (1024 * 1024)),
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
        reductions = {h.spec.name: h.chunk for h in self.handles.values() if h.chunk_reductions}
        if not loaded:
            status = "unavailable"
        elif failed or fallbacks:
            status = "degraded"
        else:
            status = "ok"
        default_handle = self.handles.get(self.settings.default_model)
        return {
            "status": status,
            "engine": "openjev",
            "models_loaded": sorted(h.spec.name for h in loaded),
            "models_failed": failed,
            # BOOLEAN by contract: the façade deserialises `cpu_fallback` as a
            # bool ("did the engine quietly halve its throughput?"). The reasons
            # are richer, so they get their own key rather than overloading this
            # one into a map the consumer cannot read.
            "cpu_fallback": bool(fallbacks),
            "cpu_fallback_detail": fallbacks,
            "chunk_reduced": reductions,
            # Flat `model`/`device` for the same consumer: it reports one
            # engine, and this is the one it will actually call.
            "model": self.settings.default_model,
            "device": str(default_handle.encoder.device)
            if default_handle is not None and default_handle.encoder is not None
            else None,
            "default_model": self.settings.default_model,
            "pinned_revision": PINNED_REVISION,
            "uptime_s": round(time.time() - self.started_at, 1),
            "gpu": self.cuda_state(),
        }
