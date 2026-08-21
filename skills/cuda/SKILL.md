---
skill: cuda
name: cuda
version: 1.0.0
description: "AI-powered CUDA development with 4 specialist agents (General, Optimizer, Debugger, Analyzer) plus an MCP toolset. Use when writing CUDA kernels (.cu/.cuh), optimising GPU code (coalescing, shared memory, occupancy), debugging nvcc compilation or race conditions, or profiling GPU performance with nsys/ncu. NOT for high-level PyTorch training without custom kernels (use pytorch-ml), Rust/C++ systems work without GPU (use rust-development), or CPU-only profiling (use performance-analysis)."
tags: [cuda, gpu, nvidia, optimisation, kernel, parallel-computing, nvcc, profiling, debugging]
mcp_server: true
entry_point: mcp-server/server.py
protocol: stdio
compatibility:
  - cuda >= 11.0
  - nvidia-driver >= 470.0
  - python >= 3.9
---

# CUDA Specialist Skill

AI-powered CUDA development assistant integrating 4 specialist agents with comprehensive GPU development tools.

## When Not To Use

- For high-level PyTorch model training that does not need custom kernels -- use the pytorch-ml skill instead
- For distributed neural network training in cloud sandboxes -- use the flow-nexus-neural skill instead
- For general Rust or C++ systems programming without GPU involvement -- use the rust-development skill instead
- For WebAssembly-based compute without GPU -- use the wasm-js skill instead
- For CPU-only performance profiling of swarm operations -- use the performance-analysis skill instead

## Overview

The CUDA skill brings professional CUDA development capabilities to Claude Code through:

- **4 AI Specialist Agents**: General, Optimizer, Debugger, Analyzer
- **CUDA Compilation**: nvcc integration with auto-architecture detection
- **Kernel Analysis**: Pattern detection and optimisation opportunities
- **GPU Profiling**: Performance measurement and bottleneck identification
- **Code Generation**: Create optimised kernels from specifications

## Reference Files

Load the reference that matches the task:

- [references/agents.md](references/agents.md) — the 4 specialist agents (General, Optimizer, Debugger, Analyzer): when to use each and invocation examples.
- [references/mcp-tools.md](references/mcp-tools.md) — full MCP tool catalogue (kernel dev, GPU management, agent routing, file ops) plus JSON call examples.
- [references/environment.md](references/environment.md) — CUDA toolkit checks, container GPUs, and PyTorch CUDA verification.
- [references/examples.md](references/examples.md) — quick-start prompts and integration patterns with PyTorch and Rust skills.
- [references/optimisation.md](references/optimisation.md) — performance checklist, advanced compilation flags, nsys/ncu profiling, benchmarking, and best practices.
- [references/troubleshooting.md](references/troubleshooting.md) — fixes for CUDA-not-found, GPU-not-accessible, and compilation errors.

## Related Skills

- **pytorch-ml** - Deep learning with PyTorch + CUDA
- **rust-development** - Safe CUDA bindings in Rust
- **docker-orchestrator** - Deploy GPU containers
- **infrastructure-manager** - Provision GPU cloud instances

## References

- [RightNow CLI GitHub](https://github.com/RightNow-AI/rightnow-cli)
- [NVIDIA CUDA Programming Guide](https://docs.nvidia.com/cuda/cuda-c-programming-guide/)
- [CUDA Best Practices Guide](https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/)

---

**Skill Status**: Production Ready
**CUDA Support**: 11.0 - 13.0
**GPU Architectures**: Pascal, Volta, Turing, Ampere, Ada Lovelace, Hopper
**Container GPUs**: 3x (RTX A6000 + 2x Quadro RTX 6000)
