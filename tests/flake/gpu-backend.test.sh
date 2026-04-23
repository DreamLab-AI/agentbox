#!/usr/bin/env bash
# tests/flake/gpu-backend.test.sh
#
# Unit tests for lib/gpu-backend.nix.
# Uses `nix eval` to exercise the dispatch function in pure-eval mode,
# so no build or network access is needed.
#
# Exit codes:
#   0  all tests passed
#   1  one or more assertions failed
#   77 nix is not available (TAP skip)

set -euo pipefail

# -----------------------------------------------------------------------
# Skip gracefully when nix is absent
# -----------------------------------------------------------------------
if ! command -v nix >/dev/null 2>&1; then
  echo "1..0 # SKIP nix not available"
  exit 77
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

PASS=0
FAIL=0

# -----------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------

# nix_eval EXPR
# Evaluates a Nix expression relative to the repo root and prints the result.
nix_eval() {
  local expr="$1"
  nix eval --impure --expr "
    let
      pkgs  = import (builtins.getFlake \"nixpkgs\") { system = \"x86_64-linux\"; config.allowUnfree = true; };
      lib   = pkgs.lib;
      gpuLib = import ${REPO_ROOT}/lib/gpu-backend.nix { inherit lib pkgs; };
    in ${expr}
  " 2>/dev/null
}

assert_eq() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "ok - ${label}"
    PASS=$(( PASS + 1 ))
  else
    echo "not ok - ${label}"
    echo "  expected: ${expected}"
    echo "  actual:   ${actual}"
    FAIL=$(( FAIL + 1 ))
  fi
}

assert_contains() {
  local label="$1"
  local needle="$2"
  local haystack="$3"
  if echo "$haystack" | grep -qF "$needle"; then
    echo "ok - ${label}"
    PASS=$(( PASS + 1 ))
  else
    echo "not ok - ${label}"
    echo "  expected to contain: ${needle}"
    echo "  actual:              ${haystack}"
    FAIL=$(( FAIL + 1 ))
  fi
}

# -----------------------------------------------------------------------
# Test plan
# -----------------------------------------------------------------------
echo "1..20"

# -----------------------------------------------------------------------
# Case 1: none
# -----------------------------------------------------------------------
BACKEND="none"

assert_eq "${BACKEND}: ollamaEnabled is false" \
  "false" \
  "$(nix_eval "(gpuLib.dispatchGpuBackend \"${BACKEND}\").ollamaEnabled")"

assert_eq "${BACKEND}: devicesNeeded is empty list" \
  "[ ]" \
  "$(nix_eval "(gpuLib.dispatchGpuBackend \"${BACKEND}\").devicesNeeded")"

assert_eq "${BACKEND}: runtimeClass is empty string" \
  '""' \
  "$(nix_eval "(gpuLib.dispatchGpuBackend \"${BACKEND}\").runtimeClass")"

assert_eq "${BACKEND}: nixPackages is empty list" \
  "[ ]" \
  "$(nix_eval "(gpuLib.dispatchGpuBackend \"${BACKEND}\").nixPackages")"

assert_eq "${BACKEND}: composeDeviceReservations is null" \
  "null" \
  "$(nix_eval "(gpuLib.dispatchGpuBackend \"${BACKEND}\").composeDeviceReservations")"

# -----------------------------------------------------------------------
# Case 2: ollama-rocm
# -----------------------------------------------------------------------
BACKEND="ollama-rocm"

assert_eq "${BACKEND}: ollamaEnabled is true" \
  "true" \
  "$(nix_eval "(gpuLib.dispatchGpuBackend \"${BACKEND}\").ollamaEnabled")"

assert_contains "${BACKEND}: devicesNeeded contains /dev/kfd" \
  "/dev/kfd:/dev/kfd" \
  "$(nix_eval "(gpuLib.dispatchGpuBackend \"${BACKEND}\").devicesNeeded")"

assert_contains "${BACKEND}: devicesNeeded contains /dev/dri" \
  "/dev/dri:/dev/dri" \
  "$(nix_eval "(gpuLib.dispatchGpuBackend \"${BACKEND}\").devicesNeeded")"

assert_eq "${BACKEND}: runtimeClass is empty (default OCI)" \
  '""' \
  "$(nix_eval "(gpuLib.dispatchGpuBackend \"${BACKEND}\").runtimeClass")"

assert_contains "${BACKEND}: envVars contains OLLAMA_VULKAN=1" \
  "OLLAMA_VULKAN" \
  "$(nix_eval "builtins.attrNames (gpuLib.dispatchGpuBackend \"${BACKEND}\").envVars")"

# -----------------------------------------------------------------------
# Case 3: ollama-cuda
# -----------------------------------------------------------------------
BACKEND="ollama-cuda"

assert_eq "${BACKEND}: ollamaEnabled is true" \
  "true" \
  "$(nix_eval "(gpuLib.dispatchGpuBackend \"${BACKEND}\").ollamaEnabled")"

assert_eq "${BACKEND}: runtimeClass is nvidia" \
  '"nvidia"' \
  "$(nix_eval "(gpuLib.dispatchGpuBackend \"${BACKEND}\").runtimeClass")"

assert_eq "${BACKEND}: devicesNeeded is empty (uses reservations)" \
  "[ ]" \
  "$(nix_eval "(gpuLib.dispatchGpuBackend \"${BACKEND}\").devicesNeeded")"

assert_contains "${BACKEND}: composeDeviceReservations has driver=nvidia" \
  "driver" \
  "$(nix_eval "builtins.attrNames (gpuLib.dispatchGpuBackend \"${BACKEND}\").composeDeviceReservations")"

assert_eq "${BACKEND}: nixPackages is empty (CUDA lives in sidecar)" \
  "[ ]" \
  "$(nix_eval "(gpuLib.dispatchGpuBackend \"${BACKEND}\").nixPackages")"

# -----------------------------------------------------------------------
# Case 4: local-cuda
# -----------------------------------------------------------------------
BACKEND="local-cuda"

assert_eq "${BACKEND}: ollamaEnabled is true" \
  "true" \
  "$(nix_eval "(gpuLib.dispatchGpuBackend \"${BACKEND}\").ollamaEnabled")"

assert_eq "${BACKEND}: runtimeClass is nvidia" \
  '"nvidia"' \
  "$(nix_eval "(gpuLib.dispatchGpuBackend \"${BACKEND}\").runtimeClass")"

assert_contains "${BACKEND}: nixPackages is non-empty" \
  "cudatoolkit" \
  "$(nix_eval "map (p: p.pname or p.name or \"?\") (gpuLib.dispatchGpuBackend \"${BACKEND}\").nixPackages")"

assert_contains "${BACKEND}: supervisorExtraEnv has CUDA_VISIBLE_DEVICES" \
  "CUDA_VISIBLE_DEVICES" \
  "$(nix_eval "builtins.attrNames (gpuLib.dispatchGpuBackend \"${BACKEND}\").supervisorExtraEnv")"

assert_contains "${BACKEND}: composeDeviceReservations has compute capability" \
  "compute" \
  "$(nix_eval "(gpuLib.dispatchGpuBackend \"${BACKEND}\").composeDeviceReservations.capabilities")"

# -----------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------
echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"

if [ "${FAIL}" -gt 0 ]; then
  exit 1
fi
exit 0
