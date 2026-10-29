#!/bin/bash
# Probe: Pele renderer (pele-render CLI and its mmdc compatibility shim, ADR-2154)
# Gate: skills.docs.mermaid / ENABLE_MERMAID
# Parses a tiny diagram, so a broken pin or loader fails here, not just a missing binary.

set -euo pipefail

if [ "${ENABLE_MERMAID:-false}" != "true" ]; then
  echo "SKIP: ENABLE_MERMAID not set"
  exit 77
fi

for tool in pele-render mmdc; do
  if ! command -v "$tool" &>/dev/null; then
    echo "FAIL: $tool not found in PATH"
    exit 1
  fi
done

if ! printf 'flowchart LR\n  A[probe] --> B\n' | pele-render --check --quiet -; then
  echo "FAIL: pele-render --check rejected a trivial flowchart"
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
printf 'flowchart LR\n  A[probe] --> B\n' > "$tmp/p.mmd"
if ! mmdc -q -i "$tmp/p.mmd" -o "$tmp/p.svg" || ! grep -q '<svg' "$tmp/p.svg"; then
  echo "FAIL: mmdc shim did not render a trivial flowchart"
  exit 1
fi

echo "PASS: pele-render and the mmdc shim render a trivial diagram"
exit 0
