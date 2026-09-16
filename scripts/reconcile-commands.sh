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
# script only removes. Retirement is to a recoverable .superseded/ sidecar, never
# a delete.
#
# Idempotent and FAIL-OPEN: never exits non-zero in a way that could block boot.
#
# Usage: reconcile-commands.sh [--dry-run]
set -uo pipefail

# Colon-separated command roots. The first is primary; all are pruned alike.
COMMAND_ROOTS="${COMMAND_ROOT_TARGETS:-$HOME/.claude/commands}"
MANIFEST="${REGISTERED_COMMANDS_MANIFEST:-/opt/agentbox/config/registered-commands.txt}"

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

retired=0 kept=0 roots=0
IFS=':' read -r -a _roots <<< "$COMMAND_ROOTS"
for root in "${_roots[@]}"; do
  [ -n "$root" ] && [ -d "$root" ] || continue
  roots=$((roots + 1))
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    rel="${f#"$root"/}"
    if is_kept "$rel"; then
      kept=$((kept + 1))
      continue
    fi
    dest="$root/.superseded/$rel"
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
  # nullifies -prune, so exclude the sidecar by path test and use rmdir instead.
  if [ "$DRY_RUN" -eq 0 ]; then
    for _pass in 1 2 3 4 5; do
      find "$root" -mindepth 1 -type d -empty \
        ! -name .superseded ! -path "$root/.superseded/*" \
        -exec rmdir {} + 2>/dev/null || true
    done
  fi
done

drylabel=""; [ "$DRY_RUN" -eq 1 ] && drylabel=" (dry-run)"
log "done: $roots root(s) | $kept_names registered | kept=$kept retired=$retired${drylabel}"
exit 0
