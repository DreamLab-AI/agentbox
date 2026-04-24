#!/usr/bin/env bash
# tests/artifact-probes/runner.sh — TAP-style artifact probe runner.
#
# Iterates config/artifact-probes.json and runs each probe command.
# Outputs TAP 13 lines to stdout so the result integrates with any TAP harness.
#
# Exit codes:
#   0  — all probes passed (or all failures were optional)
#   1  — one or more required probes failed
#   77 — SKIP: Docker not available or not running inside the container
#        (TAP skip-77 convention for tests that require the container runtime)
#
# Environment:
#   AGENTBOX_PROBES_FILE  — override path to artifact-probes.json
#                           (default: relative to this script's repo root)

set -euo pipefail

# Resolve repo root regardless of invocation directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PROBES_FILE="${AGENTBOX_PROBES_FILE:-${REPO_ROOT}/config/artifact-probes.json}"

# TAP skip-77: tests requiring a live container runtime but Docker unavailable.
# This runner probes binaries that exist inside the container; if we are not
# inside the container, skip rather than spuriously fail.
if [ ! -f /opt/agentbox/config/validate-artifacts.sh ] && \
   [ "${AGENTBOX_FORCE_RUN:-0}" != "1" ]; then
  echo "1..1"
  echo "ok 1 # SKIP not running inside agentbox container (set AGENTBOX_FORCE_RUN=1 to override)"
  exit 77
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Bail out! jq is required but not found in PATH"
  exit 1
fi

if [ ! -f "$PROBES_FILE" ]; then
  echo "Bail out! artifact-probes.json not found at: $PROBES_FILE"
  exit 1
fi

# Count total test cases.
TOTAL=$(jq 'length' "$PROBES_FILE")
echo "TAP version 13"
echo "1..${TOTAL}"

FAILED_REQUIRED=0
TEST_NUM=0

while IFS= read -r entry; do
  TEST_NUM=$(( TEST_NUM + 1 ))
  cap_id=$(jq -r '.capability_id' <<< "$entry")
  required=$(jq -r '.required_for_readiness' <<< "$entry")
  probe_cmd=$(jq -r '.probe_command' <<< "$entry")

  # Skip placeholder entries (not yet substituted by flake.nix at build time).
  if [[ "$probe_cmd" == *"@"*"@"* ]]; then
    echo "ok ${TEST_NUM} # SKIP ${cap_id}: entrypoint placeholder not resolved (feature disabled at build time)"
    continue
  fi

  if eval "$probe_cmd" >/dev/null 2>&1; then
    echo "ok ${TEST_NUM} - ${cap_id}"
  else
    if [ "$required" = "true" ]; then
      echo "not ok ${TEST_NUM} - ${cap_id} # REQUIRED probe failed: ${probe_cmd}"
      FAILED_REQUIRED=$(( FAILED_REQUIRED + 1 ))
    else
      echo "ok ${TEST_NUM} # SKIP ${cap_id}: optional probe failed (non-fatal): ${probe_cmd}"
    fi
  fi
done < <(jq -c '.[]' "$PROBES_FILE")

if [ "$FAILED_REQUIRED" -gt 0 ]; then
  echo "# ${FAILED_REQUIRED} required probe(s) failed"
  exit 1
fi

echo "# All required probes passed (${TEST_NUM} total)"
