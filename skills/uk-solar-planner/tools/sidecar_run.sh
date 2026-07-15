#!/usr/bin/env bash
# sidecar_run.sh — run a solar-compute tool inside the gui-tools GPU sidecar's venv
# from agentbox-main (which is nix-pure and cannot install quartz/opendss itself).
# The sidecar is FHS with a pinned /opt/solar-venv; agentbox-main reaches it via the
# mounted docker socket.
#
# Subcommands:
#   forecast <lat> <lon> <capacity_kwp> [tilt] [orientation]
#       → 0–48h UK generation forecast (Open Climate Fix quartz-solar-forecast)
#   python <args...>
#       → arbitrary python in the solar venv (e.g. for OpenDSS scripting)
#
# Requires: `./agentbox.sh gui-tools up` (the sidecar must be running and built with
# the solar layer — see gui-tools-sidecar/Dockerfile).
set -uo pipefail
SIDECAR="${GUI_TOOLS_CONTAINER:-gui-tools-service}"
VENV="/opt/solar-venv/bin/python"

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$SIDECAR"; then
  echo "sidecar_run: $SIDECAR is not running. Start it: ./agentbox.sh gui-tools up" >&2
  exit 1
fi
if ! docker exec "$SIDECAR" test -x "$VENV" 2>/dev/null; then
  echo "sidecar_run: $VENV not found in $SIDECAR — rebuild the sidecar with the solar layer (gui-tools rebuild)" >&2
  exit 1
fi

sub="${1:-help}"; shift 2>/dev/null || true
case "$sub" in
  forecast)
    exec docker exec "$SIDECAR" "$VENV" /opt/gui-tools/forecast_quartz.py "$@"
    ;;
  python)
    exec docker exec "$SIDECAR" "$VENV" "$@"
    ;;
  *)
    echo "usage: sidecar_run.sh {forecast <lat> <lon> <kwp> [tilt] [orient] | python <args>}" >&2
    exit 2
    ;;
esac
