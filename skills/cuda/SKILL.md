---
skill: cuda
name: cuda
version: 1.0.0
description: AI-powered CUDA development assistant with 4 specialist agents, kernel optimization, compilation, and GPU profiling
tags: [cuda, gpu, nvidia, optimization, kernel, parallel-computing, nvcc, profiling, debugging]
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

## Overview

The CUDA skill brings professional CUDA development capabilities to Claude Code through:

- **4 AI Specialist Agents**: General, Optimizer, Debugger, Analyzer
- **CUDA Compilation**: nvcc integration with auto-architecture detection
- **Kernel Analysis**: Pattern detection and optimization opportunities
- **GPU Profiling**: Performance measurement and bottleneck identification
- **Code Generation**: Create optimized kernels from specifications

## Specialist Agents

### 1. General Assistant
**When to use**: General CUDA questions, kernel creation, learning

```bash
# Example: Create basic kernel
cuda_general "Create a parallel reduction kernel for sum"
```

### 2. Optimizer Agent
**When to use**: Performance optimization, memory coalescing, shared memory

```bash
# Example: Optimize existing kernel
cuda_optimize --file kernel.cu --target-gpu rtx4090
```

### 3. Debugger Agent
**When to use**: Fix compilation errors, race conditions, memory issues

```bash
# Example: Debug kernel
cuda_debug --file buggy_kernel.cu --error "incorrect results for large arrays"
```

### 4. Analyzer Agent
**When to use**: Code review, best practices, complexity analysis

```bash
# Example: Analyze kernel quality
cuda_analyze --file my_kernel.cu --report-format markdown
```

## Available MCP Tools

### Kernel Development
- `cuda_create_kernel` - Generate CUDA kernel from specification
- `cuda_read_kernel` - Read and parse existing kernel code
- `cuda_write_kernel` - Write/modify kernel files
- `cuda_compile` - Compile CUDA code with nvcc
- `cuda_analyze` - Deep analysis for optimization opportunities

### GPU Management
- `cuda_gpu_status` - Get GPU info via nvidia-smi
- `cuda_detect_arch` - Auto-detect GPU compute capability
- `cuda_profile` - Profile kernel execution
- `cuda_benchmark` - Run performance benchmarks

### Agent Routing
- `cuda_route_query` - Route to appropriate specialist agent
- `cuda_general_assist` - General CUDA assistant
- `cuda_optimize_code` - Optimization specialist
- `cuda_debug_code` - Debugging specialist
- `cuda_analyze_quality` - Code analysis specialist

### File Operations
- `cuda_list_files` - List .cu/.cuh files in directory
- `cuda_exec_bash` - Execute shell commands for builds

## Environment Requirements

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

## Quick Start Examples

### 1. Create Vector Addition Kernel
```bash
claude "Use rightnow-cuda to create a vector addition kernel with error checking"
```

### 2. Optimize Matrix Multiplication
```bash
claude "Use rightnow-cuda optimizer to optimize my matmul.cu for A6000 GPU"
```

### 3. Debug Race Condition
```bash
claude "Use rightnow-cuda debugger to find the race condition in parallel_sum.cu"
```

### 4. Analyze Kernel Quality
```bash
claude "Use rightnow-cuda analyzer to review my convolution kernel and suggest improvements"
```

## Integration Patterns

### With PyTorch ML Skill
```python
# Train model with PyTorch, optimize kernels with RightNow CUDA
# 1. Profile PyTorch bottlenecks
# 2. Extract slow operations to custom CUDA kernels
# 3. Use cuda_optimize_code for maximum performance
```

### With Rust Development Skill
```rust
// Write CUDA kernel wrappers in Rust
// Use rightnow-cuda for kernel implementation
// Use rust-development for safe bindings
```

## Tool Examples

### Create Optimized Kernel
```json
{
  "tool": "cuda_create_kernel",
  "args": {
    "name": "matrix_transpose",
    "description": "Efficient matrix transpose with shared memory tiling",
    "parameters": {
      "input": "float*",
      "output": "float*",
      "width": "int",
      "height": "int"
    },
    "optimizations": ["shared_memory", "coalescing", "bank_conflict_free"]
  }
}
```

### Compile with Architecture Detection
```json
{
  "tool": "cuda_compile",
  "args": {
    "source_file": "kernel.cu",
    "output_file": "kernel.ptx",
    "auto_arch": true,
    "optimization_level": "O3",
    "debug": false
  }
}
```

### GPU Status
```json
{
  "tool": "cuda_gpu_status",
  "args": {
    "verbose": true,
    "format": "json"
  }
}
```

### Deep Analysis
```json
{
  "tool": "cuda_analyze",
  "args": {
    "source_file": "my_kernel.cu",
    "checks": [
      "shared_memory_usage",
      "global_memory_coalescing",
      "arithmetic_intensity",
      "synchronization_overhead",
      "occupancy_estimate"
    ]
  }
}
```

## Performance Optimization Checklist

The analyzer checks for:

1. **Memory Access Patterns**
   - Global memory coalescing
   - Shared memory bank conflicts
   - Strided access patterns

2. **Occupancy**
   - Register usage
   - Shared memory allocation
   - Thread block size

3. **Synchronization**
   - __syncthreads() overhead
   - Warp divergence
   - Race conditions

4. **Arithmetic Intensity**
   - Compute-to-memory ratio
   - Loop unrolling opportunities
   - Vectorization potential

## Advanced Features

### Custom Compilation Flags
```bash
cuda_compile \
  --arch sm_89 \
  --ptx \
  --use_fast_math \
  --maxrregcount 32 \
  --extra-flags "-lineinfo -Xptxas -v"
```

### Profiling Integration
```bash
# Profile with nsys
cuda_profile --tool nsys --kernel my_kernel --iterations 1000

# Profile with ncu
cuda_profile --tool ncu --metrics all --kernel my_kernel
```

### Benchmarking
```bash
# Compare optimizations
cuda_benchmark \
  --baseline kernel_v1.cu \
  --optimized kernel_v2.cu \
  --input-sizes 1024,4096,16384 \
  --iterations 100
```

## Troubleshooting

### CUDA Not Found
```bash
# Check PATH includes CUDA bin
echo $PATH | grep cuda

# Should include: /opt/cuda/bin
```

### GPU Not Accessible
```bash
# Verify GPU passthrough in container
nvidia-smi

# Check PyTorch can see GPUs
python -c "import torch; print(torch.cuda.device_count())"
```

### Compilation Errors
```bash
# Use debugger agent
cuda_debug --file kernel.cu --verbose
```

## Best Practices

1. **Always profile before optimizing** - Use cuda_profile to identify bottlenecks
2. **Start with analyzer** - Run cuda_analyze before manual optimization
3. **Test incrementally** - Verify correctness after each optimization
4. **Use appropriate agent** - Route complex tasks to specialist agents
5. **Leverage GPU detection** - Let auto_arch detect compute capability

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
