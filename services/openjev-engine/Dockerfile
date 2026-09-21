# openjev-engine — the second Sovereign System One engine (ADR-2094 / SSO §11).
#
#   systemone container : system-one-facade :8097 (published) + laya-engine 127.0.0.1:8098
#   openjev  container  : openjev-engine    127.0.0.1:8099 (SHARED netns, never published)
#
# WHY A SEPARATE IMAGE, when the brief said "extend the systemone Dockerfile":
# a hard dependency conflict, not a preference. `services/laya-engine` pins
# `transformers==4.52.4`; this checkpoint's config.json declares
# `"model_type": "qwen3_5"` and `"transformers_version": "5.15.0"`, and the
# `Qwen3_5ForSequenceClassification` class does not exist before transformers 5.
# One interpreter cannot hold both, so the two engines get one image each and
# share a network namespace via compose `network_mode: service:systemone` —
# which is also what preserves the contract's loopback-only bind across two
# containers. Both images share this base layer, so the second image costs the
# pip layer and the code, not another torch.
#
# GPU: the estate runs 1x RTX A6000 (sm_86, Ampere) and 2x RTX 6000 Ada
# (sm_89). The torch 2.7.1 + cu128 wheels in this base ship kernels for both
# and have native bf16, which is the checkpoint's stored dtype (~8.5 GiB).

ARG TORCH_IMAGE=pytorch/pytorch:2.7.1-cuda12.8-cudnn9-runtime

FROM ${TORCH_IMAGE} AS engine

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models/.hf \
    HF_HUB_DISABLE_TELEMETRY=1 \
    HF_XET_HIGH_PERFORMANCE=1 \
    OPENJEV_MODEL_DIR=/models \
    OPENJEV_BIND_HOST=127.0.0.1 \
    OPENJEV_PORT=8099

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/openjev
COPY requirements.txt /opt/openjev/requirements.txt
RUN pip install --no-cache-dir -r /opt/openjev/requirements.txt

# The vendored, digest-pinned upstream helper. It is COPIED, never downloaded:
# a build that fetches `modeling_openjev.py` from the repository's default
# branch is a build whose code can change between two identical invocations.
# `openjev_engine.runtime.load_vendored_modeling` verifies the sha256 in
# `config.VENDORED_MODELING_SHA256` before importing it. See vendor/PROVENANCE.md.
COPY vendor /opt/openjev/vendor
COPY openjev_engine /opt/openjev/openjev_engine
COPY tests /opt/openjev/tests
COPY entrypoint.sh /opt/openjev/entrypoint.sh
RUN chmod +x /opt/openjev/entrypoint.sh && mkdir -p /models

ENV PYTHONPATH=/opt/openjev
# Weights are a volume, not a layer: ~8.5 GiB for the one subfolder we want out
# of an ~87.6 GB repository. Baking them would make every code change an 8.5 GiB
# push, and the volume is separate from the laya weights so neither engine's
# lifecycle can evict the other's download.
VOLUME ["/models"]

EXPOSE 8099
HEALTHCHECK --interval=15s --timeout=10s --start-period=1800s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8099/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/opt/openjev/entrypoint.sh"]
