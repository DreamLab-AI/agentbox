#!/bin/bash
# Probe: Agentbox's mmdc compatibility client (browsercontainer renderer)
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

if ! mmdc --help >/dev/null 2>&1; then
  echo "FAIL: mmdc sidecar client --help exited non-zero"
  exit 1
fi

echo "PASS: mmdc sidecar client present (rendering tested separately)"
exit 0
