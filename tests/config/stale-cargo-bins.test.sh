#!/usr/bin/env bash
# The boot quarantine for workspace cargo binaries whose /nix/store loader a
# rebuild collected (config/entrypoint-unified.sh, ADR-2029 D4 follow-up).
# Fixtures are fake ELF headers: the function reads bytes and never executes.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTRY="${HERE}/../../config/entrypoint-unified.sh"
PASS=0; FAIL=0
_ok()  { PASS=$((PASS + 1)); printf 'PASS  %s\n' "$1"; }
_bad() { FAIL=$((FAIL + 1)); printf 'FAIL  %s\n' "$1"; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/stale-cargo.XXXXXX")"; trap 'rm -rf "$TMP"' EXIT
eval "$(sed -n '/^_ab_quarantine_stale_cargo_bins() {/,/^}/p' "$ENTRY")"
type _ab_quarantine_stale_cargo_bins >/dev/null 2>&1 || { echo "FAIL  function not found in entrypoint"; exit 1; }

BIN="${TMP}/bin"; mkdir -p "$BIN"
LIVE_LOADER="${TMP}/nix/store/aaaa-glibc-live/lib/ld-linux-x86-64.so.2"
mkdir -p "$(dirname "$LIVE_LOADER")"; : >"$LIVE_LOADER"
_elf() { # _elf <path> <interp>
  { printf '\177ELF\002\001\001'; head -c 57 /dev/zero; printf '%s\0' "$2"; head -c 200 /dev/zero; } >"$1"
  chmod 0755 "$1"
}
_elf "${BIN}/gone"   "/nix/store/zzzz-glibc-collected/lib/ld-linux-x86-64.so.2"
# A live loader outside /nix/store cannot be faked under the regex, so prove the
# keep path with a real one: whatever loader this host's bash uses.
REAL_LOADER="$(head -c 4096 "$(command -v bash)" | tr -c '[:print:]' '\n' | grep -m1 -E '^/nix/store/[^/]+/lib/ld-linux[^/]*\.so\.[0-9]+$' || true)"
[ -n "$REAL_LOADER" ] && _elf "${BIN}/alive" "$REAL_LOADER"
printf '#!/bin/sh\nexit 0\n' >"${BIN}/script"; chmod 0755 "${BIN}/script"
_elf "${BIN}/notexec" "/nix/store/zzzz-glibc-collected/lib/ld-linux-x86-64.so.2"; chmod 0644 "${BIN}/notexec"
ln -s gone "${BIN}/link"

OUT="$(_ab_quarantine_stale_cargo_bins "$BIN")"

[ ! -e "${BIN}/gone" ] && [ -x "${BIN}/.stale-loader/gone" ] \
  && _ok "binary with a collected loader → moved to .stale-loader, still executable-bit intact" \
  || _bad "binary with a collected loader must be quarantined"
if [ -n "$REAL_LOADER" ]; then
  [ -e "${BIN}/alive" ] && _ok "binary whose loader exists → left in place" || _bad "a live binary must stay"
else
  echo "SKIP  no /nix/store loader on this host to prove the keep path"
fi
[ -e "${BIN}/script" ] && _ok "scripts are never touched" || _bad "scripts must stay"
[ -e "${BIN}/notexec" ] && _ok "non-executable files are never touched" || _bad "non-executables must stay"
[ -L "${BIN}/link" ] && _ok "symlinks are never moved" || _bad "symlinks must stay"
printf '%s' "$OUT" | grep -q 'quarantined .* gone' && _ok "boot log names what it moved" || _bad "boot log must name moved binaries: $OUT"
OUT2="$(_ab_quarantine_stale_cargo_bins "$BIN")"
[ -z "$OUT2" ] && _ok "second run is a silent no-op" || _bad "rerun must be idempotent: $OUT2"
_elf "${BIN}/gone" "/nix/store/yyyy-glibc-collected/lib/ld-linux-x86-64.so.2"
_ab_quarantine_stale_cargo_bins "$BIN" >/dev/null
[ -f "${BIN}/.stale-loader/gone.~1~" ] && [ -f "${BIN}/.stale-loader/gone" ] \
  && _ok "repeated quarantine preserves both recovery copies" || _bad "repeated quarantine must not overwrite its recovery copy"
_ab_quarantine_stale_cargo_bins "${TMP}/absent" && _ok "missing directory → returns 0" || _bad "missing dir must not fail boot"

printf '\nstale-cargo-bins: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
