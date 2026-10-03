# shellcheck shell=bash
# config/lib/role-custody.sh — /run/secrets delivery for per-role service
# accounts (ADR-2122, custody X-1 step 1, W1). Sourced by
# config/entrypoint-unified.sh; definitions only, nothing runs on source.
#
# Every function here is reached only when [security].role_isolation = true,
# except the two pickers, which return today's values for any other input. So
# with the flag off the boot is what it was before this file existed.
#
# Contract (the entrypoint relies on all of it):
#   * fail-open: no function returns non-zero to a `set -e` caller for a
#     delivery problem; failures are counted in AB_RC_FAILURES and logged with a
#     grep-able [security] marker. A missing secret makes its role program fail
#     closed under supervisord, which is where it belongs, not the boot.
#   * no secret VALUE is ever printed, logged, or passed on argv. File sources go
#     through `cat <path>`; environment values through the `printf` builtin
#     inside a subshell, which forks but never execs, so no argv carries them.
#   * runs before supervisord, so no devuser process exists yet to race a
#     check-then-copy. Symlinked, non-regular or oversized sources are refused
#     anyway, because the workspace bind persists across boots.
#
# Test seams: AB_RC_CHOWN (default chown) is the only call that needs root;
# tests/config/role-secrets-delivery.test.sh stubs it with a ledger.

AB_RC_MAX_SECRET_BYTES=65536

# ab_root_state_dir_pick <role_isolation 0|1> [secrets-root=/run/secrets]
# Where W0's Stage-B one-shot guard lives. With the flag on AND /run/secrets a
# root-owned mount point, inside it (devuser cannot rename a mount point or
# enter a root 0711 dir's unlisted entries). Otherwise the sticky /tmp path W0
# chose, unchanged. Flag off always gives /tmp: the flag-off boot chowns
# /run/secrets to devuser, so a guard there would be devuser's to remove.
ab_root_state_dir_pick() {
  local root="${2:-/run/secrets}"
  if [ "${1:-0}" = 1 ] && ab_secrets_mount_ok "$root"; then
    printf '%s\n' "${root}/.root-guard"
  else
    printf '%s\n' /tmp/.agentbox-root
  fi
}

# ab_supervisord_conf_pick <role_isolation 0|1> [today] [isolated]
# The config `exec supervisord -c` gets. Only the exact value 1 with a readable
# isolated config selects it; anything else is today's config, byte for byte.
ab_supervisord_conf_pick() {
  local today="${2:-/etc/supervisord.conf}" isolated="${3:-/etc/supervisord.isolated.conf}"
  if [ "${1:-0}" = 1 ] && [ -r "$isolated" ] && [ ! -L "$isolated" ]; then
    printf '%s\n' "$isolated"
  else
    printf '%s\n' "$today"
  fi
}

# ab_role_isolation_ready [isolated-conf] [plan] → 0 when the image can honour
# the flag. An image that lacks either artefact boots exactly as today.
ab_role_isolation_ready() {
  local conf="${1:-/etc/supervisord.isolated.conf}" plan="${2:-/etc/agentbox/role-secrets.tsv}"
  [ -r "$conf" ] && [ -r "$plan" ] && grep -q '^role	' "$plan" 2>/dev/null
}

# _ab_rc_is_mountpoint <dir> → 0 when <dir> sits on a different device from its
# parent. Plain coreutils (no util-linux `mountpoint` needed on root's PATH).
_ab_rc_is_mountpoint() {
  local d p
  d="$(stat -c %d -- "$1" 2>/dev/null)" || return 1
  p="$(stat -c %d -- "$1/.." 2>/dev/null)" || return 1
  [ "$d" != "$p" ]
}

# ab_secrets_mount_ok <dir> [owner-uid=0] → 0 when <dir> is a real directory (not
# a symlink), a mount point, owned by <owner-uid>, and not group/other-writable.
ab_secrets_mount_ok() {
  local dir="$1" uid="${2:-0}" st mode
  [ -d "$dir" ] && [ ! -L "$dir" ] || return 1
  _ab_rc_is_mountpoint "$dir" || return 1
  st="$(stat -c '%u %a' -- "$dir" 2>/dev/null)" || return 1
  [ "${st%% *}" = "$uid" ] || return 1
  mode="${st##* }"
  case "${mode: -2}" in *[2367]*) return 1 ;; esac
  return 0
}

