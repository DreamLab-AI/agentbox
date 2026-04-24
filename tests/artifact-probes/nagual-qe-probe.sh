#!/bin/bash
# Probe: nagual-qe CLI  (binary name: nagual-qe)
# Gate: toolchains.nagual_qe / ENABLE_NAGUAL_QE
#
# NOTE: nagual-qe is not currently published to the public npm registry.
# The Nix derivation uses lib.fakeHash + throw-gate until the package is
# published or a private registry URL is provided.  This probe will skip
# (exit 77) if ENABLE_NAGUAL_QE is not set, or fail if the binary is absent
# despite the gate being enabled (indicating a broken derivation).

set -euo pipefail

if [ "${ENABLE_NAGUAL_QE:-false}" != "true" ]; then
  echo "SKIP: ENABLE_NAGUAL_QE not set"
  exit 77
fi

if ! command -v nagual-qe &>/dev/null; then
  echo "FAIL: nagual-qe not found in PATH (package may not be published to npm)"
  exit 1
fi

if ! nagual-qe --version >/dev/null 2>&1 && ! nagual-qe --help >/dev/null 2>&1; then
  echo "FAIL: nagual-qe --version and --help both exited non-zero"
  exit 1
fi

echo "PASS: nagual-qe present"
exit 0
