"""laya-engine — the local typed-decision engine behind the Sovereign System One façade.

ONE responsibility (ADR-2094 §5 / SSO contract §5): load the laya checkpoints and
answer `POST /predict`. It binds loopback only; the façade is the sole ingress.
"""

from .config import ModelSpec, Settings, parse_models
from .runtime import OPTION_TOKEN_CAP, Registry, RequestError, validate_questions

__all__ = [
    "ModelSpec",
    "Settings",
    "parse_models",
    "OPTION_TOKEN_CAP",
    "Registry",
    "RequestError",
    "validate_questions",
    "__version__",
]

__version__ = "1.0.0"
