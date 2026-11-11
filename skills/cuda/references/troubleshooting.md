# Troubleshooting

## nvcc not found
`command -v nvcc`; it is baked into the image. If missing, the shell PATH is wrong, so report it rather than installing anything.

## GPU not accessible
```bash
nvidia-smi
ldd ./binary | grep libcuda   # stub vs real driver
```
Both CUDA stubs and the real driver exist; a binary linked against the stub will not see a GPU.

## Compilation errors
Re-run with `nvcc -Xptxas -v` and read the first error only. Common causes: `__global__` called without `<<<>>>`, host/device function mix-ups, missing `-gencode` for the target card.

## Wrong results or crashes
`compute-sanitizer --tool memcheck ./k`, then `--tool racecheck`. Add `cudaGetLastError()` after each launch; launch failures are otherwise silent.

## Need nsys/ncu output
Not installed here; profile on the operator's host.
