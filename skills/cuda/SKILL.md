---
name: cuda
description: "CUDA kernel development with the baked CUDA 13.4 toolchain: writing .cu/.cuh kernels, nvcc builds for sm_86 and sm_89, optimising (coalescing, shared memory, occupancy), and debugging races and memory errors with compute-sanitizer and CUDA event timing. Use when writing or tuning a custom GPU kernel. Not for PyTorch training without custom kernels (pytorch-ml), GPU-free Rust or C++ (rust-development), or CPU profiling (performance-analysis)."
tags: [cuda, gpu, nvidia, optimisation, kernel, parallel-computing, nvcc, debugging]
compatibility:
  - cuda >= 13.0
  - nvidia-driver >= 470.0
---

# CUDA Specialist Skill

Write, build, tune and debug CUDA kernels with the tools this image bakes: `nvcc`, `compute-sanitizer`, `nvidia-smi`. There is no CUDA MCP server; you work with Read/Write/Edit and Bash directly.

## When Not To Use

- High-level PyTorch training without custom kernels -- use the pytorch-ml skill
- Distributed neural network training in cloud sandboxes -- use the flow-nexus-neural skill
- General Rust or C++ without GPU involvement -- use the rust-development skill
- CPU-only profiling of swarm operations -- use the performance-analysis skill

## Toolchain here

- `nvcc` (CUDA 13.4) and `compute-sanitizer` are on PATH; check with `command -v nvcc compute-sanitizer`.
- Nsight Systems (`nsys`) and Nsight Compute (`ncu`) are **not** installed. Nsight profiling runs on the operator's host; ask for a captured report rather than trying to run them.
- Container GPUs: RTX A6000 (sm_86) and 2x RTX 6000 Ada Generation (sm_89). Detect with `nvidia-smi --query-gpu=name,compute_cap --format=csv`.
- Check the driver is really present before running kernels: `nvidia-smi` and `ldd <binary> | grep libcuda`.

## Workflow

1. **Write** the kernel to a `.cu` file, with a `CUDA_CHECK` macro around every runtime call and a `cudaGetLastError()` after each launch.
2. **Build** for both card architectures: `nvcc -O3 -lineinfo -Xptxas -v -gencode arch=compute_86,code=sm_86 -gencode arch=compute_89,code=sm_89 -o k k.cu`. `-Xptxas -v` prints registers, spills and shared memory per kernel, which is the occupancy input.
3. **Verify** against a CPU reference before timing anything.
4. **Check memory and races**: `compute-sanitizer --tool memcheck ./k`, then `--tool racecheck` (shared-memory hazards), `--tool synccheck`, `--tool initcheck`.
5. **Time** with CUDA events (see references/optimisation.md); warm up first and average many iterations.
6. **Tune** one change at a time, re-running steps 3-5.

## Reference Files

- [references/agents.md](references/agents.md) -- the four working modes (general, optimiser, debugger, reviewer) and what each does with the tools above.
- [references/optimisation.md](references/optimisation.md) -- checklist, nvcc flags, CUDA-event benchmarking, what profiling is possible here.
- [references/environment.md](references/environment.md) -- toolkit and GPU checks.
- [references/examples.md](references/examples.md) -- worked prompts and a kernel skeleton.
- [references/troubleshooting.md](references/troubleshooting.md) -- nvcc, driver and sanitizer failures.

## Related Skills

- **pytorch-ml** -- deep learning with PyTorch + CUDA
- **rust-development** -- safe CUDA bindings in Rust

## References

- [NVIDIA CUDA Programming Guide](https://docs.nvidia.com/cuda/cuda-c-programming-guide/)
- [CUDA Best Practices Guide](https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/)
