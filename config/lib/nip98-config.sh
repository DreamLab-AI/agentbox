#!/usr/bin/env bash
# nip98-config — boot projection of [interaction_plane.proxy] for the NIP-98
# door (W3-05, ADR-2210). Definitions only; sourced by entrypoint-unified.sh.
#
# The proxy runs with NIP98_PROXY_REQUIRE_CONFIG=1 (flake.nix), so an ABSENT
# file means "projection has not happened (or failed)" and it refuses every
# identity. This function therefore has to make "projected, nothing to restrict"
# a FILE, not an absence:
#   projector rc 0, file written     -> as projected
#   projector rc 0, section absent   -> explicit empty config (any valid signer,
#                                       the operator's deliberate ADR-069 mode)
#   projector missing / rc != 0      -> state untouched: a last-good file keeps
#                                       serving, no file keeps the door closed
# Always returns 0 (boot is fail-open; the DOOR is what fails closed).
#
#   ab_nip98_project <manifest> <out-file>
ab_nip98_project() {
  local manifest="${1:-}" out="${2:-}" rc=0 msg
  [ -n "$manifest" ] && [ -n "$out" ] || return 0
  if [ ! -f "$manifest" ] || ! command -v agentbox-manifest >/dev/null 2>&1; then
    echo "  [nip98-proxy] projection skipped (manifest or agentbox-manifest absent); door stays closed until a config file exists" >&2
    return 0
  fi
  msg="$(agentbox-manifest nip98-config --manifest "$manifest" --out "$out" 2>&1)" || rc=$?
  [ -z "$msg" ] || printf '%s\n' "$msg" | sed 's/^/  /'
  if [ "$rc" -ne 0 ]; then
    echo "  [nip98-proxy] projection FAILED (rc ${rc}); a last-good file keeps serving, otherwise the door stays closed" >&2
  elif [ ! -e "$out" ]; then
    mkdir -p "$(dirname "$out")" 2>/dev/null || true
    printf '%s' '{"routes":[],"allowedPubkeys":[]}' >"$out" 2>/dev/null \
      && echo "  [nip98-proxy] no [interaction_plane.proxy] config: wrote explicit empty config (any valid signer)"
  fi
  [ -e "$out" ] && { chown 1000:1000 "$out" 2>/dev/null || true; chmod 600 "$out" 2>/dev/null || true; }
  return 0
}
