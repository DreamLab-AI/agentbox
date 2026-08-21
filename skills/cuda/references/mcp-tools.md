# Available MCP Tools

### Kernel Development
- `cuda_create_kernel` - Generate CUDA kernel from specification
- `cuda_read_kernel` - Read and parse existing kernel code
- `cuda_write_kernel` - Write/modify kernel files
- `cuda_compile` - Compile CUDA code with nvcc
- `cuda_analyze` - Deep analysis for optimisation opportunities

### GPU Management
- `cuda_gpu_status` - Get GPU info via nvidia-smi
- `cuda_detect_arch` - Auto-detect GPU compute capability
- `cuda_profile` - Profile kernel execution
- `cuda_benchmark` - Run performance benchmarks

### Agent Routing
- `cuda_route_query` - Route to appropriate specialist agent
- `cuda_general_assist` - General CUDA assistant
- `cuda_optimize_code` - Optimisation specialist
- `cuda_debug_code` - Debugging specialist
- `cuda_analyze_quality` - Code analysis specialist

### File Operations
- `cuda_list_files` - List .cu/.cuh files in directory
- `cuda_exec_bash` - Execute shell commands for builds

## Tool Examples

### Create Optimised Kernel
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
