FROM nvidia/cuda:12.9.1-devel-ubuntu24.04@sha256:020bc241a628776338f4d4053fed4c38f6f7f3d7eb5919fecb8de313bb8ba47c
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
COPY comfyui-sidecar/nodes/agentbox_video /opt/ComfyUI/custom_nodes/agentbox_video
COPY skills/comfyui/scripts/download_video_models.py /opt/agentbox-media/scripts/download_video_models.py
COPY skills/comfyui/models/stopmotion-candidates.json /opt/agentbox-media/models/stopmotion-candidates.json
EXPOSE 8188
CMD ["python", "main.py", "--listen", "0.0.0.0", "--port", "8188", "--disable-auto-launch"]
