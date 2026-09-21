"""`python -m laya_engine` — run the engine with uvicorn on the configured bind.

Single worker by design: the checkpoints are ~840 MB of GPU weights each, and a
second worker would double that for no throughput gain (the forward pass is
already batched across questions and serialised by a per-model lock).
"""

from __future__ import annotations

import logging

import uvicorn

from .config import Settings


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    settings = Settings.from_env()
    if settings.bind_host not in ("127.0.0.1", "localhost", "::1"):
        logging.getLogger("laya-engine").warning(
            "binding %s — the engine is designed to be reachable ONLY through the "
            "façade (SSO contract §1); a non-loopback bind is an ingress decision",
            settings.bind_host,
        )
    uvicorn.run(
        "laya_engine.app:app",
        host=settings.bind_host,
        port=settings.bind_port,
        workers=1,
        log_level="info",
        access_log=settings.request_log,
    )


if __name__ == "__main__":
    main()
