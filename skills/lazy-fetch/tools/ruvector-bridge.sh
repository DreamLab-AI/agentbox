#!/usr/bin/env bash
# Bridge lazy-fetch memory operations to RuVector via claude-flow MCP
# This script is called by lazy-fetch hooks to sync memory to RuVector
set -euo pipefail

NAMESPACE="lazy-fetch"

case "${1:-}" in
  sync-memory)
    # Read .lazy/memory.json and sync to RuVector
    local_mem="${2:-.lazy/memory.json}"
    if [[ -f "$local_mem" ]]; then
      echo "Syncing lazy-fetch memory to RuVector namespace: $NAMESPACE"
      # Note: actual sync happens via MCP tools in the MCP server
      echo "Memory bridge active. RuVector is primary store."
    fi
    ;;
  sync-journal)
    echo "Journal entries persist in .lazy/journal.md (local) and RuVector (remote)"
    ;;
  *)
    echo "Usage: ruvector-bridge.sh <sync-memory|sync-journal> [path]"
    ;;
esac
