#!/usr/bin/env bash
# Publish the baked fixtures into the shared tree, then run the job runner in the foreground.
set -euo pipefail
ROOT="${ISAAC_RUNNER_ROOT:-/exchange/isaac}"
mkdir -p "$ROOT/inbox" "$ROOT/jobs" "$ROOT/fixtures"
# Fixtures are versioned with the image: replace them wholesale so a stale copy never survives.
rm -rf "$ROOT/fixtures/fixtures" "$ROOT/fixtures/lib"
cp -r /opt/isaac-sim-assets/fixtures "$ROOT/fixtures/fixtures"
cp -r /opt/isaac-sim-assets/lib "$ROOT/fixtures/lib"
exec /isaac-sim/kit/python/bin/python3 /opt/isaac-runner/isaac_runner.py
