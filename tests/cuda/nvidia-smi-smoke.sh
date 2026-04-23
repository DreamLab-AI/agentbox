#!/usr/bin/env bash
# tests/cuda/nvidia-smi-smoke.sh
#
# Smoke test: when [toolchains.cuda]=true, the agentbox container must
# surface a working CUDA driver via `nvidia-smi`.
#
# Prerequisites (NOT satisfied in standard CI without GPU hardware):
#   - Host with an NVIDIA GPU and driver installed
#   - nvidia-container-toolkit configured so Docker can pass through the GPU
#   - A running agentbox container launched with the cuda-runtime image
#     (nix build .#cuda-runtime) and the NVIDIA container runtime
#
# Exit codes:
#   0   — nvidia-smi exited 0 (CUDA driver is live)
#   77  — skipped (CUDA not enabled in manifest, or docker unavailable)
#   1   — nvidia-smi returned non-zero (driver error)
#
# TAP-compatible: prints "ok", "not ok", or "# SKIP" lines.

set -euo pipefail

MANIFEST="${AGENTBOX_MANIFEST:-agentbox.toml}"
CONTAINER_NAME="${AGENTBOX_CONTAINER:-agentbox}"

# ── helper ────────────────────────────────────────────────────────────────────
skip() {
  echo "1..1"
  echo "ok 1 # SKIP $*"
  exit 77
}

fail() {
  echo "1..1"
  echo "not ok 1 - nvidia-smi inside agentbox: $*"
  exit 1
}

pass() {
  echo "1..1"
  echo "ok 1 - nvidia-smi exited 0 inside agentbox container"
  exit 0
}

# ── guard: parse [toolchains].cuda from the manifest ─────────────────────────
# Use a minimal TOML grep — no full parser required for a boolean flag.
if [[ ! -f "${MANIFEST}" ]]; then
  skip "manifest not found at ${MANIFEST}"
fi

cuda_enabled="false"
# Look for `cuda = true` (with optional spaces) inside the [toolchains] section.
in_toolchains=0
while IFS= read -r line; do
  if [[ "${line}" =~ ^\[toolchains\] ]]; then
    in_toolchains=1
    continue
  fi
  if [[ "${line}" =~ ^\[ ]]; then
    in_toolchains=0
  fi
  if [[ "${in_toolchains}" -eq 1 && "${line}" =~ ^[[:space:]]*cuda[[:space:]]*=[[:space:]]*true ]]; then
    cuda_enabled="true"
    break
  fi
done < "${MANIFEST}"

if [[ "${cuda_enabled}" != "true" ]]; then
  skip "[toolchains.cuda] is not set to true in ${MANIFEST} — CUDA smoke test skipped"
fi

# ── guard: docker available ───────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  skip "docker not found in PATH — cannot exec into container"
fi

if ! docker info &>/dev/null; then
  skip "docker daemon unreachable — cannot exec into container"
fi

# ── guard: container is running ───────────────────────────────────────────────
if ! docker inspect --format '{{.State.Running}}' "${CONTAINER_NAME}" 2>/dev/null | grep -q true; then
  skip "container '${CONTAINER_NAME}' is not running — start it with: docker compose up -d agentbox"
fi

# ── run nvidia-smi inside the container ──────────────────────────────────────
echo "# Running: docker exec ${CONTAINER_NAME} nvidia-smi"
if docker exec "${CONTAINER_NAME}" nvidia-smi; then
  pass
else
  fail "nvidia-smi returned non-zero (exit $?); check NVIDIA driver and container runtime"
fi
