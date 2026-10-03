#!/usr/bin/env bash
# bake-devuser-privilege.sh <etc-dir> <role_isolation 0|1>
#
# Custody X-1 (W10, ADR-2122): devuser's sudo route, baked by flake.nix into the
# image's read-only /etc with the BUILD-time [security].role_isolation.
#
#   0 (off, today's image): /etc/group is left exactly as the flake's heredoc
#     wrote it (wheel:x:998:devuser); /etc/sudoers holds root and the
#     includedir; /etc/sudoers.d/devuser grants devuser NOPASSWD: ALL.
#   1 (on): devuser is removed from the member lists of root (gid 0) and wheel,
#     other members kept; /etc/sudoers is the same two lines; NO drop-in, so no
#     sudoers line grants devuser anything.
#
# Runs after the /etc/group heredoc. The boot-time half is
# _ab_devuser_privilege_check in config/entrypoint-unified.sh: an image baked
# with 0 and booted with the flag on cannot be repaired at runtime (/etc is
# read-only), so the boot records degraded:devuser-sudo until a rebuild.
# Test: tests/runtime-contract/RC-X1-07.sh.
set -eu

etc="${1:?usage: bake-devuser-privilege.sh <etc-dir> <0|1>}"
iso="${2:?usage: bake-devuser-privilege.sh <etc-dir> <0|1>}"
case "$iso" in
  0|1) ;;
  *) echo "bake-devuser-privilege: role_isolation must be 0 or 1, got '$iso'" >&2; exit 2 ;;
esac
[ -f "$etc/group" ] || { echo "bake-devuser-privilege: $etc/group is missing (run after the group heredoc)" >&2; exit 2; }

if [ "$iso" = 1 ]; then
  tmp="$etc/.group.bake.$$"
  awk -F: -v OFS=: '
    ($1 == "wheel" || $3 == "0") {
      n = split($4, m, ","); out = ""
      for (i = 1; i <= n; i++) if (m[i] != "devuser" && m[i] != "") out = out (out == "" ? "" : ",") m[i]
      $4 = out
    }
    { print }' "$etc/group" >"$tmp"
  mv -f -- "$tmp" "$etc/group"
fi

printf 'root ALL=(ALL) ALL\n#includedir /etc/sudoers.d\n' >"$etc/sudoers"
chmod 440 "$etc/sudoers"
mkdir -p "$etc/sudoers.d"
if [ "$iso" = 0 ]; then
  printf 'devuser ALL=(ALL) NOPASSWD: ALL\n' >"$etc/sudoers.d/devuser"
  chmod 440 "$etc/sudoers.d/devuser"
fi
