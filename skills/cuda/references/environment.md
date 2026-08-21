# Environment Requirements

### CUDA Toolkit
```bash
# Check CUDA installation
nvcc --version
nvidia-smi

# Container has CUDA 13.0
# Location: /opt/cuda/bin/nvcc
```

### GPUs Detected (Container)
- GPU 0: NVIDIA RTX A6000 (48GB)
- GPU 1: Quadro RTX 6000 (24GB)
- GPU 2: Quadro RTX 6000 (24GB)

### PyTorch CUDA
```python
import torch
print(torch.__version__)  # 2.9.1+cu128
print(torch.cuda.is_available())  # True
print(torch.cuda.device_count())  # 3
```
