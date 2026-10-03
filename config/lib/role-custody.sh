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
# tests/config/role-secrets-delivery.test.sh stubs it with a ledger. The at-rest
# migrate/revert (W2b, below) adds AB_RC_STAT (default stat; the stub reports
# the ledger's owner) and AB_RC_ROOT (a prefix on every registry path, so the
# real plan runs against a scratch tree); tests/config/role-custody-migrate.test.sh.

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
  local today="${2:-/etc/supervisord.conf}" isolated="${3:-/etc/supervisord.roles.conf}"
  if [ "${1:-0}" = 1 ] && [ -r "$isolated" ] && [ ! -L "$isolated" ]; then
    printf '%s\n' "$isolated"
  else
    printf '%s\n' "$today"
  fi
}

# ab_role_isolation_ready [isolated-conf] [plan] → 0 when the image can honour
# the flag. An image that lacks either artefact boots exactly as today.
ab_role_isolation_ready() {
  local conf="${1:-/etc/supervisord.roles.conf}" plan="${2:-/etc/agentbox/role-secrets.tsv}"
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

# _ab_rc_dir <path> <uid>:<gid> <mode> — a `dir` plan row. Refuses a symlink at
# <path> (moved aside) and any path inside the secrets root; the parent must exist.
_ab_rc_dir() {
  local path="$1" ids="$2" mode="$3" chown_cmd="${AB_RC_CHOWN:-chown}"
  case "$path" in
    /*/*) ;;
    *) echo "[security] ROLE-ISOLATION-ERROR: dir row ${path:-?} is not below a top-level directory; skipped" >&2; return 1 ;;
  esac
  case "$path" in *..*|*//*|*/)
    echo "[security] ROLE-ISOLATION-ERROR: dir row ${path} is not a plain path; skipped" >&2; return 1 ;;
  esac
  case "$ids" in [0-9]*:[0-9]*) ;; *)
    echo "[security] ROLE-ISOLATION-ERROR: dir row ${path} has owner ${ids:-?}, not uid:gid; skipped" >&2; return 1 ;;
  esac
  case "${ids%%:*}${ids#*:}" in *[!0-9]*)
    echo "[security] ROLE-ISOLATION-ERROR: dir row ${path} has owner ${ids}, not uid:gid; skipped" >&2; return 1 ;;
  esac
  case "$mode" in *[2367]|*[!0-7]*) mode=bad ;; esac
  case "$mode" in [0-7][0-7][0-7]|[0-7][0-7][0-7][0-7]) ;; *)
    echo "[security] ROLE-ISOLATION-ERROR: dir row ${path} has mode ${3:-?} (3-4 octal digits, not world-writable); skipped" >&2; return 1 ;;
  esac
  if [ -L "$path" ] || { [ -e "$path" ] && [ ! -d "$path" ]; }; then
    mv -T -- "$path" "${path}.squatted.$$" 2>/dev/null || rm -f -- "$path" 2>/dev/null || true
  fi
  if [ ! -d "${path%/*}" ]; then
    echo "[security] ROLE-ISOLATION-ERROR: dir row ${path}: parent ${path%/*} is absent; not created" >&2
    return 1
  fi
  if { [ -d "$path" ] || mkdir -- "$path"; } && "$chown_cmd" "$ids" "$path" && chmod "$mode" "$path"; then
    return 0
  fi
  echo "[security] ROLE-ISOLATION-ERROR: cannot prepare ${path} (${ids} ${mode})" >&2
  return 1
}

# AB_RC_MAX_SEED_BYTES caps one seeded state file (a chain's blocks.dat grows).
AB_RC_MAX_SEED_BYTES=268435456

