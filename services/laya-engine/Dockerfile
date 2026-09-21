# Sovereign System One sidecar — one container, two processes (ADR-2094 §1).
#
#   system-one-facade (Rust)  :8097  published on visionclaw_network
#   laya-engine       (Python) 127.0.0.1:8098  loopback ONLY, never published
#
# Build contexts (compose `additional_contexts`):
#   .       → services/laya-engine   (this tree)
#   crates  → crates/system-one      (the Rust workspace)
# The repo root is deliberately NOT the context: it carries node_modules/,
# target/ and result/, and tarring it client-side would dwarf the build.
#
# GPU: the estate runs 1x RTX A6000 (sm_86, Ampere) and 2x RTX 6000 Ada
# (sm_89). The torch 2.7.1 + cu128 wheels in this base ship kernels for both,
# so no source build and no `TORCH_CUDA_ARCH_LIST` gymnastics. Do NOT "upgrade"
# to a Blackwell-only nightly: these cards are not Blackwell.

ARG TORCH_IMAGE=pytorch/pytorch:2.7.1-cuda12.8-cudnn9-runtime
ARG RUST_IMAGE=rust:1.90-bullseye

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — the Rust façade and the eval rig.
#
# glibc: VERIFIED, not assumed — pytorch/pytorch:2.7.1-cuda12.8-cudnn9-runtime is
# Ubuntu 22.04 with glibc 2.35 (`ldd --version` in the built image), so the
# builder must be OLDER: bullseye is 2.31. bookworm (2.36) would compile
# happily and then fail at exec with a GLIBC_2.36-not-found, which is the
# expensive way to learn the base image's release.
# ─────────────────────────────────────────────────────────────────────────────
FROM ${RUST_IMAGE} AS facade-builder

WORKDIR /build
# reqwest is built with rustls (workspace feature set), so no OpenSSL here.
COPY --from=crates . /build/system-one
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/build/system-one/target,sharing=locked \
    cargo build --release --manifest-path /build/system-one/Cargo.toml \
        --bin system-one-facade --bin system-one-eval \
    && mkdir -p /out \
    && cp /build/system-one/target/release/system-one-facade \
          /build/system-one/target/release/system-one-eval /out/

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — the Python engine. Complete and testable on its own:
#   docker build --target engine -t laya-engine:dev .
# builds and runs the engine without the Rust workspace, which is how the
# engine is verified while the façade crate is still landing.
# ─────────────────────────────────────────────────────────────────────────────
FROM ${TORCH_IMAGE} AS engine

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models/.hf \
    HF_HUB_DISABLE_TELEMETRY=1 \
    LAYA_MODEL_DIR=/models \
    LAYA_BIND_HOST=127.0.0.1 \
    LAYA_PORT=8098

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/systemone
COPY requirements.txt /opt/systemone/requirements.txt
RUN pip install --no-cache-dir -r /opt/systemone/requirements.txt

COPY laya_engine /opt/systemone/laya_engine
COPY entrypoint.sh /opt/systemone/entrypoint.sh
RUN chmod +x /opt/systemone/entrypoint.sh && mkdir -p /models /models/.sso-cache

ENV PYTHONPATH=/opt/systemone
# Weights are a volume, not a layer: ~843 MB per checkpoint, and baking them
# would make every code change a 1.7 GB push.
VOLUME ["/models"]

EXPOSE 8098
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/opt/systemone/entrypoint.sh", "engine"]

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3 — the shipped image: engine + façade, supervised together.
# ─────────────────────────────────────────────────────────────────────────────
FROM engine AS runtime

COPY --from=facade-builder /out/system-one-facade /opt/systemone/bin/system-one-facade
COPY --from=facade-builder /out/system-one-eval /opt/systemone/bin/system-one-eval
ENV PATH=/opt/systemone/bin:$PATH \
    SSO_BIND=0.0.0.0:8097 \
    SSO_ENGINE_URL=http://127.0.0.1:8098 \
    SSO_CACHE_PATH=/models/.sso-cache/embeddings.jsonl

EXPOSE 8097
HEALTHCHECK --interval=15s --timeout=10s --start-period=300s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8097/health || exit 1

CMD ["/opt/systemone/entrypoint.sh", "both"]
