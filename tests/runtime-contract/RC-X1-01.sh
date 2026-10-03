#!/usr/bin/env bash
# RC-X1-01 — root boot never executes a binary from a devuser-writable directory
# (custody X-1 step 1, workstream W0, bypass 2).
#
# Before W0 the entrypoint put /home/devuser/workspace/.cargo/bin at the FRONT of
# root's PATH (Stage A for PID 1 and every supervised child, Stage B again for
# [program:bootstrap]). devuser owns that directory, so a binary planted there
# under the name of any tool the root boot calls ran as root.
#
# Asserts, against the real functions extracted from config/entrypoint-unified.sh:
#   1. the probe planted under the cargo bin dir WOULD run on the old PATH (control)
#   2. after _ab_root_path_sanitise it is never run, by name, for tools Stage B calls
#   3. only /nix/store/* and the fixed image system dirs survive sanitising
#   4. relative, dotted and empty entries are dropped; an empty result falls back
#   5. the sanitiser runs before the stage dispatch, so it covers Stage A and B
#   6. no root-side PATH assignment mentions the workspace any more
#   7. the shell profile snippet appends the cargo bin for devuser only, never root
#
# No container, no Docker, nothing executed as root. Exit 0 = all pass, 1 = any fail.
# shellcheck disable=SC2015,SC2016
# SC2015: _ok/_bad always return 0, so `cond && _ok || _bad` is a true if/else.
# SC2016: single-quoted $ is deliberate (regexes and code run in a child bash).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTRY="${HERE}/../../config/entrypoint-unified.sh"
PASS=0; FAIL=0
_ok()  { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$((PASS + FAIL))" "$1"; }
_bad() { FAIL=$((FAIL + 1)); printf 'not ok %d - %s\n' "$((PASS + FAIL))" "$1"; [ -n "${2:-}" ] && printf '#   %s\n' "$2"; }
_done() { printf '1..%d\n# RC-X1-01: %d passed, %d failed\n' "$((PASS + FAIL))" "$PASS" "$FAIL"; [ "$FAIL" -eq 0 ]; exit $?; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/rc-x1-01.XXXXXX")"; trap 'rm -rf "$TMP"' EXIT

_extract() { awk -v n="$1" '$0 ~ "^"n"\\(\\) \\{" {f=1} f {print} f && /^}$/ {exit}' "$ENTRY"; }
FN="$(_extract _ab_root_path_sanitise)"
if [ -z "$FN" ]; then _bad "_ab_root_path_sanitise() is defined in the entrypoint"; _done; fi
eval "$FN"
_ok "_ab_root_path_sanitise() is defined in the entrypoint"

# ── 1-2. probe planted under the workspace cargo bin dir ──────────────────────
CARGO_BIN="${TMP}/home/devuser/workspace/.cargo/bin"
mkdir -p "$CARGO_BIN"
HITS="${TMP}/probe.hits"
# Tools the root boot invokes by bare name (Stage A and Stage B both call these).
TOOLS="mkdir stat chown node jq sed awk"
for t in $TOOLS; do
  printf '#!/bin/sh\necho "%s" >>"%s"\nexit 0\n' "$t" "$HITS" >"${CARGO_BIN}/${t}"
  chmod 0755 "${CARGO_BIN}/${t}"
done
DIRTY="${CARGO_BIN}:/home/devuser/workspace/.cargo/bin:${PATH}"

( PATH="$DIRTY"; mkdir -p "${TMP}/control" ) 2>/dev/null
if [ -s "$HITS" ]; then _ok "control: on the pre-W0 PATH shape the planted probe runs"
else _bad "control: the probe must fire on the dirty PATH (else this test is vacuous)"; fi
rm -f "$HITS"

CLEAN="$(_ab_root_path_sanitise "$DIRTY")"
(
  PATH="$CLEAN"
  mkdir -p "${TMP}/clean"
  stat / >/dev/null 2>&1
  chown "$(id -u)" "${TMP}/clean" 2>/dev/null
  command -v node >/dev/null 2>&1 && node -e 0 >/dev/null 2>&1
  command -v jq   >/dev/null 2>&1 && jq -n 1 >/dev/null 2>&1
  echo x | sed 's/x/y/' >/dev/null 2>&1
  echo x | awk '{print}' >/dev/null 2>&1
) 2>/dev/null
if [ ! -e "$HITS" ]; then _ok "after sanitising, no planted probe runs for: ${TOOLS}"
else _bad "a planted probe ran as the boot user" "$(tr '\n' ' ' <"$HITS")"; fi

for t in $TOOLS; do
  r="$(PATH="$CLEAN" command -v "$t" 2>/dev/null || true)"
  case "$r" in "${TMP}"/*|/home/*) _bad "'$t' resolves into a devuser-writable dir: $r"; continue ;; esac
done
_ok "no tool resolves into the workspace after sanitising"

# ── 3. only store and fixed system dirs survive ──────────────────────────────
bad_entries=""
IFS=: read -r -a _parts <<<"$CLEAN"
for e in "${_parts[@]}"; do
  case "$e" in
    /nix/store/?*|/usr/local/bin|/usr/local/sbin|/bin|/sbin|/usr/bin|/usr/sbin) ;;
    *) bad_entries="${bad_entries} ${e}" ;;
  esac
done
[ -z "$bad_entries" ] && _ok "sanitised PATH holds only /nix/store/* and image system dirs" \
  || _bad "sanitised PATH holds untrusted entries" "$bad_entries"

# ── 4. hostile shapes ────────────────────────────────────────────────────────
got="$(_ab_root_path_sanitise ".:bin::/nix/store/../tmp:/nix/store/x/../../home/devuser:/usr/bin:/usr/bin:/home/devuser/.local/bin:/tmp:/run/agentbox:/var/run")"
[ "$got" = "/usr/bin" ] && _ok "relative, dotted, duplicate and devuser-owned entries are dropped" \
  || _bad "hostile entries must be dropped" "got: $got"
got="$(_ab_root_path_sanitise "/nix/store/*:/nix/store/abc-x/bin")"
[ "$got" = "/nix/store/abc-x/bin" ] && _ok "glob characters are neither expanded nor kept" \
  || _bad "glob entry must be dropped, not expanded" "got: $got"
got="$(_ab_root_path_sanitise "/home/devuser/workspace/.cargo/bin")"
[ "$got" = "/usr/local/bin:/bin:/usr/bin" ] && _ok "an all-untrusted PATH falls back to the image system dirs" \
  || _bad "empty result must fall back to /usr/local/bin:/bin:/usr/bin" "got: $got"

# ── 5. placement: before the stage dispatch ──────────────────────────────────
call_line="$(grep -nE '^(export )?PATH="\$\(_ab_root_path_sanitise "\$PATH"\)"' "$ENTRY" | head -1 | cut -d: -f1)"
dispatch_line="$(grep -n '^if \[ "${AGENTBOX_BOOTSTRAP_STAGE:-A}" = "B" \]; then' "$ENTRY" | head -1 | cut -d: -f1)"
if [ -n "$call_line" ] && [ -n "$dispatch_line" ] && [ "$call_line" -lt "$dispatch_line" ]; then
  _ok "PATH is sanitised at line ${call_line}, before the stage dispatch at ${dispatch_line} (covers Stage A and B)"
else
  _bad "PATH must be sanitised before the stage dispatch" "call=${call_line:-none} dispatch=${dispatch_line:-none}"
fi

# ── 6. no root-side workspace PATH assignment ────────────────────────────────
grep -q '^_ab_cargo_bin_on_path' "$ENTRY" && _bad "_ab_cargo_bin_on_path (root PATH prepend) must be gone" \
  || _ok "_ab_cargo_bin_on_path (root PATH prepend) is gone"
# Any live PATH= assignment naming the workspace must be heredoc text (escaped \$PATH).
live="$(grep -nE 'PATH="[^"]*/home/devuser|PATH="[^"]*\$\{?WORKSPACE' "$ENTRY" | grep -v '\\\$PATH' || true)"
[ -z "$live" ] && _ok "no root-executed PATH assignment names the workspace" \
  || _bad "root-executed PATH assignment names the workspace" "$live"

# ── 7. the profile snippet: devuser shells only, appended ────────────────────
SNIP="$(awk '/^# ADR-2029 D4: cargo-installed binaries/{f=1;next} f && /^fi$/{print; exit} f{print}' "$ENTRY" | sed 's/\\\$/$/g')"
if [ -z "$SNIP" ]; then
  _bad "runtime-env cargo-bin snippet found"
else
  FAKE_BIN="/home/devuser/workspace/.cargo/bin"
  out_root="$(bash -c 'id() { echo 0; }; PATH=/usr/bin; '"$SNIP"'; printf %s "$PATH"')"
  [ "$out_root" = "/usr/bin" ] && _ok "root shells sourcing runtime-env do not get the cargo bin" \
    || _bad "root shell PATH must be untouched" "got: $out_root"
  if [ -d "$FAKE_BIN" ]; then
    out_dev="$(bash -c 'id() { echo 1000; }; PATH=/usr/bin; '"$SNIP"'; printf %s "$PATH"')"
    [ "$out_dev" = "/usr/bin:${FAKE_BIN}" ] && _ok "devuser shells get the cargo bin APPENDED (image tools win)" \
      || _bad "devuser PATH must end with the cargo bin" "got: $out_dev"
  else
    echo "ok $((PASS + FAIL + 1)) # SKIP ${FAKE_BIN} absent on this host; devuser append path unprovable here"; PASS=$((PASS + 1))
  fi
fi
FISH="$(awk "/^cat > \"\\\$FISH_CONF_D\/agentbox-runtime.fish\" <<'FISHEOF'/{f=1;next} f && /^FISHEOF\$/{exit} f{print}" "$ENTRY")"
if printf '%s' "$FISH" | grep -q 'id -u' && printf '%s' "$FISH" | grep -q 'fish_add_path .*--append.*\.cargo/bin'; then
  _ok "fish conf.d appends the cargo bin for non-root shells only"
else
  _bad "fish conf.d must append the cargo bin behind an id -u guard"
fi

_done