# _ab_rc_seed <dir> <from> <to|-> <uid:gid> <dir-mode> — custody W4: a role
# program's state leaves the workspace bind for a volume dir it owns. Runs only
# while <dir> holds no regular file, so it copies once and never overwrites what
# the role has written since. <from> a directory: its top-level regular files;
# <from> a file: that file, named <to>. Symlinks and non-regular entries are
# skipped, never followed. Each copy is verified (size and sha256 of both
# sides; state, not secrets, so the hash is not a disclosure), then owned by
# <uid:gid>, 0640 when the dir's group may read (the mirror) else 0600. The
# source is never touched. Names only in the log.
_ab_rc_seed() {
  local dir="$1" from="$2" to="$3" ids="$4" dmode="$5" f n=0 dest tmp size fmode=0600 chown_cmd="${AB_RC_CHOWN:-chown}"
  local -a srcs=()
  [ -d "$dir" ] && [ ! -L "$dir" ] || { echo "[security] ROLE-ISOLATION-ERROR: seed: ${dir} is not a directory" >&2; return 1; }
  for f in "$dir"/* "$dir"/.[!.]*; do
    if [ -f "$f" ] && [ ! -L "$f" ]; then return 0; fi   # already holds state: never re-seed
  done
  if [ -L "$from" ]; then
    echo "[security] ROLE-ISOLATION-ERROR: seed: ${from} is a symlink; not followed" >&2; return 1
  elif [ -d "$from" ]; then
    for f in "$from"/* "$from"/.[!.]*; do [ -f "$f" ] && [ ! -L "$f" ] && srcs+=("$f"); done
    to=-
  elif [ -f "$from" ]; then
    srcs=("$from")
  else
    return 0   # nothing to seed (a chain that never ran): the role starts fresh
  fi
  case "${dmode: -2:1}" in [4-7]) fmode=0640 ;; *) fmode=0600 ;; esac
  for f in "${srcs[@]}"; do
    if [ "$to" != - ]; then dest="${dir}/${to}"; else dest="${dir}/${f##*/}"; fi
    size="$(stat -c %s -- "$f" 2>/dev/null || echo -1)"
    if [ "$size" -lt 0 ] || [ "$size" -gt "$AB_RC_MAX_SEED_BYTES" ]; then
      echo "[security] ROLE-ISOLATION-ERROR: seed: ${f} is ${size} bytes; skipped" >&2; return 1
    fi
    tmp="${dir}/.${dest##*/}.seed.$$"
    if ( umask 077; cat -- "$f" >"$tmp" ) 2>/dev/null && sync -- "$tmp" 2>/dev/null \
       && [ "$(stat -c %s -- "$tmp" 2>/dev/null)" = "$size" ] \
       && [ "$(sha256sum <"$f")" = "$(sha256sum <"$tmp")" ] \
       && chmod "$fmode" "$tmp" && "$chown_cmd" "$ids" "$tmp" && mv -T -- "$tmp" "$dest"; then
      n=$((n + 1))
    else
      rm -f -- "$tmp" 2>/dev/null || true
      echo "[security] ROLE-ISOLATION-ERROR: seed: copying ${f} into ${dir} failed verification" >&2; return 1
    fi
  done
  sync -- "$dir" 2>/dev/null || true
  [ "$n" -gt 0 ] && echo "[security] role-isolation: seeded ${dir} with ${n} file(s) from ${from} (source left in place)"
  return 0
}

