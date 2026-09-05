#!/usr/bin/env bash
# tests/flake/gpu-backend.test.sh
#
# Unit tests for lib/gpu-backend.nix — the ADR-2006 backend gate.
#
# `nix eval` exercises the dispatch table in evaluation only: no build, no
# derivation realisation, no network beyond fetching the pinned nixpkgs.
#
# Two things this test gets right that its previous version did not:
#
#   1. dispatchGpuBackend takes TWO arguments — `backend` and
#      `toolchainsCudaEnabled` (lib/gpu-backend.nix, "dispatchGpuBackend =
#      backend: toolchainsCudaEnabled:"). Calling it with one argument yielded a
#      partially-applied function, so every attribute selection failed and every
#      assertion compared against an empty string.
#   2. nixpkgs is pinned to the revision in THIS repository's flake.lock, not
#      resolved from whatever `nixpkgs` the user's flake registry happens to
#      point at. A gate that tests a different nixpkgs than the image builds
#      against is not a gate.
#
# Modes:
#   (no arguments)  run the assertions against nix
#   --self-check    validate argument construction and the lock reference
#                   WITHOUT invoking nix; use where nix is unavailable
#
# Exit codes:
#   0  all tests passed (or --self-check passed)
#   1  one or more assertions failed
#   2  bad usage, or the repository state this test depends on is missing
#   77 nix is not available, so the nix assertions were skipped (TAP skip)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCK_FILE="$REPO_ROOT/flake.lock"
GPU_BACKEND_NIX="$REPO_ROOT/lib/gpu-backend.nix"
ERR_LOG="$(mktemp -t gpu-backend-test-stderr.XXXXXX)"
trap 'rm -f "$ERR_LOG"' EXIT

PASS=0
FAIL=0
# Keep in step with the assertions below; checked against PASS+FAIL at the end.
PLAN=23

SELF_CHECK=0
case "${1:-}" in
  "") ;;
  --self-check|--dry-run) SELF_CHECK=1 ;;
  -h|--help)
    sed -n '2,30p' "${BASH_SOURCE[0]}"
    exit 0
    ;;
  *)
    echo "gpu-backend.test.sh: unknown argument '$1' (expected --self-check or nothing)" >&2
    exit 2
    ;;
esac

# -----------------------------------------------------------------------
# This repository's locked nixpkgs
# -----------------------------------------------------------------------
# Reads flake.lock rather than the flake registry: the registry is per-user
# mutable state, and resolving `nixpkgs` from it tests a nixpkgs the image was
# never built against. The revision below is the one flake.nix builds with.
locked_nixpkgs_ref() {
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$LOCK_FILE" <<'PY'
import json, sys

with open(sys.argv[1]) as fh:
    lock = json.load(fh)
nodes = lock["nodes"]
alias = nodes["root"]["inputs"]["nixpkgs"]
if isinstance(alias, list):
    alias = alias[-1]
locked = nodes[alias]["locked"]
if locked.get("type") != "github":
    sys.exit(f"flake.lock nixpkgs is type {locked.get('type')!r}, expected github")
print("github:{owner}/{repo}/{rev}".format(**locked))
PY
  elif command -v jq >/dev/null 2>&1; then
    jq -er '
      .nodes[.nodes.root.inputs.nixpkgs].locked
      | if .type == "github" then "github:\(.owner)/\(.repo)/\(.rev)"
        else error("flake.lock nixpkgs is not a github input") end
    ' "$LOCK_FILE"
  else
    echo "neither python3 nor jq is available to read flake.lock" >&2
    return 1
  fi
}

if [ ! -f "$LOCK_FILE" ]; then
  echo "gpu-backend.test.sh: $LOCK_FILE is missing — cannot pin nixpkgs" >&2
  exit 2
fi
if [ ! -f "$GPU_BACKEND_NIX" ]; then
  echo "gpu-backend.test.sh: $GPU_BACKEND_NIX is missing" >&2
  exit 2
fi
if ! NIXPKGS_REF="$(locked_nixpkgs_ref)"; then
  echo "gpu-backend.test.sh: could not read the locked nixpkgs revision" >&2
  exit 2
fi

# -----------------------------------------------------------------------
# Expression construction
# -----------------------------------------------------------------------

