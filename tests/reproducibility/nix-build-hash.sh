#!/usr/bin/env bash
# tests/reproducibility/nix-build-hash.sh
#
# Verifies that two consecutive Nix builds of the runtime image produce
# bit-for-bit identical output paths.
#
# References:
#   ADR-001  — Nix flakes as the reproducible build foundation
#   PRD-001  — Goal #2: every build from the same inputs produces the same image
#
# Exit codes:
#   0  — both builds match (reproducible)
#   1  — builds diverge (non-determinism detected)
#   77 — nix binary unavailable (test skipped)

set -euo pipefail

# Skip gracefully when Nix is not available in the current environment.
if ! command -v nix >/dev/null 2>&1; then
    echo "SKIP: nix not found in PATH — skipping reproducibility check (exit 77)"
    exit 77
fi

TARGET=".#runtime"

echo "==> Build 1: nix build ${TARGET} --print-out-paths"
OUT1=$(nix build "${TARGET}" --print-out-paths --no-link 2>&1 | tail -1)
echo "    out-path: ${OUT1}"

BLOB1=$(find "${OUT1}" -type f | sort | xargs sha256sum | sha256sum | awk '{print $1}')
echo "    sha256:   ${BLOB1}"

echo ""
echo "==> Build 2: nix build ${TARGET} --print-out-paths"
OUT2=$(nix build "${TARGET}" --print-out-paths --no-link 2>&1 | tail -1)
echo "    out-path: ${OUT2}"

BLOB2=$(find "${OUT2}" -type f | sort | xargs sha256sum | sha256sum | awk '{print $1}')
echo "    sha256:   ${BLOB2}"

echo ""
if [ "${BLOB1}" = "${BLOB2}" ]; then
    echo "PASS: both builds are identical (${BLOB1})"
    exit 0
else
    echo "FAIL: builds diverge — non-determinism detected"
    echo "  build 1 sha256: ${BLOB1}"
    echo "  build 2 sha256: ${BLOB2}"
    exit 1
fi
