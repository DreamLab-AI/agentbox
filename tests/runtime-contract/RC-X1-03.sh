#!/usr/bin/env bash
# RC-X1-03 — devuser is not in group root (custody X-1 step 1, W0).
#
# flake.nix seeded /etc/group with `root:x:0:devuser`, so every devuser process
# carried gid 0 and could read or write anything root left group-accessible.
# This is the one W0 change that needs an image rebuild to apply AND to undo.
#
#   1. static: the baked /etc/group heredoc in flake.nix lists no members for root
#   2. live (AGENTBOX_RC_LIVE=1, in a rebuilt image): `id -G devuser` lacks 0
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLAKE="${HERE}/../../flake.nix"
PASS=0; FAIL=0
_ok()  { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$((PASS + FAIL))" "$1"; }
_bad() { FAIL=$((FAIL + 1)); printf 'not ok %d - %s\n' "$((PASS + FAIL))" "$1"; [ -n "${2:-}" ] && printf '#   %s\n' "$2"; }
_skip() { PASS=$((PASS + 1)); printf 'ok %d # SKIP %s\n' "$((PASS + FAIL))" "$1"; }

GROUP="$(awk "/cat > \\\$out\/etc\/group <<'GROUP'/{f=1;next} f && /^[[:space:]]*GROUP\$/{exit} f{gsub(/^[[:space:]]+/,\"\"); print}" "$FLAKE")"
if [ -z "$GROUP" ]; then
  _bad "baked /etc/group heredoc found in flake.nix"
else
  root_line="$(printf '%s\n' "$GROUP" | grep '^root:' || true)"
  members="${root_line##*:}"
  [ "$root_line" = "root:x:0:" ] && _ok "baked group root has no supplementary members (${root_line})" \
    || _bad "baked group root must have no members" "${root_line:-missing} (members: ${members})"
  printf '%s\n' "$GROUP" | grep -qE '^devuser:x:1000:' && _ok "devuser's primary group is still 1000" \
    || _bad "devuser:x:1000 must stay"
fi

if [ "${AGENTBOX_RC_LIVE:-0}" = 1 ]; then
  g="$(id -G devuser 2>/dev/null || echo error)"
  case " $g " in
    *" 0 "*) _bad "live: id -G devuser lacks 0" "got: $g" ;;
    " error ") _bad "live: id -G devuser" "no devuser account here" ;;
    *) _ok "live: id -G devuser = ${g} (no 0)" ;;
  esac
else
  _skip "live check needs the rebuilt image (AGENTBOX_RC_LIVE=1); running image: id -G devuser = $(id -G devuser 2>/dev/null || echo n/a)"
fi

printf '1..%d\n# RC-X1-03: %d passed, %d failed\n' "$((PASS + FAIL))" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