# ab_secrets_root_prepare <root> → make <root> root:root 0711 (traverse-only for
# everyone else). Prints a ROLE-ISOLATION-DEGRADED marker and returns 1 when it
# is not a mount point: then devuser, owner of /run, could rename it after boot.
ab_secrets_root_prepare() {
  local root="$1" chown_cmd="${AB_RC_CHOWN:-chown}"
  if [ -L "$root" ]; then
    echo "[security] ROLE-ISOLATION-DEGRADED secrets-mount: ${root} is a symlink; refusing to use it" >&2
    return 1
  fi
  mkdir -p -- "$root" 2>/dev/null || true
  "$chown_cmd" 0:0 "$root" 2>/dev/null || true
  chmod 0711 "$root" 2>/dev/null || true
  if ! _ab_rc_is_mountpoint "$root"; then
    echo "[security] ROLE-ISOLATION-DEGRADED secrets-mount: ${root} is not its own mount (compose tmpfs missing; regenerate docker-compose.yml). devuser owns /run and can rename it." >&2
    return 1
  fi
  return 0
}

# _ab_rc_place <tmp> <dest> <uid> <gid> — finish one secret file: 0400, owned by
# the role, renamed over <dest>. Returns non-zero on any failure (tmp removed).
_ab_rc_place() {
  local tmp="$1" dest="$2" uid="$3" gid="$4" chown_cmd="${AB_RC_CHOWN:-chown}"
  if chmod 0400 "$tmp" && "$chown_cmd" "${uid}:${gid}" "$tmp" && mv -f -- "$tmp" "$dest"; then
    return 0
  fi
  rm -f -- "$tmp" 2>/dev/null || true
  return 1
}

