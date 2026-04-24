#!/bin/bash
# Probe: @mermaid-js/mermaid-cli  (binary name: mmdc)
# Gate: skills.docs.mermaid / ENABLE_MERMAID

set -euo pipefail

if [ "${ENABLE_MERMAID:-false}" != "true" ]; then
  echo "SKIP: ENABLE_MERMAID not set"
  exit 77
fi

if ! command -v mmdc &>/dev/null; then
  echo "FAIL: mmdc not found in PATH"
  exit 1
fi

if ! mmdc --version >/dev/null 2>&1 && ! mmdc --help >/dev/null 2>&1; then
  echo "FAIL: mmdc --version and --help both exited non-zero"
  exit 1
fi

echo "PASS: mmdc (@mermaid-js/mermaid-cli) present"
exit 0