# ab_role_secrets_deliver <plan> [secrets-root-override]
# Execute the plan written by `agentbox-manifest role-accounts isolate`:
#   root <path>                     the secrets root (the override, if given, wins)
#   role <name> <uid> <gid>         <root>/<name> 0500 and <root>/<name>/home 0700
#   file <name> <file> <source>     copy <source> to <root>/<name>/<file>, 0400
#   env  <name> <file> <VAR>        write $VAR to <root>/<name>/<file>, 0400; unset VAR
#   sockdir <group> <uid> <gid>     <root>/<group> 0750 owned uid:gid (the identity
#                                   port's socket dir: inside the root mount, so
#                                   devuser, owner of /run, cannot rename it)
#   dir  <path> <uid>:<gid> <mode>  create or re-own <path> outside <root>
#   seed <dir> <from> <to|->        copy state into that dir once, while it holds no
#                                   regular file (_ab_rc_seed; custody W4)
#   atrest / atrestdir              the at-rest registry; skipped here (ab_custody_migrate)
# Every `env` variable is unset whether or not it had a value, so none of them
# reaches supervisord (PID 1) or any child. Sets AB_RC_DELIVERED, AB_RC_FAILURES.
ab_role_secrets_deliver() {
  local plan="$1" override="${2:-}" root="" kind name a b uid gid dir dest tmp size
  local chown_cmd="${AB_RC_CHOWN:-chown}"
  local -A role_uid=() role_gid=() dir_ids=() dir_mode=()
  AB_RC_DELIVERED=0
  AB_RC_FAILURES=0
  if [ ! -r "$plan" ]; then
    echo "[security] ROLE-ISOLATION-ERROR: delivery plan ${plan} is missing; no role secret delivered" >&2
    AB_RC_FAILURES=1
    return 0
  fi
  while IFS=$'\t' read -r kind name a b || [ -n "$kind" ]; do
    case "$kind" in
      ''|'#'*|atrest|atrestdir) continue ;;  # the at-rest registry: ab_custody_migrate/revert
      root)
        root="${override:-$name}"
        continue ;;
      dir)
        if _ab_rc_dir "$name" "$a" "$b"; then dir_ids[$name]="$a"; dir_mode[$name]="$b"
        else AB_RC_FAILURES=$((AB_RC_FAILURES + 1)); fi
        continue ;;
      seed)
        if [ -z "${dir_ids[$name]:-}" ]; then
          echo "[security] ROLE-ISOLATION-ERROR: seed row for ${name} has no prepared dir row before it; skipped" >&2
          AB_RC_FAILURES=$((AB_RC_FAILURES + 1)); continue
        fi
        _ab_rc_seed "$name" "$a" "$b" "${dir_ids[$name]}" "${dir_mode[$name]}" || AB_RC_FAILURES=$((AB_RC_FAILURES + 1))
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
      sockdir)
        case "$a$b" in ''|*[!0-9]*)
          echo "[security] ROLE-ISOLATION-ERROR: sockdir ${name} has a non-numeric uid/gid; skipped" >&2
          AB_RC_FAILURES=$((AB_RC_FAILURES + 1)); continue ;;
        esac
        if [ -L "$dir" ] || { [ -e "$dir" ] && [ ! -d "$dir" ]; }; then
          mv -T -- "$dir" "${dir}.squatted.$$" 2>/dev/null || rm -f -- "$dir" 2>/dev/null || true
        fi
        if mkdir -p -- "$dir" && chmod 0750 "$dir" && "$chown_cmd" "${a}:${b}" "$dir"; then :
        else
          echo "[security] ROLE-ISOLATION-ERROR: cannot prepare socket dir ${dir} (${a}:${b} 0750)" >&2
          AB_RC_FAILURES=$((AB_RC_FAILURES + 1))
        fi
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
          if [ -n "${AB_RC_REFUSED[$b]:-}" ]; then
            echo "[security] ROLE-ISOLATION-ERROR: ${name}/${a}: source ${b} was refused by the custody migrate step (${AB_RC_REFUSED[$b]}); not delivered" >&2
            AB_RC_FAILURES=$((AB_RC_FAILURES + 1)); continue
          fi
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

# ── At-rest custody: migrate (flag on) and revert (flag off) ──────────────────
# Custody design 3.2-3.4 (W2b). The registry is the `atrest` and `atrestdir`
# rows of the delivery plan, derived by `agentbox-manifest role-accounts
# isolate` from config/role-accounts.json (each file secret's resolved source,
# each role's `at_rest`, and `at_rest_dirs`); nothing here lists a secret.
#
#   atrestdir <path> <mode>          root:root <mode> under the flag
#   atrest <role> <path> <legacy|->  <role>:<role> 0400 under the flag
#
# migrate, per atrest row: when <path> is absent and <legacy> is a regular file,
# copy it (umask 077, temp file in the same dir, fsync, size and byte compare,
# rename, fsync the dir). The legacy copy is never touched or deleted (Q5). A
# <path> that is a symlink, not a regular file, hard-linked, empty or oversized
# is REFUSED: not re-owned, not delivered, counted. So is a <path> that already
# existed on the first migration and differs from its legacy copy (something
# other than this step put it there). Then the copy goes to its role, 0400, and
# each atrestdir to root:root.
#
# Pre-flag owner and mode go to a modes record (<first atrestdir>/
# .role-custody.modes, root 0600) the first time a path is seen, and only then;
# revert hands each registry path back to devuser (or to root, when root owned
# it before) with that mode. The record is
# trusted only when root owns it and it is a single-link regular file: devuser
# owns the volumes with the flag off and could otherwise forge it. No record
# means nothing was ever migrated, and revert changes nothing.
#
# Every path, legacy copy and refusal is written, by NAME only, to the migrated
# record (default /run/secrets/role-isolation.migrated, 0644: it holds no value
# and the rehearsal receipt lists it). Nothing here opens a secret except cat
# into the temp copy and the od compare, neither of which prints content.
#
# Both functions are fail-open (rc 0) and idempotent: an owner or mode already
# right is not set again, so a second run leaves every inode's ctime alone and
# a stat of the registry hashes the same before and after.

