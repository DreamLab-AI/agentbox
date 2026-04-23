#!/usr/bin/env bash
set -euo pipefail

STACK="${1:-claude-core}"
LAYOUT_DIR="${ZELLIJ_LAYOUT_DIR:-/workspace/.config/zellij/layouts}"
LAYOUT_FILE="${LAYOUT_DIR}/${STACK}.kdl"

if [ ! -f "$LAYOUT_FILE" ]; then
  echo "Unknown stack layout: $STACK" >&2
  echo "Available layouts:" >&2
  ls -1 "$LAYOUT_DIR" 2>/dev/null | sed 's/\.kdl$//' >&2 || true
  exit 1
fi

exec zellij --layout "$LAYOUT_FILE" --session "$STACK"
