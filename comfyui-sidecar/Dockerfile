# CUDA 13.0 devel base (nvcc 13.0.3; tag and manifest-list digest from the Docker Hub registry API,
# 2026-10-30). The runtime still comes from the torch cu130 wheels; the toolkit is here only so
# gsplat (ComfyUI-SpEdE) can compile ahead of time. torch's extension builder hard-fails on a CUDA
# major mismatch, so nvcc must be 13.x to match the cu130 wheels. The host driver must support
# CUDA 13.0 (NVIDIA_REQUIRE_CUDA=cuda>=13.0 in this base; the host reports 615.78).
FROM nvidia/cuda:13.0.3-devel-ubuntu24.04@sha256:b7ae301dea2c162444795462ce17a05f6a516e5a75944b57af5b88540a1a2266
# Pinned 2026-10-21: native MOSS, LTX-2.5 and current partner API nodes.
# Weights: Comfy-Org/MOSS-Image in the models volume.
ARG COMFYUI_REV=faa7e494f3a0c9e45e1c3db8d20ee48fd5fe1b52
ARG LTXVIDEO_REV=220e1d45aa0469f518e982102fca4dca92a61862
ARG BFSNODES_REV=1ff7c1c9e13ec63211723725848bebb9f90ba58b
ENV DEBIAN_FRONTEND=noninteractive PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-dev python3-venv git ffmpeg ca-certificates libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
RUN git init /opt/ComfyUI && cd /opt/ComfyUI && git remote add origin https://github.com/Comfy-Org/ComfyUI.git && git fetch --depth 1 origin ${COMFYUI_REV} && git checkout --detach FETCH_HEAD
# H3 convrot/AWQ kernels require PyTorch built with CUDA >=13. The host driver
# supplies libcuda; the CUDA runtime comes from these wheels, not the base image.
RUN --mount=type=cache,target=/root/.cache/pip pip install --timeout 180 --retries 10 pip==26.2
RUN --mount=type=cache,target=/root/.cache/pip pip install --timeout 180 --retries 10 --resume-retries 10 torch==2.14.0 torchvision==0.29.0 torchaudio==2.11.0 --index-url https://download.pytorch.org/whl/cu130
RUN --mount=type=cache,target=/root/.cache/pip pip install --timeout 180 --retries 10 --resume-retries 10 -r /opt/ComfyUI/requirements.txt
# gsplat 1.5.3 for ComfyUI-SpEdE, built ahead of time against this venv's torch (no GPU at build
# time, so the arch list is explicit: RTX A6000 = 8.6, RTX 6000 Ada = 8.9). `--build-arg SPEDE=0`
# skips gsplat and SpEdE entirely (fallback if the gsplat/torch 2.14 compile fails). The glm
# submodule (pinned by the tag's gitlink, 33b4a621) is fetched recursively. --no-build-isolation
# uses the venv's torch; --no-deps stops pip touching torch or numpy. The final assertion proves
# the prebuilt gsplat.csrc extension is the one in use (the JIT fallback names its module
# `gsplat_cuda`, and the devel image has nvcc, so a JIT build would otherwise pass unnoticed).
ARG SPEDE=1
ARG GSPLAT_REV=937e29912570c372bed6747a5c9bf85fed877bae
# torch 2.14's cpp_extension builds with -std=c++20 and its c10 headers need it;
# gsplat 1.5.3 hard-codes -std=c++17 after NVCC_FLAGS (setup.py:72), so the nvcc pass
# fails on c10/core/SymFloat.h. gsplat is Apache-2.0: patch that one flag and assert the
# patch applied. SpEdE itself stays unmodified (AGPL).
RUN --mount=type=cache,target=/root/.cache/pip if [ "$SPEDE" = "1" ]; then \
      set -eux; \
      apt-get update && apt-get install -y --no-install-recommends build-essential && rm -rf /var/lib/apt/lists/*; \
      pip install --timeout 180 --retries 10 ninja==1.13.2 setuptools==84.2.1 wheel==0.48.0 packaging==26.3 jaxtyping==0.3.11 rich==15.0.0; \
      git init /tmp/gsplat-src && cd /tmp/gsplat-src \
        && git remote add origin https://github.com/nerfstudio-project/gsplat.git \
        && git fetch --depth 1 origin ${GSPLAT_REV} && git checkout --detach FETCH_HEAD \
        && git submodule update --init --recursive --depth 1; \
      grep -q '"-std=c++17"' /tmp/gsplat-src/setup.py; \
      sed -i 's/"-std=c++17"/"-std=c++20"/' /tmp/gsplat-src/setup.py; \
      grep -q '"-std=c++20"' /tmp/gsplat-src/setup.py; \
      test -f /tmp/gsplat-src/gsplat/cuda/csrc/third_party/glm/glm/glm.hpp; \
      TORCH_CUDA_ARCH_LIST="8.6;8.9" MAX_JOBS=4 pip install --no-build-isolation --no-deps /tmp/gsplat-src; \
      cd / && rm -rf /tmp/gsplat-src; \
      python -c "import torch, gsplat.csrc as csrc; from gsplat.cuda._backend import _C; assert _C is csrc and _C.__name__ == 'gsplat.csrc', _C; assert csrc.__file__.endswith('.so'), csrc.__file__; from gsplat import rasterize_to_indices_in_range; assert torch.__version__ == '2.14.0+cu130', torch.__version__; print('gsplat prebuilt:', csrc.__file__, '| torch', torch.__version__)"; \
    fi
RUN git init /opt/ComfyUI/custom_nodes/ComfyUI-LTXVideo \
    && cd /opt/ComfyUI/custom_nodes/ComfyUI-LTXVideo \
    && git remote add origin https://github.com/Lightricks/ComfyUI-LTXVideo.git \
    && git fetch --depth 1 origin ${LTXVIDEO_REV} && git checkout --detach FETCH_HEAD
RUN --mount=type=cache,target=/root/.cache/pip pip install --timeout 180 --retries 10 \
    -r /opt/ComfyUI/custom_nodes/ComfyUI-LTXVideo/requirements.txt
RUN git init /opt/ComfyUI/custom_nodes/ComfyUI-BFSnodes \
    && cd /opt/ComfyUI/custom_nodes/ComfyUI-BFSnodes \
    && git remote add origin https://github.com/alisson-anjos/ComfyUI-BFSnodes.git \
    && git fetch --depth 1 origin ${BFSNODES_REV} && git checkout --detach FETCH_HEAD
RUN --mount=type=cache,target=/root/.cache/pip pip install --timeout 180 --retries 10 \
    -r /opt/ComfyUI/custom_nodes/ComfyUI-BFSnodes/requirements.txt
# ComfyUI-SpEdE (AGPL-3.0-or-later): Gaussian-splat object remove/extract/replace. Installed
# unmodified as a separate runtime component; no agentbox code imports it. Tested upstream on
# ComfyUI 0.41.0 (this image pins 0.42.0) and 32 GB VRAM only. Only the node pack's
# requirements.txt is installed, with the gsplat line filtered out so pip cannot replace the
# prebuilt build above. studio/requirements.txt (fastapi, comfy-sdk, ...) is the upstream UI and
# is deliberately not installed: nodes.py, __init__.py, spede_assets.py and spede_core/ import none of it.
ARG SPEDE_REV=78b2a011ae8c47e702b25759c95d140784da97ce
RUN if [ "$SPEDE" = "1" ]; then \
      set -eux; \
      git init /opt/ComfyUI/custom_nodes/ComfyUI-SpEdE \
        && cd /opt/ComfyUI/custom_nodes/ComfyUI-SpEdE \
        && git remote add origin https://github.com/Burgstall-labs/ComfyUI-SpEdE.git \
        && git fetch --depth 1 origin ${SPEDE_REV} && git checkout --detach FETCH_HEAD; \
      grep -qi '^gsplat' requirements.txt; \
      grep -vi '^gsplat' requirements.txt > /tmp/spede-requirements.txt; \
      if grep -qi gsplat /tmp/spede-requirements.txt; then echo 'gsplat line survived filter' >&2; exit 1; fi; \
    fi
RUN --mount=type=cache,target=/root/.cache/pip if [ "$SPEDE" = "1" ]; then \
      printf 'plyfile==1.1.5\n' > /tmp/spede-constraints.txt && \
      pip install --timeout 180 --retries 10 -r /tmp/spede-requirements.txt -c /tmp/spede-constraints.txt \
        && rm -f /tmp/spede-requirements.txt /tmp/spede-constraints.txt; \
    fi
WORKDIR /opt/ComfyUI
# Regional text/mask routing and animated bounding boxes; dependencies are
# already supplied by ComfyUI (torch, numpy, aiohttp). Weights remain in volume.
ARG LTX_BBOX_REV=c4b0a9db7b523abcdb2245c648992415e1f9dd7a
RUN git init /opt/ComfyUI/custom_nodes/ComfyUI-LTX-BBox-Animator \
    && cd /opt/ComfyUI/custom_nodes/ComfyUI-LTX-BBox-Animator \
    && git remote add origin https://github.com/yuvraj108c/ComfyUI-LTX-BBox-Animator.git \
    && git fetch --depth 1 origin ${LTX_BBOX_REV} && git checkout --detach FETCH_HEAD
# agentbox_video node pack (identity, staging, relay, masks, retake): numpy + OpenCV only,
# importable without torch. OpenCV pin reasoning: ComfyUI@COMFYUI_REV requirements.txt leaves
# numpy unbounded (numpy>=1.25.0) and torch 2.14.0 declares no numpy bound, so pip resolves the
# newest numpy (2.x). opencv-python-headless 4.12.0.88 caps numpy<2.3.0 and would force a
# downgrade under ComfyUI; 5.0.0.93 needs only numpy>=2 and is the build the pack's tests ran
# against (numpy 2.3.5). BFSnodes requires the GUI `opencv-python`; two cv2 distributions overwrite
# each other's files, so remove it and keep exactly one headless build (no libGL/X dependency).
# Face-model ONNX weights are not baked: they load from /opt/ComfyUI/models/agentbox_face/ (models volume).
RUN --mount=type=cache,target=/root/.cache/pip pip uninstall -y opencv-python opencv-contrib-python opencv-python-headless \
    && pip install --timeout 180 --retries 10 --force-reinstall --no-deps opencv-python-headless==5.0.0.93 \
    && python -c "import cv2, numpy; print('cv2', cv2.__version__, 'numpy', numpy.__version__)"
# SpEdE leaves the venv consistent: pip check output is always printed. It is fatal only when a
# package this change owns (gsplat, plyfile, jaxtyping, rich, ninja) is the broken subject;
# torch, numpy, scipy (ComfyUI already requires it), Pillow and pre-existing third-party conflicts (BFSnodes, LTXVideo, ComfyUI) are
# reported but must not block the image. The torch version is re-asserted after every install.
RUN if [ "$SPEDE" = "1" ]; then \
      pip check > /tmp/pipcheck.txt 2>&1 || true; cat /tmp/pipcheck.txt; \
      if grep -iE '^(gsplat|plyfile|jaxtyping|rich|ninja)[ =]' /tmp/pipcheck.txt; then echo 'pip check: SpEdE-owned package broken' >&2; exit 1; fi; \
      rm -f /tmp/pipcheck.txt; \
      python -c "import torch, gsplat, scipy, plyfile, numpy, PIL, cv2; assert torch.__version__ == '2.14.0+cu130', torch.__version__; print('torch', torch.__version__, 'gsplat', gsplat.__version__, 'scipy', scipy.__version__, 'plyfile', plyfile.__version__, 'numpy', numpy.__version__, 'Pillow', PIL.__version__, 'cv2', cv2.__version__)"; \
    fi
COPY comfyui-sidecar/nodes/agentbox_video /opt/ComfyUI/custom_nodes/agentbox_video
COPY skills/comfyui/scripts/download_video_models.py /opt/agentbox-media/scripts/download_video_models.py
COPY skills/comfyui/models/stopmotion-candidates.json /opt/agentbox-media/models/stopmotion-candidates.json
EXPOSE 8188
CMD ["python", "main.py", "--listen", "0.0.0.0", "--port", "8188", "--disable-auto-launch"]