# ab_role_secrets_deliver <plan> [secrets-root-override]
# Execute the plan written by `agentbox-manifest role-accounts isolate`:
#   root <path>                     the secrets root (the override, if given, wins)
#   role <name> <uid> <gid>         <root>/<name> 0500 and <root>/<name>/home 0700
#   file <name> <file> <source>     copy <source> to <root>/<name>/<file>, 0400
#   env  <name> <file> <VAR>        write $VAR to <root>/<name>/<file>, 0400; unset VAR
# Every `env` variable is unset whether or not it had a value, so none of them
# reaches supervisord (PID 1) or any child. Sets AB_RC_DELIVERED, AB_RC_FAILURES.
ab_role_secrets_deliver() {
  local plan="$1" override="${2:-}" root="" kind name a b uid gid dir dest tmp size
  local chown_cmd="${AB_RC_CHOWN:-chown}"
  local -A role_uid=() role_gid=()
  AB_RC_DELIVERED=0
  AB_RC_FAILURES=0
  if [ ! -r "$plan" ]; then
    echo "[security] ROLE-ISOLATION-ERROR: delivery plan ${plan} is missing; no role secret delivered" >&2
    AB_RC_FAILURES=1
    return 0
  fi
  while IFS=$'\t' read -r kind name a b || [ -n "$kind" ]; do
    case "$kind" in
      ''|'#'*) continue ;;
      root)
        root="${override:-$name}"
        continue ;;
    esac
    if [ -z "$root" ]; then
      echo "[security] ROLE-ISOLATION-ERROR: plan ${plan} has no root row before its first ${kind} row" >&2
      AB_RC_FAILURES=$((AB_RC_FAILURES + 1)); return 0
    fi
    case "$name" in
      ab-*) ;;
      *) echo "[security] ROLE-ISOLATION-ERROR: plan row names ${name:-nothing}, not a role; skipped" >&2
         AB_RC_FAILURES=$((AB_RC_FAILURES + 1)); continue ;;
    esac
    case "$name$a" in */*|*..*)
      echo "[security] ROLE-ISOLATION-ERROR: plan row for ${name} has a path separator; skipped" >&2
      AB_RC_FAILURES=$((AB_RC_FAILURES + 1)); continue ;;
    esac
    dir="${root}/${name}"
    case "$kind" in
      role)
        uid="$a"; gid="$b"
        case "$uid$gid" in ''|*[!0-9]*)
          echo "[security] ROLE-ISOLATION-ERROR: role ${name} has a non-numeric uid/gid; skipped" >&2
          AB_RC_FAILURES=$((AB_RC_FAILURES + 1)); continue ;;
        esac
        if [ -L "$dir" ] || { [ -e "$dir" ] && [ ! -d "$dir" ]; }; then
          mv -T -- "$dir" "${dir}.squatted.$$" 2>/dev/null || rm -f -- "$dir" 2>/dev/null || true
        fi
        # 0700 while filling (a non-root test runner needs write; root ignores it).
        if ! mkdir -p -- "$dir/home" || ! chmod 0700 "$dir"; then
          echo "[security] ROLE-ISOLATION-ERROR: cannot create ${dir}" >&2
          AB_RC_FAILURES=$((AB_RC_FAILURES + 1)); continue
        fi
        chmod 0700 "$dir/home" 2>/dev/null || true
        "$chown_cmd" "${uid}:${gid}" "$dir/home" 2>/dev/null \
          || { echo "[security] ROLE-ISOLATION-ERROR: cannot chown ${dir}/home to ${uid}" >&2; AB_RC_FAILURES=$((AB_RC_FAILURES + 1)); }
        role_uid[$name]="$uid"; role_gid[$name]="$gid"
        ;;
      file|env)
        if [ -z "${role_uid[$name]:-}" ]; then
          echo "[security] ROLE-ISOLATION-ERROR: ${kind} row for ${name} precedes its role row; skipped" >&2
          AB_RC_FAILURES=$((AB_RC_FAILURES + 1)); continue
        fi
        dest="${dir}/${a}"
        tmp="${dir}/.${a}.tmp.$$"
        rm -f -- "$tmp" 2>/dev/null || true
        if [ "$kind" = file ]; then
          if [ -L "$b" ] || [ ! -f "$b" ]; then
            if [ -e "$b" ] || [ -L "$b" ]; then
              echo "[security] ROLE-ISOLATION-ERROR: ${name}/${a}: source ${b} is a symlink or not a regular file; refused" >&2
            else
              echo "[security] role-isolation: ${name}/${a}: source ${b} is absent; the role program will fail closed" >&2
            fi
            AB_RC_FAILURES=$((AB_RC_FAILURES + 1)); continue
          fi
          size="$(stat -c %s -- "$b" 2>/dev/null || echo 0)"
          if [ "$size" -gt "$AB_RC_MAX_SECRET_BYTES" ]; then
            echo "[security] ROLE-ISOLATION-ERROR: ${name}/${a}: source ${b} is ${size} bytes (> ${AB_RC_MAX_SECRET_BYTES}); refused" >&2
            AB_RC_FAILURES=$((AB_RC_FAILURES + 1)); continue
          fi
          if ! ( umask 077; cat -- "$b" >"$tmp" ) 2>/dev/null || ! _ab_rc_place "$tmp" "$dest" "${role_uid[$name]}" "${role_gid[$name]}"; then
            rm -f -- "$tmp" 2>/dev/null || true
            echo "[security] ROLE-ISOLATION-ERROR: ${name}/${a}: copy from ${b} failed" >&2
            AB_RC_FAILURES=$((AB_RC_FAILURES + 1)); continue
          fi
        else
          case "$b" in ''|[!A-Z_]*|*[!A-Z0-9_]*)
            echo "[security] ROLE-ISOLATION-ERROR: ${name}/${a}: ${b:-nothing} is not an environment name; skipped" >&2
            AB_RC_FAILURES=$((AB_RC_FAILURES + 1)); continue ;;
          esac
          if [ -z "${!b:-}" ]; then
            unset "$b"
            continue
          fi
          if ! ( umask 077; printf '%s' "${!b}" >"$tmp" ) 2>/dev/null || ! _ab_rc_place "$tmp" "$dest" "${role_uid[$name]}" "${role_gid[$name]}"; then
            rm -f -- "$tmp" 2>/dev/null || true
            echo "[security] ROLE-ISOLATION-ERROR: ${name}/${a}: could not write \$${b}; unset anyway" >&2
            AB_RC_FAILURES=$((AB_RC_FAILURES + 1))
            unset "$b"
            continue
          fi
          unset "$b"
        fi
        AB_RC_DELIVERED=$((AB_RC_DELIVERED + 1))
        ;;
      *)
        echo "[security] ROLE-ISOLATION-ERROR: unknown plan row kind ${kind}; skipped" >&2
        AB_RC_FAILURES=$((AB_RC_FAILURES + 1)) ;;
    esac
  done <"$plan"
  # Seal each role dir last: 0500 owned by the role (read and traverse only).
  for name in "${!role_uid[@]}"; do
    chmod 0500 "${root}/${name}" 2>/dev/null || true
    "$chown_cmd" "${role_uid[$name]}:${role_gid[$name]}" "${root}/${name}" 2>/dev/null \
      || { echo "[security] ROLE-ISOLATION-ERROR: cannot chown ${root}/${name}" >&2; AB_RC_FAILURES=$((AB_RC_FAILURES + 1)); }
  done
  echo "[security] role-isolation: delivered ${AB_RC_DELIVERED} secret(s) into ${#role_uid[@]} role dir(s) under ${root:-?}; ${AB_RC_FAILURES} problem(s)"
  return 0
}
