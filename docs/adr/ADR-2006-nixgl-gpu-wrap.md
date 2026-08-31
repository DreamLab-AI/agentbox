---
id: ADR-2006
title: Nix GPU binaries are nixGL-wrapped by appending host driver dirs to LD_LIBRARY_PATH with --suffix, CUDA-only, gated on gpu.backend
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: cbe7335b9
owner: jjohare
review_trigger: A GPU presentation path (Vulkan/GLX) needed, or --prefix proposed over --suffix, or a non-CUDA backend added
repo: agentbox
domain: BASELINE-container
lineage: gpu-wrap.nix review findings C-9 / GPU-1 / GPU-2 (no legacy ADR number; precedent config/start-xorg-nvidia.sh)
---

# ADR-2006 — Nix GPU binaries are nixGL-wrapped by appending host driver dirs to LD_LIBRARY_PATH with --suffix, CUDA-only

## Context
Nix-built binaries carry their own `libstdc++`/`libc` and cannot see the host's NVIDIA driver
libraries, so CUDA `dlopen("libcuda.so.1")` fails inside the image. The fix must expose the host
driver path without letting host copies of Nix-owned libraries shadow the authoritative Nix ones
(ABI shadowing risk). This is a library-resolution fix for CUDA compute only — it is not a
Vulkan/GLX presentation path. It must apply only when a local CUDA backend is actually selected.

## Decision
Nix GPU binaries get a `symlinkJoin` wrapper that appends
`/usr/lib:/usr/lib/x86_64-linux-gnu:/run/opengl-driver/lib` to `LD_LIBRARY_PATH` using `--suffix`,
never `--prefix` — `dlopen` scans the whole `LD_LIBRARY_PATH` regardless of position, so appending
still resolves `libcuda.so.1` while keeping Nix's own `libstdc++`/`libc` authoritative. The wrapper
is applied only when `gpu.backend == "local-cuda"`. This forecloses `--prefix` (which would risk ABI
shadowing), and scopes the wrap to CUDA compute, not a graphics/presentation stack.

## Consequences
- CUDA binaries resolve the host driver at runtime without ABI shadowing of Nix libraries.
- Only `local-cuda` boxes pay the wrap; other backends leave binaries unmodified.
- Cost: Vulkan/GLX presentation is explicitly out of scope here and needs its own path; the wrap is a
  library-path fix and does not make GPU *graphics* work.

## Verification
implementation_status = complete, established at verified_commit cbe7335b9 and proven on RTX A6000 +
2× RTX 6000 Ada. `lib/gpu-wrap.nix:56` is `"--suffix" "LD_LIBRARY_PATH" ":" driverLibPath`; the
`--suffix`-not-`--prefix` rationale (avoid ABI shadowing) is at :23-26. `flake.nix:170` gates it:
`gpuActive = (agentboxConfig.gpu.backend or "none") == "local-cuda"`, applied at :172/:174.
