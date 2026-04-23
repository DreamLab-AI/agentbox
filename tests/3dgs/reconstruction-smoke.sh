#!/usr/bin/env bash
# tests/3dgs/reconstruction-smoke.sh
#
# Smoke test for the 3D Gaussian Splatting stack (COLMAP + METIS + LichtFeld).
#
# Reads [skills.spatial_and_3d].gaussian_splatting from agentbox.toml.
# Exits 77 (TAP skip) when the gate is not enabled so CI passes cleanly on
# default manifests.
#
# Assertions (all are sanity-only; no CUDA or GPU access required):
#   1. colmap binary is on PATH.
#   2. `colmap feature_extractor --help` exits 0.
#   3. metis / gpmetis binary is on PATH.
#   4. fixture image exists and is a valid PNG.
#
# Exit codes:
#   0  all assertions passed
#   1  one or more assertions failed
#   77 gaussian_splatting gate is not enabled (TAP skip)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE="${REPO_ROOT}/tests/3dgs/fixtures/sample-256.png"
TOML="${REPO_ROOT}/agentbox.toml"

# -----------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------
PASS=0
FAIL=0

ok() {
  echo "ok $((PASS + FAIL + 1)) - $1"
  PASS=$((PASS + 1))
}

not_ok() {
  echo "not ok $((PASS + FAIL + 1)) - $1"
  echo "  # $2"
  FAIL=$((FAIL + 1))
}

# -----------------------------------------------------------------------
# Read gate from agentbox.toml (pure shell — no external parser required)
# -----------------------------------------------------------------------
read_toml_bool() {
  local key="$1"
  # Extract the value of the last matching key=value line; strip whitespace.
  grep -E "^[[:space:]]*${key}[[:space:]]*=" "${TOML}" 2>/dev/null \
    | tail -1 \
    | sed 's/.*=[[:space:]]*//' \
    | tr -d '[:space:]"'
}

GAUSSIAN_SPLATTING="$(read_toml_bool gaussian_splatting)"

if [ "${GAUSSIAN_SPLATTING}" != "true" ]; then
  echo "1..0 # SKIP [skills.spatial_and_3d].gaussian_splatting is not enabled (value: '${GAUSSIAN_SPLATTING}')"
  exit 77
fi

# -----------------------------------------------------------------------
# TAP output
# -----------------------------------------------------------------------
echo "TAP version 13"
echo "1..4"

# -----------------------------------------------------------------------
# Assertion 1: colmap binary present
# -----------------------------------------------------------------------
if command -v colmap >/dev/null 2>&1; then
  ok "colmap binary is on PATH ($(command -v colmap))"
else
  not_ok "colmap binary is on PATH" "colmap not found; ensure gaussian_splatting derivations are installed"
fi

# -----------------------------------------------------------------------
# Assertion 2: colmap feature_extractor --help exits 0
# -----------------------------------------------------------------------
if colmap feature_extractor --help >/dev/null 2>&1; then
  ok "colmap feature_extractor --help exits 0"
else
  # COLMAP prints help to stderr and may exit non-zero on some versions;
  # capture stderr and treat any output as a pass for the sanity check.
  HELP_OUT="$(colmap feature_extractor --help 2>&1 || true)"
  if echo "${HELP_OUT}" | grep -qi "feature_extractor\|ImageReader\|--help"; then
    ok "colmap feature_extractor --help responds (exit non-zero but help text present)"
  else
    not_ok "colmap feature_extractor --help responds" \
      "No help text detected: ${HELP_OUT:0:120}"
  fi
fi

# -----------------------------------------------------------------------
# Assertion 3: metis / gpmetis binary present
# -----------------------------------------------------------------------
if command -v gpmetis >/dev/null 2>&1 || command -v metis >/dev/null 2>&1; then
  ok "metis/gpmetis binary is on PATH"
else
  not_ok "metis/gpmetis binary is on PATH" \
    "Neither gpmetis nor metis found in PATH"
fi

# -----------------------------------------------------------------------
# Assertion 4: fixture PNG exists and has correct magic bytes
# -----------------------------------------------------------------------
if [ -f "${FIXTURE}" ]; then
  MAGIC="$(xxd -p -l 8 "${FIXTURE}" 2>/dev/null || od -An -tx1 -N8 "${FIXTURE}" | tr -d ' \n')"
  if echo "${MAGIC}" | grep -qi "89504e47"; then
    ok "fixture sample-256.png exists and has PNG magic bytes"
  else
    not_ok "fixture sample-256.png has PNG magic bytes" \
      "Magic: ${MAGIC}"
  fi
else
  not_ok "fixture sample-256.png exists" \
    "Expected at ${FIXTURE}"
fi

# -----------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------
echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"

if [ "${FAIL}" -gt 0 ]; then
  exit 1
fi
exit 0
