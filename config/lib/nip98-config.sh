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
  local manifest="${1:-}" out="${2:-}" rc=0 msg gid="" role=0 final stage_parent stage f
  local -a R=()
  [ -n "$manifest" ] && [ -n "$out" ] || return 0
  final="$out"
  if gid="$(ab_nip98_role_gid)"; then
    # Role isolation (ADR-2122): the proxy reads the role's own secrets dir.
    final="$(ab_nip98_role_dir_prepare "$gid")" || {
      echo "  [nip98-proxy] role isolation: ${AB_SECRETS_ROOT:-/run/secrets}/ab-ingress is not a root-controlled directory; NOT projecting, door stays closed" >&2
      return 0
    }
    role=1
    stage_parent="${AB_SECRETS_ROOT:-/run/secrets}"   # root-only, same filesystem as the role dir: atomic rename
  else
    gid=""
    # Flag off the destination is devuser's workspace and devuser can swap
    # anything in it, so ROOT must not touch it at all: the whole projection
    # runs as devuser (R) in a staging dir beside the final file. Whatever
    # devuser plants, only devuser's own rights are exercised.
    stage_parent="$(dirname "$final")"
    R=(ab_nip98_as_devuser)
    # An older install may have left the directory root-owned, which would make
    # devuser's mkdir/mktemp fail and keep the door closed. Hand it back (-h: a
    # symlinked directory is never touched, nor followed).
    if [ "$(id -u)" = 0 ] && [ -d "$stage_parent" ] && [ ! -L "$stage_parent" ] \
       && [ "$(ab_nip98_uid "$stage_parent")" != 1000 ]; then
      chown -h 1000:1000 "$stage_parent" 2>/dev/null || true
    fi
  fi
  if [ ! -f "$manifest" ] || ! command -v agentbox-manifest >/dev/null 2>&1; then
    echo "  [nip98-proxy] projection skipped (manifest or agentbox-manifest absent); door stays closed until a config file exists" >&2
    return 0
  fi
  [ "$role" = 1 ] || "${R[@]}" mkdir -p -- "$stage_parent" 2>/dev/null || true
  if [ "$role" = 1 ] && { [ -L "$stage_parent" ] || [ ! -d "$stage_parent" ] || [ "$(ab_nip98_uid "$stage_parent")" != 0 ]; }; then
    echo "  [nip98-proxy] staging root ${stage_parent} is not a root-owned directory; NOT projecting, door stays closed" >&2
    return 0
  fi
  if ! stage="$("${R[@]}" mktemp -d "${stage_parent}/.nip98-stage.XXXXXX" 2>/dev/null)" || [ -z "$stage" ]; then
    echo "  [nip98-proxy] cannot create a staging dir in ${stage_parent}; NOT projecting, door stays closed" >&2
    return 0
  fi
  f="$stage/nip98-proxy-config.json"
  # Roles of the staging dir: root-only (role) or devuser-only (flag off); the
  # projector's own write_atomic / remove-stale therefore act on the STAGED path.
  msg="$("${R[@]}" agentbox-manifest nip98-config --manifest "$manifest" --out "$f" 2>&1)" || rc=$?
  [ -z "$msg" ] || printf '%s\n' "$msg" | sed 's/^/  /'
  if [ "$rc" -ne 0 ]; then
    echo "  [nip98-proxy] projection FAILED (rc ${rc}); a last-good file keeps serving, otherwise the door stays closed" >&2
  else
    # Projector succeeded but staged nothing (section removed): ALWAYS replace
    # whatever is at the destination with the explicit empty config, so a stale
    # allowlist/route set cannot outlive the removal of its section.
    if ! "${R[@]}" test -e "$f"; then
      "${R[@]}" sh -c 'printf "%s" "$1" >"$2"' _ '{"routes":[],"allowedPubkeys":[]}' "$f" 2>/dev/null \
        && echo "  [nip98-proxy] no [interaction_plane.proxy] config: wrote explicit empty config (any valid signer)"
    fi
    if "${R[@]}" test -e "$f"; then
      if [ "$role" = 1 ]; then ab_nip98_own "$f" 1 "$gid"; else "${R[@]}" chmod 600 "$f" 2>/dev/null || true; fi
      # ONE rename into place. -T: a symlink to a directory at the destination is
      # replaced, not entered; a rename never follows a symlink.
      "${R[@]}" mv -fT -- "$f" "$final" 2>/dev/null \
        || echo "  [nip98-proxy] could not move the projected file into place; door stays closed unless a last-good file exists" >&2
    fi
  fi
  "${R[@]}" rm -rf -- "$stage" 2>/dev/null || true
  return 0
}

