#!/usr/bin/env bash
# agentbox-config-validate.sh — bash wrapper for agentbox-config-validate.js
# For flake.nix consumption and CI pipelines.
# Usage: agentbox-config-validate.sh [manifest-path]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Resolve Node binary — prefer nix-shell provided node, fallback to PATH.
if command -v node >/dev/null 2>&1; then
  NODE_BIN="node"
else
  echo "agentbox-config-validate: 'node' not found in PATH" >&2
  exit 1
fi

exec "${NODE_BIN}" "${SCRIPT_DIR}/agentbox-config-validate.js" "$@"
