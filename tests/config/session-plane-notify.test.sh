#!/usr/bin/env bash
# Execute the real Stage-B projection without inheriting Stage-A shell variables.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export CODEX_HOME="$T/codex"
mkdir -p "$CODEX_HOME"
export ENTRYPOINT="$ROOT/config/entrypoint-unified.sh"
node - <<'JS' > "$T/project.sh"
const fs = require('fs');
const s = fs.readFileSync(process.env.ENTRYPOINT, 'utf8');
const start = s.indexOf('SESSION_PLANE="$_IP_ENABLED" VL_ON=');
const end = s.indexOf('\nSESSIONCODEX', start) + '\nSESSIONCODEX'.length;
if (start < 0 || end < start) throw new Error('missing Stage-B projection');
console.log(s.slice(start, end));
JS
(
  unset _VL_ENABLED _VL_RECORD
  _IP_ENABLED=1
  _ab_toml_bool() { echo 1; }
  _ab_toml_val() { echo true; }
  source "$T/project.sh"
)
node - <<'JS'
const fs = require('fs'), assert = require('assert');
const text = fs.readFileSync(process.env.CODEX_HOME + '/config.toml', 'utf8');
assert(text.includes('session-state.cjs'));
assert(text.includes('"--voice"'));
JS
(
  unset _VL_ENABLED _VL_RECORD
  _IP_ENABLED=0
  _ab_toml_bool() { echo 1; }
  _ab_toml_val() { echo true; }
  source "$T/project.sh"
)
node - <<'JS'
const fs = require('fs'), assert = require('assert');
const text = fs.readFileSync(process.env.CODEX_HOME + '/config.toml', 'utf8');
assert(!text.includes('session-state.cjs'));
assert(text.includes('voice-paned'));
JS
printf 'session-plane notify: fresh Stage-B environment and gate retraction pass\n'
