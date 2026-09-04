#!/usr/bin/env bash
# Relative markdown links must resolve. Usage: check-links.sh <doc.md>…  Exit 1 on any broken link.
set -u
rc=0
for f in "$@"; do
  d=$(dirname "$f")
  grep -oE '\]\(([^)#[:space:]]+)' "$f" | sed 's/](//' | grep -vE '^(https?:|mailto:)' | sort -u | while read -r l; do
    [ -e "$d/$l" ] || { echo "BROKEN in $f: $l"; exit 9; }
  done || rc=1
done
[ $rc -eq 0 ] && echo "links ok"
exit $rc
