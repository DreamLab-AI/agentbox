"""openjev-engine — the second local typed-decision engine behind the Sovereign
System One façade (ADR-2094 / SSO contract §11).

ONE responsibility: load the openjev NLI cross-encoder and answer
`POST /predict`. It binds loopback only; the façade is the sole ingress.

Why a second engine: laya scores every option against ONE shared head budget,
so more candidates improve discrimination and destroy the decline behaviour —
measured, 2026-09-20, `none` collapsed 35.7% → 7.1% when the head budget was
raised. openjev scores each option in its own sequence, which turns `none` from
a competitor into a threshold the façade applies to honest entailment scores.
"""

from .config import (
    PINNED_REVISION,
    VENDORED_MODELING_SHA256,
    ModelSpec,
    Settings,
    parse_models,
)
from .primitives import (
    LABELS,
    NOUL_MODES,
    RequestError,
    confidence_from_probs,
    decode,
    decode_choice,
    decode_noul,
    decode_score,
    premise_budget,
    render_choice_options,
    serialize_state,
    shared_prefix,
    validate_questions,
)

__all__ = [
    "PINNED_REVISION",
    "VENDORED_MODELING_SHA256",
    "ModelSpec",
    "Settings",
    "parse_models",
    "LABELS",
    "NOUL_MODES",
    "RequestError",
    "confidence_from_probs",
    "decode",
    "decode_choice",
    "decode_noul",
    "decode_score",
    "premise_budget",
    "render_choice_options",
    "serialize_state",
    "shared_prefix",
    "validate_questions",
    "__version__",
]

__version__ = "1.0.0"
