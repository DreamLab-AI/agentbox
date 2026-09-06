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

## Closeout extension — 2026-09-04

CP-01/06/08. Owner remains jjohare with GPU/runtime maintainers. Current source retains the suffix and local-cuda gate. Historical complete/live declarations for the CUDA remedy are preserved, not re-certified. The wrapper now also sets default GLX vendor, EGL vendor file and Vulkan ICD values, so this decision's graphics review trigger has been reached. Its CUDA-only scope does not govern the whole current wrapper.

**Acceptance condition:** Adopt or separate the graphics configuration decision. Verify CLI wrappers and supervisor assignments independently, with inherited and absent environment values, missing driver files, backend-none and inference-sidecar-only controls. Capture image/lock, host driver, selected device, effective library resolution and explicit application results; distinguish compute enumeration/workload from a rendered viewport. Verify ABI/library selection before repeating the universal no-shadowing claim. No sidecar or headset inherits acceptance from the main-image CUDA result.

The existing backend test exits 77 because Nix is absent. Its source uses one dispatcher argument while the current function requires two, and resolves registry nixpkgs rather than explicitly using this repository lock. Repair and execute that gate before relying on it. See the [GPU runtime review](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/rendered-state.md#gpu-packaging-and-runtime-boundary) and [receipt](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/evidence/gpu-runtime-snapshot.json). No image build, driver probe, render or CUDA workload ran. Reopen on wrapper defaults, dispatcher/toolchain selection, driver mounts or launch-path changes; dependencies are CP-01 release identity and CP-08 reproducibility.

## Acceptance progress — 2026-09-05

**Implemented.** The backend gate the closeout said must be repaired before it
can be relied on is repaired. **Nix is not available in this container, so the
nix assertions themselves were NOT executed** — this advances the test, not the
GPU claim.

- *Two-argument dispatcher.* The test called `dispatchGpuBackend` with one
  argument where `lib/gpu-backend.nix` requires two (`backend`,
  `toolchainsCudaEnabled`). Every call site is now two-argument, and the
  self-check asserts both the declared arity in the lib and the rendered call
  shape for six backend/toolchain combinations.
- *Repository lock.* `nixpkgs` is resolved from this repository's `flake.lock`
  revision instead of the runner's flake registry, so the gate no longer
  evaluates against whatever nixpkgs the runner happens to point at. The
  self-check asserts the reference is a locked github revision and that the
  rendered program pins it and imports this repository's lib.
- *Honest skip.* Exit 77 is retained only when nix is genuinely absent, and the
  skip message now names precisely which assertions were not executed and why —
  it previously implied coverage it had not delivered. With nix present, a failed
  assertion FAILS rather than skips.
- *Self-check guard fix.* The registry-reference guard grepped its own source for
  the literal it was searching for and therefore failed on itself; the needle is
  now assembled from fragments so the guard reports the real state.

**Tests and results.** `bash tests/flake/gpu-backend.test.sh --self-check` —
**PASS**, 11 checks, exit 0, with the rendered (unexecuted) nix program printed
for inspection. `bash -n` clean.

**Receipts.** `docs/estate-closeout/2026-09-05/adr-2006-backend-test.json`.

**Remaining.** The nix evaluation path is unverified here: no image build, driver
probe, render or CUDA workload ran, and no library-resolution or ABI check was
performed. The graphics-configuration scope question — the wrapper now also sets
GLX/EGL/Vulkan defaults, beyond this record's CUDA-only scope — is still not
adopted or separated. No sidecar or headset inherits acceptance from a main-image
result.

**Governed paths changed.** `tests/flake/gpu-backend.test.sh`.
