#!/usr/bin/env bash
# Host-only lock; preparation never invokes compose up/down.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for arg in "$@"; do
  if [[ "$arg" == "--help" || "$arg" == "-h" ]]; then
    exec node "$repo_root/scripts/runtime-delivery.cjs" "$@"
  fi
done
mkdir -p "$repo_root/.agentbox-build"
exec flock -n "$repo_root/.agentbox-build/lifecycle.lock" \
  node "$repo_root/scripts/runtime-delivery.cjs" "$@"
