#!/usr/bin/env bash
# ascii-svg-auto-sync.sh  (best-effort, optional)
# PostToolUse hook: after a markdown edit, compare each tracked diagram's ASCII
# hash against the manifest and report any that have gone stale. It only REPORTS
# — Claude regenerates the SVG when it sees the message. Safe to run anywhere;
# it no-ops when there is no manifest.
#
# Install: see SHARING.md. Reference it portably with ${CLAUDE_SKILL_DIR}.
set -euo pipefail

manifest="$(pwd)/.ascii-to-svg-manifest.json"
[ -f "$manifest" ] || exit 0          # nothing tracked here → quietly do nothing

if ! command -v jq >/dev/null 2>&1; then
  echo "ascii-to-svg: install 'jq' to enable automatic stale detection (or run: Sync ASCII to SVG)." >&2
  exit 0
fi

stale=0
count="$(jq '.diagrams | length' "$manifest" 2>/dev/null || echo 0)"
for i in $(seq 0 $((count-1))); do
  src=$(jq -r ".diagrams[$i].sourceFile" "$manifest")
  id=$(jq -r ".diagrams[$i].id" "$manifest")
  stored=$(jq -r ".diagrams[$i].asciiHash" "$manifest" | sed 's/^sha256://')
  [ -f "$src" ] || continue
  # Extract the ASCII inside the <details> fenced block that follows this diagram's image.
  current=$(awk -v RS='</details>' "/$id/{print; exit}" "$src" 2>/dev/null \
            | sed -n '/```/,/```/p' | sed '1d;$d' \
            | sha256sum | awk '{print $1}')
  [ -z "$current" ] && continue
  if [ "$current" != "$stored" ]; then
    echo "STALE DIAGRAMS DETECTED: '$id' in $src — ASCII changed; regenerate its SVG." >&2
    stale=$((stale+1))
  fi
done
[ "$stale" -gt 0 ] && echo "ascii-to-svg: $stale stale diagram(s). Regenerate to bring SVGs back in sync." >&2
exit 0
