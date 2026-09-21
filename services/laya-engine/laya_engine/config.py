"""Environment-driven configuration for the laya engine.

Every knob is an environment variable so the container image stays a constant
and the deployment (compose, `agentbox.sh systemone`) owns the values. Nothing
here reads `agentbox.toml`: the manifest is projected into the environment by
`services/agentbox-manifest` at boot, and this process is downstream of that.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import List, Optional, Tuple


def _env_int(name: str, default: Optional[int]) -> Optional[int]:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


@dataclass(frozen=True)
class ModelSpec:
    """One servable checkpoint.

    `repo` is a Hugging Face repo id or an absolute local path; `subfolder`
    selects one checkpoint out of a repo that bundles several (the English
    `convaiinnovations/laya` repo bundles `typed-decisions` and `multilingual`).
    """

    name: str
    repo: str
    subfolder: Optional[str] = None

    @property
    def source(self) -> str:
        return f"{self.repo}:{self.subfolder}" if self.subfolder else self.repo


def parse_models(raw: str) -> List[ModelSpec]:
    """Parse `LAYA_MODELS`: `name=repo[:subfolder]` pairs, comma separated.

    A bare `repo[:subfolder]` is allowed and names itself after the subfolder
    (or the repo's last path segment).
    """
    specs: List[ModelSpec] = []
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        name, _, source = chunk.partition("=")
        if not source:
            source, name = name, ""
        repo, subfolder = _split_source(source.strip())
        if not name:
            name = subfolder or repo.rstrip("/").split("/")[-1]
        specs.append(ModelSpec(name=name.strip(), repo=repo, subfolder=subfolder))
    return specs


def _split_source(source: str) -> Tuple[str, Optional[str]]:
    """Split `repo[:subfolder]`, tolerating Windows-style and absolute paths."""
    if source.startswith("/") or source.startswith("./"):
        # A local path may itself contain a colon only by accident; treat the
        # whole thing as the path unless a trailing `::subfolder` is given.
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
    model_dir: str
    hf_token: Optional[str]
    max_len_override: Optional[int]
    head_max_len_override: Optional[int]
    bind_host: str
    bind_port: int
    max_questions: int
    request_log: bool

    @classmethod
    def from_env(cls) -> "Settings":
        models = parse_models(
            os.environ.get(
                "LAYA_MODELS",
                # English deployment (contract §5). Both checkpoints live in one
                # repo, so the two entries share a single download.
                "laya-typed-decisions=convaiinnovations/laya:typed-decisions,"
                "laya=convaiinnovations/laya",
            )
        )
        default_model = os.environ.get("LAYA_DEFAULT_MODEL", "").strip()
        if not default_model:
            default_model = models[0].name if models else ""
        device = os.environ.get("LAYA_DEVICE", "").strip() or None
        return cls(
            models=models,
            default_model=default_model,
            device=device,
            model_dir=os.environ.get("LAYA_MODEL_DIR", "/models").strip() or "/models",
            hf_token=os.environ.get("HF_TOKEN", "").strip() or None,
            # Raising these departs from the training distribution, so it is a
            # measured operator choice (ADR-2094 addendum §4) — never a default.
            max_len_override=_env_int("LAYA_MAX_LEN", None),
            head_max_len_override=_env_int("LAYA_HEAD_MAX_LEN", None),
            # LOOPBACK ONLY by default and by contract: the façade is the sole
            # ingress. Overriding this is a deliberate act with a security cost.
            bind_host=os.environ.get("LAYA_BIND_HOST", "127.0.0.1").strip() or "127.0.0.1",
            bind_port=_env_int("LAYA_PORT", 8098) or 8098,
            max_questions=_env_int("LAYA_MAX_QUESTIONS", 64) or 64,
            request_log=os.environ.get("LAYA_REQUEST_LOG", "0").strip() in ("1", "true", "yes"),
        )
