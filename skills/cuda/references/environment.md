# Environment

```bash
command -v nvcc compute-sanitizer   # both baked; CUDA 13.4
nvcc --version
nvidia-smi --query-gpu=name,compute_cap,memory.total --format=csv
```

GPUs in this container: RTX A6000 (sm_86, 48 GB) and 2x RTX 6000 Ada Generation (sm_89, 48 GB).
`nsys` and `ncu` are not installed; Nsight profiling runs on the operator's host.

Check PyTorch sees the same devices (only if the baked python has torch):
`python3 -c "import torch; print(torch.cuda.device_count())"`.
