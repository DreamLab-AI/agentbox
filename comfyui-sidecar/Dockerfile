FROM nvidia/cuda:12.9.1-devel-ubuntu24.04
ARG COMFYUI_REV=efa6c8f804bff78b46a0fd458ebd2e47bba07a30
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
WORKDIR /opt/ComfyUI
EXPOSE 8188
CMD ["python", "main.py", "--listen", "0.0.0.0", "--port", "8188", "--disable-auto-launch"]
