"""Environment-driven configuration for the openjev engine.

Every knob is an environment variable so the image stays a constant and the
deployment (`docker-compose.system-one.yml`, `./agentbox.sh systemone`) owns the
values. Nothing here reads `agentbox.toml`: the manifest is projected into the
environment by `services/agentbox-manifest` at boot and this process is
downstream of that — the same contract `services/laya-engine` keeps.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import List, Optional, Tuple

#: The upstream commit this engine is built against. Weights are downloaded
#: with `revision=` set to it and the vendored `modeling_openjev.py` is the file
#: at this commit. **Never track `main`**: the repository is days old and its
#: default branch moves, so an unpinned fetch is a silent code swap between two
#: identical `docker compose up` runs. See `vendor/PROVENANCE.md`.
PINNED_REVISION = "4395b29714015162db6112de91c35688e6e42717"

#: sha256 of `vendor/modeling_openjev.py` at :data:`PINNED_REVISION`.
#: `tests/test_vendor.py` and the engine's startup check both verify it.
VENDORED_MODELING_SHA256 = "071670d0879963ee69600ed31f0f3d5a37bee314461709477e8ac0e25f33fd97"

#: The recommended v2 4B checkpoint. The 35B-A3B MoE sibling in the same repo is
#: deliberately out of scope (SSO contract §11.1) and needs a different modeling
#: module, so naming it here would not be enough to serve it.
DEFAULT_MODELS = f"openjev=AlexWortega/openjev:qwen3.5-4b-nli-v2@{PINNED_REVISION}"

#: `OpenJevCrossEncoder`'s own ceiling, and the context the model card states.
#: `max_position_embeddings` is 262,144, which is the *backbone's* claim and not
#: a budget this checkpoint was trained to judge at — reporting that number at
#: `/v1/models` would hand the façade a lie it would act on.
DEFAULT_MAX_LEN = 4096

#: Hypotheses scored per forward pass. The shared prefix is prefilled once per
#: chunk, so a smaller chunk costs one extra prefill and saves branched-cache
#: memory proportional to the chunk size. The model card's own warning: "split
#: very large option sets into smaller calls".
DEFAULT_HYP_CHUNK = 32

#: Pair batch size for the non-shared-prefix path (one or two hypotheses).
DEFAULT_BATCH_SIZE = 8

#: How a `noul` probability is read off the three NLI classes.
#: ``entailment``    → ``P(ent)``  (the default; a plain read of the head)
#: ``ent_vs_contra`` → ``P(ent) / (P(ent) + P(con))`` (neutral mass excluded)
#: Which is better is a MEASUREMENT, not a preference (SSO contract §11.2), so
#: the engine always reports BOTH values and this setting only decides which one
#: lands in the `noul` field the façade reads.
NOUL_MODES = ("entailment", "ent_vs_contra")

#: Hypothesis rendering. `{option}` is the rendered option, `{instructions}` the
#: question prompt. The choice default is the model card's verified `rerank`
#: format, which is the phrasing the checkpoint was evaluated with.
DEFAULT_CHOICE_HYPOTHESIS = "The correct answer is: {option}"
DEFAULT_SCORE_HYPOTHESIS = "The correct answer is: {option}"
DEFAULT_NOUL_HYPOTHESIS = "{instructions}"

#: How a choice option key and its rubric become one hypothesis string.
#: Rubrics are NOT compressed and NOT capped here: there is no shared head
#: budget to protect (SSO contract §11.2), which is the entire reason this
#: engine exists alongside laya.
DEFAULT_OPTION_FORMAT = "{key}: {rubric}"

#: Premise rendering per question type. Only `{state}` is truncated when the
#: sequence does not fit; the instructions always survive, because an amputated
#: question is a wrong answer rather than a cheap one.
DEFAULT_CHOICE_PREMISE = "{instructions}\n\n{state}"
DEFAULT_NOUL_PREMISE = "{state}"


def _env_int(name: str, default: Optional[int]) -> Optional[int]:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


def _env_str(name: str, default: str) -> str:
    raw = os.environ.get(name, "")
    # A deliberately empty template is meaningless, so blank means "default".
    return raw if raw.strip() else default


@dataclass(frozen=True)
class ModelSpec:
    """One servable checkpoint.

    `repo` is a Hugging Face repo id or an absolute local path, `subfolder`
    selects one checkpoint out of a repo that bundles several (this one bundles
    four), and `revision` pins the commit. A spec with no revision is refused at
    load time unless `OPENJEV_ALLOW_UNPINNED=1`.
    """

    name: str
    repo: str
    subfolder: Optional[str] = None
    revision: Optional[str] = None

    @property
    def source(self) -> str:
        base = f"{self.repo}:{self.subfolder}" if self.subfolder else self.repo
        return f"{base}@{self.revision}" if self.revision else base

    @property
    def is_local(self) -> bool:
        return self.repo.startswith("/") or self.repo.startswith("./")


def parse_models(raw: str) -> List[ModelSpec]:
    """Parse `OPENJEV_MODELS`: `name=repo[:subfolder][@revision]`, comma separated.

    A bare `repo[:subfolder][@revision]` is allowed and names itself after the
    subfolder (or the repo's last path segment).
    """
    specs: List[ModelSpec] = []
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        name, _, source = chunk.partition("=")
        if not source:
            source, name = name, ""
        source = source.strip()
        source, revision = _split_revision(source)
        repo, subfolder = _split_source(source)
        if not name:
            name = subfolder or repo.rstrip("/").split("/")[-1]
        specs.append(
            ModelSpec(name=name.strip(), repo=repo, subfolder=subfolder, revision=revision)
        )
    return specs


def _split_revision(source: str) -> Tuple[str, Optional[str]]:
    base, sep, rev = source.rpartition("@")
    if not sep:
        return source, None
    return base, rev.strip() or None


def _split_source(source: str) -> Tuple[str, Optional[str]]:
    """Split `repo[:subfolder]`, tolerating absolute local paths."""
    if source.startswith("/") or source.startswith("./"):
        path, sep, sub = source.rpartition("::")
        return (path, sub) if sep else (source, None)
    repo, sep, sub = source.partition(":")
    return (repo, sub or None) if sep else (source, None)


@dataclass(frozen=True)
class Settings:
    """Resolved engine settings."""

    models: List[ModelSpec]
    default_model: str
    device: Optional[str]
    dtype: Optional[str]
    model_dir: str
    hf_token: Optional[str]
    allow_unpinned: bool
    max_len_override: Optional[int]
    hypothesis_chunk: int
    batch_size: int
    noul_mode: str
    choice_hypothesis: str
    score_hypothesis: str
    noul_hypothesis: str
    option_format: str
    choice_premise: str
    noul_premise: str
    bind_host: str
    bind_port: int
    max_questions: int
    max_options: int
    request_log: bool

    @classmethod
    def from_env(cls) -> "Settings":
        models = parse_models(os.environ.get("OPENJEV_MODELS", DEFAULT_MODELS))
        default_model = os.environ.get("OPENJEV_DEFAULT_MODEL", "").strip()
        if not default_model:
            default_model = models[0].name if models else ""
        noul_mode = os.environ.get("OPENJEV_NOUL_MODE", "").strip().lower() or NOUL_MODES[0]
        if noul_mode not in NOUL_MODES:
            noul_mode = NOUL_MODES[0]
        return cls(
            models=models,
            default_model=default_model,
            device=os.environ.get("OPENJEV_DEVICE", "").strip() or None,
            # bf16 is the checkpoint's stored dtype and both estate card
            # generations (sm_86 Ampere, sm_89 Ada) have native bf16; float32
            # would double the 9 GB for nothing. On CPU the runtime overrides
            # this to float32, where bf16 is emulated and pathologically slow.
            dtype=os.environ.get("OPENJEV_DTYPE", "").strip() or None,
            model_dir=os.environ.get("OPENJEV_MODEL_DIR", "/models").strip() or "/models",
            hf_token=os.environ.get("HF_TOKEN", "").strip() or None,
            allow_unpinned=_env_bool("OPENJEV_ALLOW_UNPINNED", False),
            max_len_override=_env_int("OPENJEV_MAX_LEN", None),
            hypothesis_chunk=_env_int("OPENJEV_HYP_CHUNK", DEFAULT_HYP_CHUNK) or DEFAULT_HYP_CHUNK,
            batch_size=_env_int("OPENJEV_BATCH_SIZE", DEFAULT_BATCH_SIZE) or DEFAULT_BATCH_SIZE,
            noul_mode=noul_mode,
            choice_hypothesis=_env_str("OPENJEV_CHOICE_HYPOTHESIS", DEFAULT_CHOICE_HYPOTHESIS),
            score_hypothesis=_env_str("OPENJEV_SCORE_HYPOTHESIS", DEFAULT_SCORE_HYPOTHESIS),
            noul_hypothesis=_env_str("OPENJEV_NOUL_HYPOTHESIS", DEFAULT_NOUL_HYPOTHESIS),
            option_format=_env_str("OPENJEV_OPTION_FORMAT", DEFAULT_OPTION_FORMAT),
            choice_premise=_env_str("OPENJEV_CHOICE_PREMISE", DEFAULT_CHOICE_PREMISE),
            noul_premise=_env_str("OPENJEV_NOUL_PREMISE", DEFAULT_NOUL_PREMISE),
            # LOOPBACK ONLY by default and by contract (SSO §1): the façade is
            # the sole ingress. The compose service shares the façade
            # container's network namespace precisely so that this default can
            # stay true across two containers.
            bind_host=os.environ.get("OPENJEV_BIND_HOST", "127.0.0.1").strip() or "127.0.0.1",
            bind_port=_env_int("OPENJEV_PORT", 8099) or 8099,
            max_questions=_env_int("OPENJEV_MAX_QUESTIONS", 64) or 64,
            # 116 skill rubrics is the real workload; the cap exists so a
            # malformed request cannot ask for 100,000 forward passes.
            max_options=_env_int("OPENJEV_MAX_OPTIONS", 512) or 512,
            request_log=_env_bool("OPENJEV_REQUEST_LOG", False),
        )