# dispatch BACKEND TOOLCHAINS_CUDA
# Both arguments, always: dispatchGpuBackend is `backend: toolchainsCudaEnabled:`.
dispatch() {
  printf '(gpuLib.dispatchGpuBackend "%s" %s)' "$1" "$2"
}

# nix_program EXPR — the full expression handed to `nix eval`.
nix_program() {
  cat <<NIX
    let
      # Pinned to this repository's flake.lock, never the flake registry.
      nixpkgsFlake = builtins.getFlake "${NIXPKGS_REF}";
      pkgs   = import nixpkgsFlake { system = "x86_64-linux"; config.allowUnfree = true; };
      lib    = pkgs.lib;
      gpuLib = import ${REPO_ROOT}/lib/gpu-backend.nix { inherit lib pkgs; };
    in $1
NIX
}

# nix_eval EXPR — evaluates and prints the result; stderr lands in $ERR_LOG.
# `--impure` is required only because the repository path is imported directly;
# nixpkgs itself is a locked, immutable reference, so the evaluation is pinned.
nix_eval() {
  nix eval --impure --expr "$(nix_program "$1")" 2>"$ERR_LOG"
}

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "ok - ${label}"
    PASS=$(( PASS + 1 ))
  else
    echo "not ok - ${label}"
    echo "  expected: ${expected}"
    echo "  actual:   ${actual}"
    if [ -s "$ERR_LOG" ]; then
      echo "  nix stderr:"
      sed 's/^/    /' "$ERR_LOG"
    fi
    FAIL=$(( FAIL + 1 ))
  fi
}

assert_contains() {
  local label="$1" needle="$2" haystack="$3"
  if echo "$haystack" | grep -qF "$needle"; then
    echo "ok - ${label}"
    PASS=$(( PASS + 1 ))
  else
    echo "not ok - ${label}"
    echo "  expected to contain: ${needle}"
    echo "  actual:              ${haystack}"
    if [ -s "$ERR_LOG" ]; then
      echo "  nix stderr:"
      sed 's/^/    /' "$ERR_LOG"
    fi
    FAIL=$(( FAIL + 1 ))
  fi
}

# -----------------------------------------------------------------------
# --self-check: validate everything that does not need nix
# -----------------------------------------------------------------------
if [ "$SELF_CHECK" -eq 1 ]; then
  echo "=== gpu-backend.test.sh --self-check (no nix invoked) ==="
  rc=0

  arity_line="$(grep -n 'dispatchGpuBackend = ' "$GPU_BACKEND_NIX" || true)"
  if echo "$arity_line" | grep -q 'dispatchGpuBackend = backend: toolchainsCudaEnabled:'; then
    echo "ok   - lib/gpu-backend.nix declares dispatchGpuBackend with two parameters"
    echo "       ${arity_line}"
  else
    echo "FAIL - dispatchGpuBackend is not the two-parameter function this test calls"
    echo "       found: ${arity_line:-<none>}"
    rc=1
  fi

  bad_calls="$(grep -nE 'dispatchGpuBackend \\?"[a-z-]+\\?"[^ ]*\)' "${BASH_SOURCE[0]}" || true)"
  if [ -z "$bad_calls" ]; then
    echo "ok   - no single-argument dispatchGpuBackend call remains in this test"
  else
    echo "FAIL - single-argument dispatch calls found:"
    echo "$bad_calls"
    rc=1
  fi

  for pair in "none false" "ollama-rocm false" "ollama-cuda false" "local-cuda true" "local-cuda false" "none true"; do
    # shellcheck disable=SC2086
    rendered="$(dispatch $pair)"
    if echo "$rendered" | grep -qE '^\(gpuLib\.dispatchGpuBackend "[a-z-]+" (true|false)\)$'; then
      echo "ok   - two-argument call renders correctly: ${rendered}"
    else
      echo "FAIL - malformed dispatch call: ${rendered}"
      rc=1
    fi
  done

  if echo "$NIXPKGS_REF" | grep -qE '^github:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/[0-9a-f]{40}$'; then
    echo "ok   - nixpkgs pinned to this repository's flake.lock: ${NIXPKGS_REF}"
  else
    echo "FAIL - nixpkgs reference is not a locked github revision: ${NIXPKGS_REF}"
    rc=1
  fi

  # The registry form this test used to resolve was `builtins.getFlake` applied
  # to the bare flake-registry alias, which silently evaluates against whatever
  # nixpkgs the RUNNER's registry happens to point at rather than this
  # repository's lock. The needle is assembled from fragments so this guard
  # cannot match its own source line — grepping for the literal made the check
  # fail on itself, which is a false alarm, not a finding.
  registry_needle='builtins.getFlake "'"nixpkgs"'"'
  if grep -qF "$registry_needle" "${BASH_SOURCE[0]}"; then
    echo "FAIL - a registry nixpkgs reference is still present"
    rc=1
  else
    echo "ok   - no registry nixpkgs reference remains (only the pinned revision)"
  fi

  program="$(nix_program "$(dispatch none false).ollamaEnabled")"
  if echo "$program" | grep -qF "$NIXPKGS_REF" \
     && echo "$program" | grep -qF "${REPO_ROOT}/lib/gpu-backend.nix"; then
    echo "ok   - the evaluated program pins nixpkgs and imports this repository's lib"
  else
    echo "FAIL - the evaluated program does not reference the lock or the repo lib"
    rc=1
  fi

  echo
  echo "--- rendered nix program (not executed) ---"
  echo "$program"
  echo "-------------------------------------------"
  echo
  if command -v nix >/dev/null 2>&1; then
    echo "note: nix IS available here; run this script without --self-check to execute the assertions."
  else
    echo "note: nix is NOT available here; the nix assertions were not executed by this self-check."
  fi
  if [ "$rc" -eq 0 ]; then
    echo "self-check: PASS"
  else
    echo "self-check: FAIL"
  fi
  exit "$rc"
