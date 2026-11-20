#!/bin/bash
# ADR-2207 D1: Xvfb on :2 at the one configured display size (display-env.sh).
# exec, so supervisord's signals reach Xvfb itself. An invalid
# BROWSER_DISPLAY_SIZE stops here, before any X server exists.
set -eu
# shellcheck source=display-env.sh
. "$(dirname "${BASH_SOURCE[0]}")/display-env.sh"
exec "${XVFB_BIN:-Xvfb}" :2 -screen 0 "${BROWSER_DISPLAY_W}x${BROWSER_DISPLAY_H}x24" \
  -ac +extension GLX +render -noreset
