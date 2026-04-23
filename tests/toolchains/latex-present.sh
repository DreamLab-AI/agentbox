#!/bin/bash
# Test: TeX Live LaTeX presence check
# Ensures pdflatex and LaTeX tooling are available when [skills.docs].latex = true

set -euo pipefail

# Skip if LaTeX is not enabled
LATEX_ENABLED="${ENABLE_LATEX:-false}"
if [ "$LATEX_ENABLED" != "true" ]; then
  echo "SKIP: LaTeX not enabled in agentbox.toml"
  exit 77
fi

# Test: pdflatex --version exits cleanly
if ! command -v pdflatex &> /dev/null; then
  echo "FAIL: pdflatex command not found in PATH"
  exit 1
fi

if ! pdflatex --version > /dev/null 2>&1; then
  echo "FAIL: pdflatex --version exited with non-zero status"
  exit 1
fi

# Test: biber (bibliography engine) is available
if ! command -v biber &> /dev/null; then
  echo "FAIL: biber command not found in PATH"
  exit 1
fi

echo "PASS: TeX Live and LaTeX tooling are present and functional"
exit 0