AB_RC_DEVUSER_IDS=1000:1000
declare -gA AB_RC_REFUSED=()

# _ab_rc_stat <path> -> "uid gid mode nlink size type" (empty when absent).
# Never follows a symlink (stat without -L).
_ab_rc_stat() { "${AB_RC_STAT:-stat}" -c '%u %g %a %h %s %F' -- "$1" 2>/dev/null; }

# _ab_rc_same <a> <b> -> 0 when the two files are byte-identical. Compared in
# memory as od hex (coreutils only: the root boot PATH is store-only and need not
# carry diffutils' cmp); nothing is printed. Callers cap sizes at
# AB_RC_MAX_SECRET_BYTES, so each string is at most ~200 KiB.
_ab_rc_same() {
  local x y
  x="$(od -An -v -tx1 -- "$1" 2>/dev/null)" || return 1
  y="$(od -An -v -tx1 -- "$2" 2>/dev/null)" || return 1
  [ "$x" = "$y" ]
}

# _ab_rc_set <path> <uid:gid> <mode>: chown/chmod only what differs. A symlink is
# never passed to chown (it would follow it).
_ab_rc_set() {
  local p="$1" ids="$2" mode="$3" st uid gid cur chown_cmd="${AB_RC_CHOWN:-chown}"
  [ -L "$p" ] && return 1
  st="$(_ab_rc_stat "$p")" || return 1
  [ -n "$st" ] || return 1
  read -r uid gid cur _ <<<"$st"
  if [ "${uid}:${gid}" != "$ids" ]; then "$chown_cmd" "$ids" "$p" || return 1; fi
  if [ "$((8#$cur))" != "$((8#$mode))" ]; then chmod "$mode" "$p" || return 1; fi
  return 0
}

# _ab_rc_modes_trusted <file> -> 0 when root owns it, it is a regular file with
# one link and nobody else can write it.
_ab_rc_modes_trusted() {
  local st uid mode links
  [ -f "$1" ] && [ ! -L "$1" ] || return 1
  st="$(_ab_rc_stat "$1")" || return 1
  read -r uid _ mode links _ <<<"$st"
  [ "$uid" = 0 ] && [ "$links" = 1 ] || return 1
  case "${mode: -2}" in 00) return 0 ;; esac
  return 1
}

# _ab_rc_plan_rows <plan>: print "kind<TAB>a<TAB>b<TAB>c" for role, atrest and
# atrestdir rows; the parsers below share it.
_ab_rc_plan_rows() {
  awk -F'\t' '$1=="role"||$1=="atrest"||$1=="atrestdir" {print}' "$1" 2>/dev/null
}

