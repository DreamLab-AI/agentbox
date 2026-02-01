# ADR-003: Complete GPU/CUDA Removal

## Status

**Accepted**

## Context

The current Dockerfile.unified contains extensive NVIDIA/CUDA setup:
- Lines 105-152: CUDA toolkit installation (~10GB)
- Lines 307-328: PyTorch cu130 wheels (~3GB)
- Lines 134-147: NVIDIA environment variables
- Lines 708-732: CUDA shell configuration

This makes the container:
1. x86_64 only (CUDA not available for ARM64 Linux)
2. Requires NVIDIA GPU hardware
3. Adds ~13GB to image size
4. Incompatible with Oracle Cloud free tier (no GPU)

## Decision

**Remove all GPU/CUDA dependencies completely.**

### Removed Components

| Component | Dockerfile Lines | Size |
|-----------|------------------|------|
| CUDA toolkit | 121-122 | ~5GB |
| cuDNN | 124 | ~2GB |
| cuTensor | 126 | ~1GB |
| nsight-compute | 128 | ~2GB |
| PyTorch cu130 | 307-328 | ~3GB |
| NVIDIA env vars | 134-147 | - |
| NVIDIA EGL | 149-152 | - |

### Removed Environment Variables

```bash
# All removed:
NVIDIA_VISIBLE_DEVICES
NVIDIA_DRIVER_CAPABILITIES
__GLX_VENDOR_LIBRARY_NAME
CUDA_HOME
CUDA_PATH
CUDA_VERSION
__NV_PRIME_RENDER_OFFLOAD
__VK_LAYER_NV_optimus
```

### Removed Runtime Dependencies

```yaml
# docker-compose.yml - removed:
runtime: nvidia
deploy:
  resources:
    reservations:
      devices:
        - capabilities: [gpu]
devices:
  - /dev/nvidia0
  - /dev/nvidiactl
  - /dev/nvidia-uvm
```

## Consequences

### Positive
- Image size reduced by ~13GB
- ARM64 compatible
- No GPU hardware required
- Faster builds (skip CUDA compilation)
- Works on Oracle Cloud free tier

### Negative
- No local GPU inference (ComfyUI, PyTorch training)
- Blender GPU rendering unavailable
- Some ML workflows require external services

### Mitigation
- GPU workloads offloaded to external containers
- ComfyUI runs as separate container with GPU passthrough
- Cloud GPU services (Lambda Labs, RunPod) for training
- CPU-only inference for small models

## References

- https://nixos.wiki/wiki/CUDA
- Oracle Cloud free tier lacks GPU instances