# ab_nip98_as_devuser <cmd...> — run a command as devuser (1000:1000) when root,
# directly otherwise. setpriv first (the Nix image's runuser aborts without PAM),
# then runuser; with neither, refuse rather than run as root in devuser's tree.
ab_nip98_as_devuser() {
  if [ "$(id -u)" != 0 ]; then "$@"; return; fi
  # Root-side hygiene before dropping privileges: nothing inherited from the
  # boot environment (tokens, PID-1 variables) and no inherited fds above 2
  # reach the devuser command. agentbox-manifest nip98-config reads only its
  # arguments, so PATH/HOME/LANG suffice. The fds are closed in a subshell.
  (
    for _fd in /proc/self/fd/*; do
      _n="${_fd##*/}"
      case "$_n" in ''|*[!0-9]*) continue ;; esac
      [ "$_n" -gt 2 ] && eval "exec ${_n}>&-" 2>/dev/null
    done
    if command -v setpriv >/dev/null 2>&1; then
      exec env -i PATH="$PATH" HOME=/home/devuser LANG=C.UTF-8 \
        setpriv --reuid=1000 --regid=1000 --init-groups -- "$@"
    elif command -v runuser >/dev/null 2>&1; then
      exec env -i PATH="$PATH" HOME=/home/devuser LANG=C.UTF-8 \
        runuser -u devuser -- "$@"
    else
      echo "  [nip98-proxy] no setpriv/runuser: refusing to touch the workspace as root" >&2
      exit 127
    fi
  )
}

# ab_nip98_role_gid — the ab-ingress role's gid when role isolation is on and the
# account resolves; non-zero otherwise (flag off, or no such account).
ab_nip98_role_gid() {
  local g
  [ "${AGENTBOX_ROLE_ISOLATION:-0}" = 1 ] || return 1
  id -u ab-ingress >/dev/null 2>&1 && g="$(id -g ab-ingress 2>/dev/null)" && [ -n "$g" ] || return 1
  printf '%s' "$g"
}

# ab_nip98_uid <path> — numeric owner of a path itself (symlinks not followed).
ab_nip98_uid() { stat -c %u "$1" 2>/dev/null; }

# ab_nip98_role_dir_prepare <gid> — print the file path inside the ab-ingress
# role's secrets directory (AB_SECRETS_ROOT, default /run/secrets, then
# /ab-ingress), or fail. Why this place (AB-36.1): it is where ADR-2122 puts the
# role's other secrets, under a root-owned traverse-only /run/secrets, so devuser
# can neither replace the file nor rename the directory. The proxy learns the
# path from AGENTBOX_SECRETS_DIR, which the role render sets (config-path.mjs).
# Refused: a symlinked or non-root-owned secrets root, a symlinked role directory,
# a role directory owned by anyone but root or the role (capture's 0500 layout).
# A missing directory is created with install -d (root:ab-ingress 0750).
ab_nip98_role_dir_prepare() {
  local gid="$1" root="${AB_SECRETS_ROOT:-/run/secrets}" dir role_uid o
  dir="${root}/ab-ingress"; role_uid="$(id -u ab-ingress 2>/dev/null)" || return 1
  [ ! -L "$root" ] && [ -d "$root" ] && [ "$(ab_nip98_uid "$root")" = 0 ] || return 1
  [ ! -L "$dir" ] || return 1
  if [ -e "$dir" ]; then
    [ -d "$dir" ] || return 1
    o="$(ab_nip98_uid "$dir")"
    [ "$o" = 0 ] || [ "$o" = "$role_uid" ] || return 1
  else
    install -d -o 0 -g "$gid" -m 0750 "$dir" 2>/dev/null || return 1
    [ ! -L "$dir" ] && [ "$(ab_nip98_uid "$dir")" = 0 ] || return 1
  fi
  printf '%s' "${dir}/nip98-proxy-config.json"
}

# ab_nip98_own <staged-file> [role 0|1] [gid] — owner and mode of the projected file,
# applied to the STAGED copy (never to the final path).
# chmod runs BEFORE chown (never the new owner with the old mode); chown -h.
#   flag off / no role account: 600, 1000:1000, exactly as before.
#   role isolation (role=1):    440, root:ab-ingress (the role reads via the group).
ab_nip98_own() {
  local file="${1:-}" role="${2:-0}" gid="${3:-}" mode=600 owner="1000:1000"
  [ -n "$file" ] || return 0
  if [ "$role" = 1 ] && [ -n "$gid" ]; then mode=440; owner="0:${gid}"; fi
  chmod "$mode" "$file" 2>/dev/null || true
  chown -h "$owner" "$file" 2>/dev/null || true
  return 0
}
