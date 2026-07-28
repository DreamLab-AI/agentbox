#!/usr/bin/env bash
# Full quality-assurance sweep: analysis -> refactor -> test -> optimize.
# Usage: qa-chain.sh [timeout_seconds]
# Runs the four battle-tested pipelines in sequence, stopping on first failure.
set -euo pipefail

TIMEOUT="${1:-60}"

for stage in analysis refactor test optimize; do
  echo ">>> stream-chain pipeline ${stage} (timeout ${TIMEOUT}s)"
  claude-flow stream-chain pipeline "${stage}" --timeout "${TIMEOUT}" --verbose
done

echo ">>> QA chain complete."
