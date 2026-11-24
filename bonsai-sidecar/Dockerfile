# Ternary Bonsai sidecar — PrismML llama.cpp fork (PTQ1_0 ternary quant) as an
# OpenAI-compatible llama-server. Stock llama.cpp cannot load PTQ1_0 GGUFs, hence the
# fork. The model is NOT baked in: it is bind-mounted read-only at /models.
#
# CUDA arch is a build arg: 75 = Turing (HP's 2x Quadro RTX 6000, the current home),
# 86 = Ampere (A6000), 89 = Ada (RTX 6000 Ada). Rebuild with BONSAI_CUDA_ARCH to move it.
ARG CUDA_VERSION=13.3.0

FROM nvidia/cuda:${CUDA_VERSION}-devel-ubuntu24.04 AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
        git cmake ninja-build build-essential curl ca-certificates libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/*
# Tag named on the AtomicChat Ternary-Bonsai-2.5-27B-Uncensored model card.
ARG PRISM_TAG=prism-b12128-d7b2896
ARG CUDA_ARCH=75
RUN git clone --depth 1 --branch ${PRISM_TAG} https://github.com/PrismML-Eng/llama.cpp /src
# The fork expects a UI bundle layout that the "latest" prebuilt download no longer matches;
# this sidecar is API-only, so build without the embedded web UI.
RUN cmake -S /src -B /src/build -G Ninja -DCMAKE_BUILD_TYPE=Release \
        -DGGML_CUDA=ON "-DCMAKE_CUDA_ARCHITECTURES=${CUDA_ARCH}" -DGGML_NATIVE=OFF \
        -DBUILD_SHARED_LIBS=OFF -DLLAMA_USE_PREBUILT_UI=OFF \
    && cmake --build /src/build --target llama-server llama-cli -j

FROM nvidia/cuda:${CUDA_VERSION}-runtime-ubuntu24.04
RUN apt-get update && apt-get install -y --no-install-recommends curl libcurl4t64 libgomp1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/build/bin/llama-server /src/build/bin/llama-cli /usr/local/bin/
ENTRYPOINT ["/usr/local/bin/llama-server"]