# ab_custody_migrate <plan> [migrated-record=/run/secrets/role-isolation.migrated]
# Sets AB_RC_MIGRATED (copies made this run), AB_RC_MIG_FAILURES, AB_RC_REFUSED.
ab_custody_migrate() {
  local plan="$1" record="${2:-/run/secrets/role-isolation.migrated}"
  local R="${AB_RC_ROOT:-}" kind a b c p l st uid gid mode links size dir modes="" tmp rec seen
  local -A role_uid=() is_dir=() recorded=()
  AB_RC_MIGRATED=0; AB_RC_MIG_FAILURES=0; AB_RC_REFUSED=()
  if [ ! -r "$plan" ]; then
    echo "[security] ROLE-ISOLATION-ERROR: custody migrate: plan ${plan} is missing; nothing migrated" >&2
    AB_RC_MIG_FAILURES=1; return 0
  fi
  rec="$(mktemp "$R${record%/*}/.role-isolation.migrated.XXXXXX" 2>/dev/null)" || rec=/dev/null
  printf '# role-isolation custody migrate (design 3.2). Paths only; no value, no hash.\n# status\tpath\tlegacy-or-reason\n' >"$rec"
  while IFS=$'\t' read -r kind a b c; do
    case "$kind" in
      role) role_uid[$a]="$b" ;;
      atrestdir) is_dir[$a]="$b"; [ -n "$modes" ] || modes="${a}/.role-custody.modes" ;;
    esac
  done < <(_ab_rc_plan_rows "$plan")
  if [ -z "$modes" ]; then
    echo "[security] role-isolation: custody migrate: the plan has no at-rest registry; nothing to migrate"
    rm -f -- "$rec" 2>/dev/null; return 0
  fi
  # Earlier records win: only a path never seen before gets its state recorded.
  if _ab_rc_modes_trusted "$R$modes"; then
    while IFS=$'\t' read -r _ p _; do [ -n "$p" ] && recorded[$p]=1; done <"$R$modes"
  elif [ -e "$R$modes" ] || [ -L "$R$modes" ]; then
    echo "[security] ROLE-ISOLATION-ERROR: custody migrate: ${modes} is not a root-owned 0600 single-link file; moved aside, recording afresh" >&2
    mv -T -- "$R$modes" "$R$modes.untrusted.$$" 2>/dev/null || true
    AB_RC_MIG_FAILURES=$((AB_RC_MIG_FAILURES + 1))
  fi
  _ab_rc_note() { # <path> <d|f> <uid> <gid> <mode>: first sighting only
    [ -n "${recorded[$1]:-}" ] && return 0
    ( umask 077; printf '%s\t%s\t%s:%s\t%s\n' "${2}" "$1" "$3" "$4" "$5" >>"$R$modes" ) 2>/dev/null \
      || { echo "[security] ROLE-ISOLATION-ERROR: custody migrate: cannot record the pre-flag state of $1" >&2; return 1; }
    recorded[$1]=1
  }
  # Directories first: a symlink or non-directory at a registry dir stops its rows.
  for dir in "${!is_dir[@]}"; do
    if [ -L "$R$dir" ] || [ ! -d "$R$dir" ]; then
      echo "[security] ROLE-ISOLATION-ERROR: custody migrate: ${dir} is not a real directory; its at-rest copies are left alone" >&2
      is_dir[$dir]=; AB_RC_MIG_FAILURES=$((AB_RC_MIG_FAILURES + 1)); continue
    fi
    read -r uid gid mode _ <<<"$(_ab_rc_stat "$R$dir")"
    _ab_rc_note "$dir" d "$uid" "$gid" "$mode" || AB_RC_MIG_FAILURES=$((AB_RC_MIG_FAILURES + 1))
  done
  # The record itself: root 0600 (created by this root process; tests stub chown).
  if [ -f "$R$modes" ]; then
    _ab_rc_set "$R$modes" 0:0 600 || true
  fi
  while IFS=$'\t' read -r kind a b c; do
    [ "$kind" = atrest ] || continue
    p="$b"; l="$c"
    if [ -z "${role_uid[$a]:-}" ]; then
      echo "[security] ROLE-ISOLATION-ERROR: custody migrate: ${p} names role ${a:-?}, which has no role row; skipped" >&2
      AB_RC_MIG_FAILURES=$((AB_RC_MIG_FAILURES + 1)); continue
    fi
    if [ -z "${is_dir[${p%/*}]:-}" ]; then
      echo "[security] ROLE-ISOLATION-ERROR: custody migrate: ${p} is not inside a usable at-rest dir; left alone" >&2
      AB_RC_MIG_FAILURES=$((AB_RC_MIG_FAILURES + 1)); continue
    fi
    seen="${recorded[$p]:-}"
    if [ ! -e "$R$p" ] && [ ! -L "$R$p" ] && [ "$l" != - ] && [ -f "$R$l" ] && [ ! -L "$R$l" ]; then
      size="$(stat -c %s -- "$R$l" 2>/dev/null || echo 0)"
      if [ "$size" -gt "$AB_RC_MAX_SECRET_BYTES" ] || [ "$size" -eq 0 ]; then
        echo "[security] ROLE-ISOLATION-ERROR: custody migrate: legacy ${l} is ${size} bytes; not copied" >&2
        printf 'refused\t%s\tlegacy-size\n' "$p" >>"$rec"
        AB_RC_MIG_FAILURES=$((AB_RC_MIG_FAILURES + 1)); continue
      fi
      tmp="$R${p%/*}/.${p##*/}.migrate.$$"
      rm -f -- "$tmp" 2>/dev/null || true
      if ( umask 077; cat -- "$R$l" >"$tmp" ) 2>/dev/null && sync -- "$tmp" 2>/dev/null \
         && [ "$(stat -c %s -- "$tmp" 2>/dev/null)" = "$size" ] && _ab_rc_same "$R$l" "$tmp" \
         && mv -T -- "$tmp" "$R$p"; then
        sync -- "$R${p%/*}" 2>/dev/null || true
        read -r uid gid mode _ <<<"$(_ab_rc_stat "$R$l")"
        # Pre-flag state of a copy that did not exist: devuser's, at the legacy mode.
        _ab_rc_note "$p" f "${AB_RC_DEVUSER_IDS%%:*}" "${AB_RC_DEVUSER_IDS##*:}" "$mode" || AB_RC_MIG_FAILURES=$((AB_RC_MIG_FAILURES + 1))
        seen=copied
        printf 'copied\t%s\t%s\n' "$p" "$l" >>"$rec"
        AB_RC_MIGRATED=$((AB_RC_MIGRATED + 1))
        echo "[security] role-isolation: custody migrate: copied ${l} -> ${p} (verified; legacy copy left in place)"
      else
        rm -f -- "$tmp" 2>/dev/null || true
        echo "[security] ROLE-ISOLATION-ERROR: custody migrate: copying ${l} -> ${p} failed verification; nothing placed" >&2
        printf 'refused\t%s\tcopy-verify\n' "$p" >>"$rec"
        AB_RC_MIG_FAILURES=$((AB_RC_MIG_FAILURES + 1)); continue
      fi
    fi
    if [ ! -e "$R$p" ] && [ ! -L "$R$p" ]; then
      printf 'absent\t%s\t%s\n' "$p" "$l" >>"$rec"
      continue
    fi
    st="$(_ab_rc_stat "$R$p")"
    read -r uid gid mode links size _ <<<"$st"
    local why=""
    if [ -L "$R$p" ]; then why=symlink
    elif [ ! -f "$R$p" ]; then why=not-regular
    elif [ "${links:-0}" != 1 ]; then why=hard-linked
    elif [ "${size:-0}" -eq 0 ]; then why=empty
    elif [ "$size" -gt "$AB_RC_MAX_SECRET_BYTES" ]; then why=oversized
    elif [ -z "$seen" ] && [ "$l" != - ] && [ -f "$R$l" ] && [ ! -L "$R$l" ] && ! _ab_rc_same "$R$l" "$R$p"; then
      why=differs-from-legacy
    fi
    if [ -n "$why" ]; then
      AB_RC_REFUSED[$p]="$why"
      echo "[security] ROLE-ISOLATION-ERROR: custody migrate: ${p} refused (${why}); not re-owned, not delivered. Inspect it, then remove it to re-migrate from ${l}" >&2
      printf 'refused\t%s\t%s\n' "$p" "$why" >>"$rec"
      AB_RC_MIG_FAILURES=$((AB_RC_MIG_FAILURES + 1)); continue
    fi
    _ab_rc_note "$p" f "$uid" "$gid" "$mode" || AB_RC_MIG_FAILURES=$((AB_RC_MIG_FAILURES + 1))
    if ! _ab_rc_set "$R$p" "${role_uid[$a]}:${role_uid[$a]}" 400; then
      echo "[security] ROLE-ISOLATION-ERROR: custody migrate: cannot hand ${p} to ${a} 0400" >&2
      AB_RC_MIG_FAILURES=$((AB_RC_MIG_FAILURES + 1)); continue
    fi
    if [ "$seen" != copied ]; then
      if [ "$l" != - ] && [ -e "$R$l" ]; then printf 'present\t%s\t%s\n' "$p" "$l" >>"$rec"
      else printf 'present\t%s\t-\n' "$p" >>"$rec"; fi
    fi
  done < <(_ab_rc_plan_rows "$plan")
  for dir in "${!is_dir[@]}"; do
    [ -n "${is_dir[$dir]}" ] || continue
    _ab_rc_set "$R$dir" 0:0 "${is_dir[$dir]}" \
      || { echo "[security] ROLE-ISOLATION-ERROR: custody migrate: cannot make ${dir} root ${is_dir[$dir]}" >&2; AB_RC_MIG_FAILURES=$((AB_RC_MIG_FAILURES + 1)); }
  done
  unset -f _ab_rc_note
  if [ "$rec" != /dev/null ]; then
    chmod 0644 "$rec" 2>/dev/null || true
    if [ -L "$R$record" ] || { [ -e "$R$record" ] && [ ! -f "$R$record" ]; }; then
      mv -T -- "$R$record" "$R$record.squatted.$$" 2>/dev/null || true
    fi
    # mktemp ran as root, so the record is root's already; the rename keeps that.
    mv -f -- "$rec" "$R$record" 2>/dev/null || rm -f -- "$rec"
  fi
  echo "[security] role-isolation: custody migrate: ${AB_RC_MIGRATED} copied, ${#AB_RC_REFUSED[@]} refused, ${AB_RC_MIG_FAILURES} problem(s); record ${record}"
  return 0
}

