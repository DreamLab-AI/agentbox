#!/bin/bash
# ADR-2207 D6: record what the image build actually resolved, for /health.
#
#   write-versions.sh <out.json>
#
# Every probe is fail-open: a missing binary or a failing command records
# "unknown", and the script itself always exits 0, so it can never fail the build.
# Overridable for tests: CHROME_BETA_BIN, CHROMIUM_BIN, NPM_GLOBAL_ROOT.
set -u
OUT="${1:-/opt/browsercontainer/versions.json}"

first_line() { # first_line <cmd...>: first stdout line, or "unknown"
  local v
  v="$("$@" 2>/dev/null | head -n 1)" || v=""
  [ -n "$v" ] && printf '%s' "$v" || printf 'unknown'
}

CHROME_BETA="$(first_line "${CHROME_BETA_BIN:-/opt/google/chrome-beta/chrome}" --version)"
CHROMIUM="$(first_line "${CHROMIUM_BIN:-/usr/bin/chromium}" --version)"
FFMPEG="$(first_line ffmpeg -version)"
OPENBOX="$(first_line pacman -Q openbox)"
NPM_ROOT="${NPM_GLOBAL_ROOT:-$(npm root -g 2>/dev/null || echo /usr/lib/node_modules)}"

CHROME_BETA="$CHROME_BETA" CHROMIUM="$CHROMIUM" FFMPEG="$FFMPEG" OPENBOX="$OPENBOX" NPM_ROOT="$NPM_ROOT" \
node -e '
  const fs = require("fs");
  let mcp = "unknown";
  try { mcp = JSON.parse(fs.readFileSync(process.env.NPM_ROOT + "/chrome-devtools-mcp/package.json", "utf8")).version || "unknown"; } catch {}
  const v = {
    chrome_beta: process.env.CHROME_BETA,
    chromium: process.env.CHROMIUM,
    "chrome-devtools-mcp": mcp,
    node: process.version,
    ffmpeg: process.env.FFMPEG,
    openbox: process.env.OPENBOX,
    built_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
  fs.writeFileSync(process.argv[1], JSON.stringify(v, null, 2) + "\n");
' "$OUT" || echo '{"error":"version probe failed"}' >"$OUT" || true
exit 0
