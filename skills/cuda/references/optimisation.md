# Performance Optimisation, Advanced Features & Best Practices

## Performance Optimisation Checklist

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

## Best Practices

1. **Always profile before optimising** - Use cuda_profile to identify bottlenecks
2. **Start with analyser** - Run cuda_analyze before manual optimisation
3. **Test incrementally** - Verify correctness after each optimisation
4. **Use appropriate agent** - Route complex tasks to specialist agents
5. **Leverage GPU detection** - Let auto_arch detect compute capability
