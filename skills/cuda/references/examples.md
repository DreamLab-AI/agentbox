# Quick Start Examples & Integration Patterns

## Quick Start Examples

### 1. Create Vector Addition Kernel
```bash
claude "Use rightnow-cuda to create a vector addition kernel with error checking"
```

### 2. Optimise Matrix Multiplication
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
