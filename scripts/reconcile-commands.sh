#!/usr/bin/env bash
# reconcile-commands.sh — retire the inherited claude-flow slash-command dump,
# keeping only the commands named in config/registered-commands.txt.
#
# Sibling of reconcile-agents.sh and the same rationale (ADR-2092): nothing ever
# governed ~/.claude/commands. `ruflo init` dumps its command tree there, the
# directory is on a host mount so the dump survives every rebuild, and a second
# near-identical copy lands in $WORKSPACE/.claude/commands whenever init is run
# from a nested CWD. Both are read into the prompt.
#
# Prune-only by design: commands are installed by their owning subsystem rather
# than projected from a canonical tree, so there is nothing to link — this
# script only removes. Retirement is a move into a recoverable sidecar OUTSIDE
# every command root, never a delete: $SUPERSEDED_BASE/commands/<root-key>/<rel>,
# root-key being the root path as a readable slug minus the trailing /commands
# (/home/devuser/.claude/commands -> home-devuser-.claude). The base defaults to
# `agentbox-superseded` beside the first root's parent .claude dir (independent of
# $HOME, which is /root under the entrypoint); override with
# AGENTBOX_SUPERSEDED_DIR. The sidecar used to be $root/.superseded/, but Claude
# Code scans command roots recursively, dot-directories included, so all 139
# retired commands still loaded as `.superseded:*` slash commands. A legacy
# in-root sidecar is migrated out on every run, so the fix heals itself at boot.
#
# Idempotent and FAIL-OPEN: never exits non-zero in a way that could block boot.
#
# Usage: reconcile-commands.sh [--dry-run]
set -uo pipefail

# Colon-separated command roots. The first is primary; all are pruned alike.
COMMAND_ROOTS="${COMMAND_ROOT_TARGETS:-$HOME/.claude/commands}"
MANIFEST="${REGISTERED_COMMANDS_MANIFEST:-/opt/agentbox/config/registered-commands.txt}"
_first_root="${COMMAND_ROOTS%%:*}"
SUPERSEDED_BASE="${AGENTBOX_SUPERSEDED_DIR:-$(dirname "${_first_root%/}")/agentbox-superseded}"
SUPERSEDED_KIND="commands"

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

log() { echo "[reconcile-commands] $*"; }

if [ ! -f "$MANIFEST" ]; then
  log "manifest not found at $MANIFEST — skipping (no-op)"
  exit 0
fi

KEEP=""
kept_names=0
while IFS= read -r raw; do
  name="${raw%%#*}"; name="$(printf '%s' "$name" | tr -d '[:space:]')"
  [ -z "$name" ] && continue
  KEEP="$KEEP $name"
  kept_names=$((kept_names + 1))
done < "$MANIFEST"

is_kept() {
  case " $KEEP " in *" $1 "*) return 0 ;; *) return 1 ;; esac
}

# ── the sidecar: outside every scanned root ────────────────────────────────
# root_key /home/devuser/workspace/.claude/commands -> home-devuser-workspace-.claude
root_key() {
  local r="${1%/}"
  r="${r%/"$SUPERSEDED_KIND"}"
  r="${r#/}"
  printf '%s' "${r//\//-}"
}
sidecar_for() { printf '%s/%s/%s' "$SUPERSEDED_BASE" "$SUPERSEDED_KIND" "$(root_key "$1")"; }

