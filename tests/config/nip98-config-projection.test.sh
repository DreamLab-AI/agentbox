#!/usr/bin/env bash
# nip98-config-projection — ab_nip98_project (config/lib/nip98-config.sh), the
# boot step that decides whether the NIP-98 door has a config file (W3-05).
# A stub agentbox-manifest on PATH stands in for the Rust projector.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$HERE/../../config/lib/nip98-config.sh"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok %d - %s\n' "$((PASS+FAIL))" "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok %d - %s\n' "$((PASS+FAIL))" "$1"; }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"; : >"$T/manifest.toml"
OUT="$T/ws/.agentbox/nip98.json"
# shellcheck source=../../config/lib/nip98-config.sh
. "$LIB"
stub() { printf '#!/bin/sh\n%s\n' "$1" >"$T/bin/agentbox-manifest"; chmod +x "$T/bin/agentbox-manifest"; }
run() { PATH="$T/bin:$PATH" ab_nip98_project "$T/manifest.toml" "$OUT" >/dev/null 2>&1; echo $?; }

# 1. projector writes the file -> kept as projected
rm -rf "$T/ws"; stub 'mkdir -p "$(dirname "$5")"; printf "{\"routes\":[],\"allowedPubkeys\":[\"aa\"]}" >"$5"'
[ "$(run)" = 0 ] && grep -q '"aa"' "$OUT" && ok "projected file is kept" || bad "projected file is kept"
# 2. section absent: projector rc 0, no file -> explicit empty config
rm -rf "$T/ws"; stub 'exit 0'
[ "$(run)" = 0 ] && [ "$(cat "$OUT")" = '{"routes":[],"allowedPubkeys":[]}' ] && ok "absent section -> explicit empty config" || bad "absent section -> explicit empty config"
# 3. projector fails, no prior file -> no file (door stays closed), boot rc 0
rm -rf "$T/ws"; stub 'echo boom >&2; exit 3'
[ "$(run)" = 0 ] && [ ! -e "$OUT" ] && ok "projector failure leaves NO file, rc 0" || bad "projector failure leaves NO file, rc 0"
# 4. projector fails, last-good file present -> untouched
mkdir -p "$T/ws/.agentbox"; printf '{"routes":[],"allowedPubkeys":["bb"]}' >"$OUT"; stub 'exit 3'
[ "$(run)" = 0 ] && grep -q '"bb"' "$OUT" && ok "projector failure keeps the last-good file" || bad "projector failure keeps the last-good file"
# 5. agentbox-manifest not on PATH -> no file, rc 0
rm -rf "$T/ws" "$T/bin/agentbox-manifest"
[ "$(PATH="/usr/bin:/bin" ab_nip98_project "$T/manifest.toml" "$OUT" >/dev/null 2>&1; echo $?)" = 0 ] && [ ! -e "$OUT" ] && ok "missing projector binary: no file, rc 0" || bad "missing projector binary: no file, rc 0"
# 6. manifest missing -> no file, rc 0
stub 'exit 0'
[ "$(PATH="$T/bin:$PATH" ab_nip98_project "$T/nope.toml" "$OUT" >/dev/null 2>&1; echo $?)" = 0 ] && [ ! -e "$OUT" ] && ok "missing manifest: no file, rc 0" || bad "missing manifest: no file, rc 0"
# 7. empty args never abort a set -u boot
( set -u; ab_nip98_project ) >/dev/null 2>&1 && ok "no-arg call is rc 0" || bad "no-arg call is rc 0"
printf '1..%d\n# nip98-config-projection: %d passed, %d failed\n' "$((PASS+FAIL))" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
