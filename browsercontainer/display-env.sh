# shellcheck shell=bash
# ADR-2207 D1: the single definition of the sidecar's display.
#
# Sourced (never executed) by start-xvfb.sh, launch-chromium.sh and record.sh.
# BROWSER_DISPLAY_SIZE (default 1920x1080) must be WxH: both plain decimal
# integers with no leading zero, 16:9 exactly (W*9 == H*16), and W between 1280
# and 3840. Anything else exits the sourcing script non-zero before it starts
# anything, so Xvfb, Chrome and the recorder can never disagree on the size.
# On success it sets BROWSER_DISPLAY_W and BROWSER_DISPLAY_H.
# display.js holds the same rules for the Node side; tests keep the two in step.

BROWSER_DISPLAY_SIZE="${BROWSER_DISPLAY_SIZE:-1920x1080}"

_bc_display_fail() {
  echo "[display] FATAL: BROWSER_DISPLAY_SIZE='${BROWSER_DISPLAY_SIZE}' $1" >&2
  exit 64
}

if [[ ! "$BROWSER_DISPLAY_SIZE" =~ ^([1-9][0-9]{0,4})x([1-9][0-9]{0,4})$ ]]; then
  _bc_display_fail "is not WxH (decimal integers, no leading zero), e.g. 1920x1080"
fi
BROWSER_DISPLAY_W="${BASH_REMATCH[1]}"
BROWSER_DISPLAY_H="${BASH_REMATCH[2]}"
# Regex above guarantees plain decimals, so the arithmetic below never sees octal.
if (( BROWSER_DISPLAY_W * 9 != BROWSER_DISPLAY_H * 16 )); then
  _bc_display_fail "is not 16:9 (W*9 must equal H*16)"
fi
if (( BROWSER_DISPLAY_W < 1280 || BROWSER_DISPLAY_W > 3840 )); then
  _bc_display_fail "width must be between 1280 and 3840"
fi
export BROWSER_DISPLAY_SIZE BROWSER_DISPLAY_W BROWSER_DISPLAY_H
unset -f _bc_display_fail
