# Optimisation, flags and measurement

## Checklist

1. **Memory access**: global coalescing, shared-memory bank conflicts, strided access.
2. **Occupancy**: registers per thread, shared memory per block, block size (a multiple of 32). Read these from `-Xptxas -v`.
3. **Synchronisation**: `__syncthreads()` cost, warp divergence, races.
4. **Arithmetic intensity**: compute-to-memory ratio, unrolling, vectorised loads (`float4`).

## Build flags

RTX A6000 = sm_86, RTX 6000 Ada = sm_89. A fat binary covering both:

```bash
nvcc -O3 -lineinfo -Xptxas -v --use_fast_math \
  -gencode arch=compute_86,code=sm_86 \
  -gencode arch=compute_89,code=sm_89 \
  -o k k.cu
```

`--maxrregcount N` caps registers (trades spills for occupancy). Use `-g -G` only for debugging; it disables optimisation. Emit PTX/SASS with `-ptx` or `cuobjdump -sass k`.

## Timing with CUDA events

```cuda
cudaEvent_t t0, t1; cudaEventCreate(&t0); cudaEventCreate(&t1);
for (int i = 0; i < 10; ++i) kernel<<<g, b>>>(...);      // warm-up
cudaEventRecord(t0);
for (int i = 0; i < 100; ++i) kernel<<<g, b>>>(...);
cudaEventRecord(t1); cudaEventSynchronize(t1);
float ms; cudaEventElapsedTime(&ms, t0, t1);
printf("%.3f us/iter\n", ms * 1000.f / 100);
```

Derive effective bandwidth (bytes moved / time) and compare with the card's peak to see whether you are memory- or compute-bound.

## Correctness tools

`compute-sanitizer --tool memcheck|racecheck|synccheck|initcheck ./k`

## Profiling

`nsys` and `ncu` are not installed in this image. Nsight profiling runs on the operator's host: ask for the report (or the `ncu --set full` summary) and read it. Here, use `-Xptxas -v`, CUDA events and `-lineinfo` builds.

## Best practices

1. Measure before optimising; keep a CPU reference.
2. Change one thing at a time and re-verify correctness.
3. Warm up, then average many iterations.