# ab_custody_revert <plan>: hand every recorded registry path back to devuser (root
# if root owned it before) at its pre-flag mode. No trusted record, no change.
# Sets AB_RC_REVERTED.
ab_custody_revert() {
  local plan="$1" R="${AB_RC_ROOT:-}" kind a b c modes="" p kindc ids mode n=0
  local -A want=()
  AB_RC_REVERTED=0
  [ -r "$plan" ] || return 0
  while IFS=$'\t' read -r kind a b c; do
    case "$kind" in
      atrestdir) want[$a]=d; [ -n "$modes" ] || modes="${a}/.role-custody.modes" ;;
      atrest) want[$b]=f ;;
    esac
  done < <(_ab_rc_plan_rows "$plan")
  [ -n "$modes" ] || return 0
  if [ ! -e "$R$modes" ] && [ ! -L "$R$modes" ]; then return 0; fi
  if ! _ab_rc_modes_trusted "$R$modes"; then
    echo "[security] ROLE-ISOLATION-ERROR: custody revert: ${modes} is not a root-owned 0600 single-link file; nothing reverted" >&2
    return 0
  fi
  while IFS=$'\t' read -r kindc p ids mode; do
    case "$kindc" in d|f) ;; *) continue ;; esac
    # Only registry paths, and only as the kind the plan names.
    [ "${want[$p]:-}" = "$kindc" ] || continue
    case "$mode" in [0-7][0-7][0-7]) ;; [0-7][0-7][0-7][0-7]) [ "$kindc" = d ] || mode="${mode#?}" ;; *) continue ;; esac
    if [ ! -e "$R$p" ] || [ -L "$R$p" ]; then continue; fi
    if [ "$kindc" = d ] && [ ! -d "$R$p" ]; then continue; fi
    if [ "$kindc" = f ] && [ ! -f "$R$p" ]; then continue; fi
    # Back to devuser; a path root owned before the flag (identities/ is made by
    # root's mkdir) goes back to root. No other owner is ever restored.
    [ "$ids" = 0:0 ] || ids="$AB_RC_DEVUSER_IDS"
    if _ab_rc_set "$R$p" "$ids" "$mode"; then n=$((n + 1))
    else echo "[security] ROLE-ISOLATION-ERROR: custody revert: cannot hand ${p} back to devuser ${mode}" >&2; fi
  done <"$R$modes"
  # shellcheck disable=SC2034  # documented output (see the header above), read by callers
  AB_RC_REVERTED=$n
  echo "[security] role-isolation: custody revert: ${n} registry path(s) handed back to devuser"
  return 0
}
