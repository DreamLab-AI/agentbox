# Examples

## Prompts

- "Write a vector-add kernel with error checking and a CPU reference, build for sm_86 and sm_89, and run it."
- "Tune matmul.cu: report registers and spills from `-Xptxas -v`, then try shared-memory tiling and re-time with CUDA events."
- "Run compute-sanitizer racecheck on parallel_sum.cu and fix the hazard."
- "Review my convolution kernel for coalescing and bank conflicts."

## Skeleton

```cuda
#include <cstdio>
#define CUDA_CHECK(x) do { cudaError_t e = (x); if (e != cudaSuccess) { \
  fprintf(stderr, "%s:%d %s\n", __FILE__, __LINE__, cudaGetErrorString(e)); return 1; } } while (0)

__global__ void add(const float* a, const float* b, float* c, int n) {
  int i = blockIdx.x * blockDim.x + threadIdx.x;
  if (i < n) c[i] = a[i] + b[i];
}

int main() {
  const int n = 1 << 20;
  float *a, *b, *c;
  CUDA_CHECK(cudaMallocManaged(&a, n * sizeof(float)));
  CUDA_CHECK(cudaMallocManaged(&b, n * sizeof(float)));
  CUDA_CHECK(cudaMallocManaged(&c, n * sizeof(float)));
  for (int i = 0; i < n; ++i) { a[i] = 1.f; b[i] = 2.f; }
  add<<<(n + 255) / 256, 256>>>(a, b, c, n);
  CUDA_CHECK(cudaGetLastError());
  CUDA_CHECK(cudaDeviceSynchronize());
  for (int i = 0; i < n; ++i) if (c[i] != 3.f) { printf("mismatch at %d\n", i); return 1; }
  puts("ok");
  return 0;
}
```

Build: `nvcc -O3 -lineinfo -gencode arch=compute_86,code=sm_86 -gencode arch=compute_89,code=sm_89 -o add add.cu`

## Integration

- **pytorch-ml**: find the slow op in PyTorch, extract it to a custom kernel, check results against the PyTorch op.
- **rust-development**: wrap the kernel in a safe Rust binding.