fi

# -----------------------------------------------------------------------
# Skip only when nix is genuinely absent
# -----------------------------------------------------------------------
if ! command -v nix >/dev/null 2>&1; then
  echo "1..0 # SKIP nix not found in PATH"
  echo "SKIPPED: the ${PLAN} lib/gpu-backend.nix dispatch assertions (backends none," >&2
  echo "  ollama-rocm, ollama-cuda, local-cuda and the toolchains.cuda cross-constraint)" >&2
  echo "  were NOT executed: this test evaluates them with 'nix eval' against the nixpkgs" >&2
  echo "  revision pinned in ${LOCK_FILE} (${NIXPKGS_REF}), and no 'nix' binary is in PATH." >&2
  echo "  Nothing about the GPU backend dispatch table has been verified by this run." >&2
  echo "  Run '$0 --self-check' to validate the call construction and lock reference without nix." >&2
  exit 77
fi

# -----------------------------------------------------------------------
# Test plan
# -----------------------------------------------------------------------
echo "1..${PLAN}"

# -----------------------------------------------------------------------
# Case 1: none
# -----------------------------------------------------------------------
BACKEND="none"
CALL="$(dispatch "$BACKEND" false)"

assert_eq "${BACKEND}: ollamaEnabled is false" \
  "false" \
  "$(nix_eval "${CALL}.ollamaEnabled")"

assert_eq "${BACKEND}: devicesNeeded is empty list" \
  "[ ]" \
  "$(nix_eval "${CALL}.devicesNeeded")"

assert_eq "${BACKEND}: runtimeClass is empty string" \
  '""' \
  "$(nix_eval "${CALL}.runtimeClass")"

assert_eq "${BACKEND}: nixPackages is empty list" \
  "[ ]" \
  "$(nix_eval "${CALL}.nixPackages")"

assert_eq "${BACKEND}: composeDeviceReservations is null" \
  "null" \
  "$(nix_eval "${CALL}.composeDeviceReservations")"

# -----------------------------------------------------------------------
# Case 2: ollama-rocm
# -----------------------------------------------------------------------
BACKEND="ollama-rocm"
CALL="$(dispatch "$BACKEND" false)"

assert_eq "${BACKEND}: ollamaEnabled is true" \
  "true" \
  "$(nix_eval "${CALL}.ollamaEnabled")"

assert_contains "${BACKEND}: devicesNeeded contains /dev/kfd" \
  "/dev/kfd:/dev/kfd" \
  "$(nix_eval "${CALL}.devicesNeeded")"