# ── migrate a legacy in-root .superseded/ sidecar out of the root ──────────
# Merge, never clobber: an identical file already in the new sidecar makes the
# legacy copy redundant; a differing one is kept beside it with a .migrated-N
# suffix. The emptied legacy tree is then removed.
migrated=0
# cmp is not on the image PATH; sha256sum is coreutils and always is.
same_content() {
  [ -f "$1" ] && [ -f "$2" ] || return 1
  [ "$(sha256sum < "$1" 2>/dev/null)" = "$(sha256sum < "$2" 2>/dev/null)" ]
}
migrate_legacy() {
  local root="$1" legacy="$1/.superseded" side f rel dest n
  [ -d "$legacy" ] || return 0
  side="$(sidecar_for "$root")"
  if [ "$DRY_RUN" -eq 1 ]; then log "DRY migrate legacy sidecar: $legacy -> $side"; return 0; fi
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    rel="${f#"$legacy"/}"
    dest="$side/$rel"
    mkdir -p "$(dirname "$dest")" 2>/dev/null || true
    if [ -e "$dest" ] || [ -L "$dest" ]; then
      if same_content "$f" "$dest"; then
        rm -f "$f" 2>/dev/null || log "ERROR cannot remove migrated duplicate $legacy/$rel"
        continue
      fi
      n=1
      while [ -e "$dest.migrated-$n" ] || [ -L "$dest.migrated-$n" ]; do n=$((n + 1)); done
      dest="$dest.migrated-$n"
    fi
    if mv "$f" "$dest" 2>/dev/null; then
      migrated=$((migrated + 1))
    else
      log "ERROR cannot migrate $legacy/$rel (likely root-owned; the boot reconciler runs privileged and will fix it)"
    fi
  done <<EOF
$(find "$legacy" \( -type f -o -type l \) -print 2>/dev/null)
EOF
  find "$legacy" -depth -type d -empty -exec rmdir {} \; 2>/dev/null || true
  [ -d "$legacy" ] && log "WARN legacy sidecar $legacy not fully migrated" || log "migrated legacy sidecar out of $root"
}

retired=0 kept=0 roots=0
IFS=':' read -r -a _roots <<< "$COMMAND_ROOTS"
for root in "${_roots[@]}"; do
  [ -n "$root" ] && [ -d "$root" ] || continue
  roots=$((roots + 1))
  migrate_legacy "$root"
  side="$(sidecar_for "$root")"
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    rel="${f#"$root"/}"
    if is_kept "$rel"; then
      kept=$((kept + 1))
      continue
    fi
    dest="$side/$rel"
    if [ "$DRY_RUN" -eq 1 ]; then log "DRY retire: $rel"; retired=$((retired + 1)); continue; fi
    mkdir -p "$(dirname "$dest")" 2>/dev/null || true
    if mv -f "$f" "$dest" 2>/dev/null; then
      retired=$((retired + 1))
    else
      log "ERROR cannot retire $rel (likely root-owned; the boot reconciler runs privileged and will fix it)"
    fi
  done <<EOF
$(find "$root" -path "$root/.superseded" -prune -o -type f -name '*.md' -print 2>/dev/null)
EOF

  # Drop the category dirs the retirements emptied. -delete implies -depth, which
  # nullifies -prune, so a legacy sidecar that could not be migrated is excluded
  # by path test and rmdir is used instead.
  if [ "$DRY_RUN" -eq 0 ]; then
    for _pass in 1 2 3 4 5; do
      find "$root" -mindepth 1 -type d -empty \
        ! -name .superseded ! -path "$root/.superseded/*" \
        -exec rmdir {} + 2>/dev/null || true
    done
  fi
done

# The boot run is privileged: hand the sidecar to the owner of the directory it
# sits in, so the operator can restore from it without root.
if [ "$DRY_RUN" -eq 0 ] && [ "$(id -u)" -eq 0 ] && [ -d "$SUPERSEDED_BASE" ]; then
  chown -R --reference="$(dirname "$SUPERSEDED_BASE")" "$SUPERSEDED_BASE" 2>/dev/null || true
fi

drylabel=""; [ "$DRY_RUN" -eq 1 ] && drylabel=" (dry-run)"
log "done: $roots root(s) | $kept_names registered | kept=$kept retired=$retired migrated-legacy=$migrated | sidecar=$SUPERSEDED_BASE/$SUPERSEDED_KIND${drylabel}"
exit 0
