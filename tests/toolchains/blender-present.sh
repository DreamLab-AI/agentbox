#!/bin/bash
# Test: Blender presence check
# Ensures the in-container blender binary is available when
# [skills.spatial_and_3d].blender = true AND blender_local is not false.
# Sidecar-only deployments (blender_local = false) skip: Blender runs in gui-tools-service.

set -euo pipefail

# Skip if Blender is not enabled
BLENDER_ENABLED="${ENABLE_BLENDER:-false}"
if [ "$BLENDER_ENABLED" != "true" ]; then
  echo "SKIP: Blender not enabled in agentbox.toml"
  exit 77
fi
if [ "${ENABLE_BLENDER_LOCAL:-true}" != "true" ]; then
  echo "SKIP: blender_local = false (sidecar-only); the in-container binary is intentionally absent"
  exit 77
fi

# Test: blender --version exits cleanly
if ! command -v blender &> /dev/null; then
  echo "FAIL: blender command not found in PATH"
  exit 1
fi

if ! blender --version > /dev/null 2>&1; then
  echo "FAIL: blender --version exited with non-zero status"
  exit 1
fi

echo "PASS: Blender is present and functional"
exit 0
