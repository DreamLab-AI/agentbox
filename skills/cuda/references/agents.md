# Working modes

One agent plays four roles depending on the task. Each uses only Read/Write/Edit and Bash with `nvcc` and `compute-sanitizer`.

## General
Create a kernel from a specification: write the `.cu`, add a CPU reference and a `CUDA_CHECK` macro, build with the flags in `optimisation.md`, run and compare.

## Optimiser
Start from a correct, measured baseline. Read `-Xptxas -v` output (registers, spills, shared memory), check coalescing and bank conflicts by reading the access pattern, apply one change, re-time with CUDA events.

## Debugger
Wrong results or crashes: rebuild with `-g -G -lineinfo`, run `compute-sanitizer --tool memcheck`, then `racecheck` for shared-memory hazards and `synccheck` for divergent barriers. Add device `printf` for a single failing thread, guarded by `if (blockIdx.x == 0 && threadIdx.x == 0)`.

## Reviewer
Read the kernel for: uncoalesced global access, shared-memory bank conflicts, warp divergence, missing `__syncthreads()`, unchecked launches, integer overflow in index maths, and block sizes that are not multiples of 32.
