#!/usr/bin/env bash
# Agentbox policy adapter; VisionCraft owns execution and receipt validation.
set -uo pipefail
if ! command -v agentbox-manifest >/dev/null 2>&1; then
  echo 'visioncraft gate: agentbox-manifest unavailable; rebuild/install the pinned host tools' >&2
  exit 78
fi
exec agentbox-manifest deepsec-gate "$@"
