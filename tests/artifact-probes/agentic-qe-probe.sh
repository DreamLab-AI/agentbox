#!/bin/bash
# Probe: agentic-qe CLI  (binary name: aqe)
# Gate: toolchains.agentic_qe / ENABLE_AGENTIC_QE
#
# NOTE: aqe init --auto is intentionally NOT run here.
# First-run initialisation is deferred to agentbox.sh init (see PRD-002 §9).

set -euo pipefail

if [ "${ENABLE_AGENTIC_QE:-false}" != "true" ]; then
  echo "SKIP: ENABLE_AGENTIC_QE not set"
  exit 77
fi

if ! command -v aqe &>/dev/null; then
  echo "FAIL: aqe not found in PATH"
  exit 1
fi

if ! aqe --version >/dev/null 2>&1 && ! aqe --help >/dev/null 2>&1; then
  echo "FAIL: aqe --version and --help both exited non-zero"
  exit 1
fi

echo "PASS: aqe present"
exit 0