assert_contains "${BACKEND}: devicesNeeded contains /dev/dri" \
  "/dev/dri:/dev/dri" \
  "$(nix_eval "${CALL}.devicesNeeded")"

assert_eq "${BACKEND}: runtimeClass is empty (default OCI)" \
  '""' \
  "$(nix_eval "${CALL}.runtimeClass")"

assert_contains "${BACKEND}: envVars contains OLLAMA_VULKAN" \
  "OLLAMA_VULKAN" \
  "$(nix_eval "builtins.attrNames ${CALL}.envVars")"

# -----------------------------------------------------------------------
# Case 3: ollama-cuda
# -----------------------------------------------------------------------
BACKEND="ollama-cuda"
CALL="$(dispatch "$BACKEND" false)"

assert_eq "${BACKEND}: ollamaEnabled is true" \
  "true" \
  "$(nix_eval "${CALL}.ollamaEnabled")"

assert_eq "${BACKEND}: runtimeClass is nvidia" \
  '"nvidia"' \
  "$(nix_eval "${CALL}.runtimeClass")"

assert_eq "${BACKEND}: devicesNeeded is empty (uses reservations)" \
  "[ ]" \
  "$(nix_eval "${CALL}.devicesNeeded")"

assert_contains "${BACKEND}: composeDeviceReservations has driver=nvidia" \
  "driver" \
  "$(nix_eval "builtins.attrNames ${CALL}.composeDeviceReservations")"

assert_eq "${BACKEND}: nixPackages is empty (CUDA lives in sidecar)" \
  "[ ]" \
  "$(nix_eval "${CALL}.nixPackages")"

# -----------------------------------------------------------------------
# Case 4: local-cuda with [toolchains].cuda = true
# (the combination flake.nix:3490 uses)
# -----------------------------------------------------------------------
BACKEND="local-cuda"
CALL="$(dispatch "$BACKEND" true)"

assert_eq "${BACKEND} (cuda=true): ollamaEnabled is true" \
  "true" \
  "$(nix_eval "${CALL}.ollamaEnabled")"

assert_eq "${BACKEND} (cuda=true): runtimeClass is nvidia" \
  '"nvidia"' \
  "$(nix_eval "${CALL}.runtimeClass")"

assert_contains "${BACKEND} (cuda=true): nixPackages is non-empty" \
  "cudatoolkit" \
  "$(nix_eval "map (p: p.pname or p.name or \"?\") ${CALL}.nixPackages")"

assert_contains "${BACKEND} (cuda=true): supervisorExtraEnv has CUDA_VISIBLE_DEVICES" \
  "CUDA_VISIBLE_DEVICES" \
  "$(nix_eval "builtins.attrNames ${CALL}.supervisorExtraEnv")"

assert_contains "${BACKEND} (cuda=true): composeDeviceReservations has compute capability" \
  "compute" \
  "$(nix_eval "${CALL}.composeDeviceReservations.capabilities")"

# -----------------------------------------------------------------------
# Case 5: the second argument actually changes the answer, and the
# cross-constraint (validator rule E019) is enforced at eval time.
# -----------------------------------------------------------------------
CALL_BASE="$(dispatch local-cuda false)"
CALL_EXT="$(dispatch local-cuda true)"

assert_contains "local-cuda (cuda=false): base CUDA packages are still present" \
  "cudatoolkit" \
  "$(nix_eval "map (p: p.pname or p.name or \"?\") ${CALL_BASE}.nixPackages")"

assert_eq "local-cuda: toolchains.cuda=true adds packages beyond the base set" \
  "true" \
  "$(nix_eval "(builtins.length ${CALL_EXT}.nixPackages) > (builtins.length ${CALL_BASE}.nixPackages)")"

assert_eq "toolchains.cuda=true with backend=none is rejected (E019)" \
  "false" \
  "$(nix_eval "(builtins.tryEval $(dispatch none true).ollamaEnabled).success")"

# -----------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------
echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"

RUN=$(( PASS + FAIL ))
if [ "$RUN" -ne "$PLAN" ]; then
  echo "Bail out! plan says ${PLAN} assertions, ${RUN} ran" >&2
  exit 1
fi

if [ "${FAIL}" -gt 0 ]; then
  # nix is present, so a failing assertion is a real failure, never a skip.
  exit 1
fi
exit 0
