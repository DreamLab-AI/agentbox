#!/usr/bin/env bash
# Gate C helper: for every `path:line[-line][,…]` in a claims ledger, check the path exists
# (relative to the repo root, or one level up for sibling-repo citations) and print the
# cited lines so a reader can confirm they still say what the claim says.
# Usage: check-ledger.sh <ledger.md> <repo-root>   Exit 1 if any cited path is missing.
set -u
ledger=$1; root=$2; missing=0
while read -r ref; do
  path=${ref%%:*}; spec=${ref#*:}
  file="$root/$path"; [ -e "$file" ] || file="$root/../$path"
  if [ ! -e "$file" ]; then echo "MISSING: $path"; missing=$((missing+1)); continue; fi
  echo "== $ref"
  IFS=',' read -ra parts <<< "$spec"
  for p in "${parts[@]}"; do
    a=${p%%-*}; b=${p##*-}
    sed -n "${a},${b}p" "$file" | cut -c1-160 | sed 's/^/   /'
  done
done < <(grep -oE '`[^`]+:[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*`' "$ledger" | tr -d '`' | sort -u)
[ "$missing" -eq 0 ] && echo "ledger paths ok" || echo "$missing missing"
[ "$missing" -eq 0 ]
