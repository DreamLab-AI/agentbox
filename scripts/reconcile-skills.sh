#!/usr/bin/env bash
# reconcile-skills.sh — make ~/.claude/skills a deterministic reflection of the
# curated registered-skills manifest, sourced from the baked /opt/agentbox/skills tree.
#
# Replaces the historical ad-hoc accretion of ~/.claude/skills (hand-copied dirs of
# mixed ownership/age, with no mechanism keeping them current or complete — which is
# why blender/qgis were invisible to every session). After this runs, each registered
# skill is a symlink into /opt/agentbox/skills/<name> (single source of truth, baked
# from source), so a rebuild always yields the current skill and nothing goes stale.
#
# Idempotent and FAIL-OPEN: it never exits non-zero in a way that could block boot.
# Only touches names listed in the manifest; never deletes unmanaged ~/.claude/skills
# entries (user-added skills are left alone).
#
# Usage: reconcile-skills.sh [--dry-run]
set -uo pipefail

SKILLS_TREE="${SKILLS_TREE:-/opt/agentbox/skills}"
CLAUDE_SKILLS="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
MANIFEST="${REGISTERED_SKILLS_MANIFEST:-$SKILLS_TREE/registered-skills.txt}"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

log() { echo "[reconcile-skills] $*"; }

if [ ! -f "$MANIFEST" ]; then
  log "manifest not found at $MANIFEST — skipping (no-op)"
  exit 0
fi
mkdir -p "$CLAUDE_SKILLS" 2>/dev/null || true

registered=0 linked=0 converted=0 fixed=0 missing=0 skipped=0
while IFS= read -r raw; do
  name="${raw%%#*}"; name="$(echo "$name" | tr -d '[:space:]')"
  [ -z "$name" ] && continue
  registered=$((registered + 1))
  src="$SKILLS_TREE/$name"
  dst="$CLAUDE_SKILLS/$name"

  if [ ! -f "$src/SKILL.md" ]; then
    log "WARN registered '$name' has no $src/SKILL.md — not baked; leaving any existing registration untouched"
    missing=$((missing + 1))
    continue
  fi

  # Already the correct symlink? nothing to do.
  if [ -L "$dst" ] && [ "$(readlink -f "$dst" 2>/dev/null)" = "$(readlink -f "$src" 2>/dev/null)" ]; then
    skipped=$((skipped + 1))
    continue
  fi

  if [ -e "$dst" ] || [ -L "$dst" ]; then
    # Existing realdir copy or stale/wrong symlink → replace with the canonical symlink.
    if [ -d "$dst" ] && [ ! -L "$dst" ]; then converted=$((converted + 1)); action="convert realdir→symlink"; else fixed=$((fixed + 1)); action="fix stale link"; fi
    if [ "$DRY_RUN" -eq 1 ]; then log "DRY $action: $dst -> $src"; continue; fi
    rm -rf "$dst" 2>/dev/null || true
    # Guard: if removal failed (e.g. root-owned dir and we're unprivileged), do NOT
    # ln into the surviving directory — that would nest a link inside it. Skip loudly.
    if [ -e "$dst" ] || [ -L "$dst" ]; then
      log "ERROR cannot replace $name (removal failed — likely root-owned; the boot reconciler runs privileged and will fix it)"
      continue
    fi
    ln -sfnT "$src" "$dst" 2>/dev/null && log "$action: $name" || { ln -sfn "$src" "$dst" && log "$action: $name" || log "ERROR linking $name"; }
  else
    linked=$((linked + 1))
    if [ "$DRY_RUN" -eq 1 ]; then log "DRY link new: $dst -> $src"; continue; fi
    ln -sfnT "$src" "$dst" 2>/dev/null && log "linked new: $name" || { ln -sfn "$src" "$dst" && log "linked new: $name" || log "ERROR linking $name"; }
  fi
done < "$MANIFEST"

drylabel=""; [ "$DRY_RUN" -eq 1 ] && drylabel=" (dry-run)"
log "done: $registered registered | new=$linked converted=$converted fixed=$fixed already-ok=$skipped not-baked=$missing${drylabel}"
exit 0
