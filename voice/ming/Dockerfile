# Ming-3.0 speech sidecar (experimental) — SGLang-Omni serving inclusionAI/Ming-3.0-{tts,asr}.
#
# The base image ships CUDA, flash-attn, SGLang and UCX prebuilt, which avoids the
# JIT toolchain (nvcc, ninja, FlashInfer builds) that fails on the Nix host.
# `dev` is the only published tag and moves with main: after the first pull, pin
# it by digest in docker-compose.speech-ming.yml (MING_BASE_IMAGE).
ARG MING_BASE_IMAGE=hongccc/sglang-omni:dev
FROM ${MING_BASE_IMAGE}

ARG SGLANG_OMNI_VERSION=0.1.9
RUN pip install --no-cache-dir uv \
    && uv venv /opt/ming-venv -p 3.12 \
    && uv pip install --python /opt/ming-venv/bin/python --prerelease=allow \
       "sglang-omni==${SGLANG_OMNI_VERSION}"

ENV PATH=/opt/ming-venv/bin:$PATH \
    HF_HOME=/models/huggingface \
    HF_HUB_DISABLE_XET=1

EXPOSE 8000
# MING_MODEL selects the checkpoint (see docker-compose.speech-ming.yml).
CMD ["sh", "-c", "exec sgl-omni serve --model-path \"$MING_MODEL\" --host 0.0.0.0 --port 8000"]
