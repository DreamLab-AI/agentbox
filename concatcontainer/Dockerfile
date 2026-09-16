# Concat headless engine sidecar — EXPERIMENTAL, un-ADR'd.
#
# Builds ONLY `concat-cli` from the Concat workspace: the headless driver whose
# `api` subcommand speaks the Concat API as line-delimited JSON on stdin/stdout.
# The editor window (`-p concat`, Slint) is deliberately NOT built — the whole
# point of this sidecar is the transport, and the window would drag in a GUI
# toolkit for nothing.
#
# LICENCE POSITION. Concat is AGPL-3.0-or-later. This image contains Concat
# itself, so the AGPL applies to it in full, including the section 13
# source-offer if the sidecar is ever made available over a network. The
# complete corresponding source for the exact pinned revision is kept in the
# runtime image at /usr/local/src/concat-src.tar.gz — do not strip it. Agentbox
# code that drives this container stays an Independent Module under the Concat
# Plugin Exception v1.0 ONLY while it talks through the API/IPC surface: a
# subprocess over stdio is fine, adding `concat-api` to a Cargo.toml is not.

ARG CONCAT_REV=042688f53834b0a440228198be7fa3de27ad2cc3
ARG RUST_IMAGE=rust:1.93-trixie

# ---------------------------------------------------------------------------
FROM ${RUST_IMAGE} AS builder
ARG CONCAT_REV

# FFmpeg 7+ development libraries (concat-media links them through
# ffmpeg-the-third via pkg-config), plus cmake and a C++ compiler: whisper.cpp
# is built from source by whisper-rs, and ONNX Runtime arrives through `ort`.
RUN apt-get update && apt-get install -y --no-install-recommends \
        pkg-config cmake clang libclang-dev git ca-certificates \
        libavcodec-dev libavformat-dev libavfilter-dev libavdevice-dev \
        libavutil-dev libswscale-dev libswresample-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --filter=blob:none https://github.com/jub0t/Concat.git . \
    && git checkout --detach "${CONCAT_REV}" \
    && git rev-parse HEAD > /tmp/concat-rev

# The AGPL source offer travels with the binary, not with our goodwill.
RUN git archive --format=tar --prefix="concat-${CONCAT_REV}/" HEAD \
    | gzip -9 > /tmp/concat-src.tar.gz

# The GPU compositor (concat-render's `gpu` feature, wgpu) is left off: the CPU
# compositor is the reference implementation the GPU one must match, so a
# headless export is correct either way, and the wgpu tree is large. Turning it
# on is a scoping question for the ADR, not a default.
# --locked, not a fallback: engine/Cargo.lock is committed upstream, so the
# dependency graph is pinned by the revision. A `|| cargo build` fallback would
# quietly resolve fresh versions the day the lockfile stopped applying, which is
# the opposite of what pinning CONCAT_REV is for — fail loudly instead.
WORKDIR /src/engine
RUN cargo build --release --locked -p concat-cli

# ---------------------------------------------------------------------------
FROM debian:trixie-slim
ARG CONCAT_REV

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates tini \
        libavcodec61 libavformat61 libavfilter10 libavdevice61 \
        libavutil59 libswscale8 libswresample5 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1000 -s /bin/bash devuser

COPY --from=builder /src/engine/target/release/concat-cli /usr/local/bin/concat-cli
COPY --from=builder /tmp/concat-src.tar.gz /usr/local/src/concat-src.tar.gz
COPY --from=builder /tmp/concat-rev /usr/local/src/concat-rev

LABEL org.opencontainers.image.title="concatcontainer" \
      org.opencontainers.image.description="Headless Concat engine (concat-cli api) for agentbox" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.source="https://github.com/jub0t/Concat" \
      uk.dreamlab.agentbox.experimental="true" \
      uk.dreamlab.agentbox.adr="pending"

USER devuser
ENV HOME=/home/devuser \
    CONCAT_PROJECTS=/home/devuser/projects \
    XDG_DATA_HOME=/home/devuser/.local/share
RUN mkdir -p /home/devuser/projects /home/devuser/.local/share

# There is no daemon yet — the API's only transport today is stdin/stdout, so
# the container idles and callers pipe JSON in through `docker exec -i`. A
# socket or MCP transport is exactly what the ADR has to scope; inventing one
# here would prejudge it.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sleep", "infinity"]
