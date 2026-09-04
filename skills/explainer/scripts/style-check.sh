#!/usr/bin/env bash
# Count em-dashes and AI-tell vocabulary per file. Exit 1 if any file has either.
set -u
rc=0
for f in "$@"; do
  em=$(grep -o '—' "$f" | wc -l)
  tells=$(grep -oiE '\b(delve|delving|seamless(ly)?|robust(ly)?|leverage[sd]?|leveraging|worth noting|it is important to note|in today.s|tapestry|game-changer|cutting-edge|unlock)\b' "$f" | wc -l)
  words=$(wc -w < "$f")
  printf '%s: words=%s em-dashes=%s tells=%s\n' "$f" "$words" "$em" "$tells"
  if [ "$em" -gt 0 ] || [ "$tells" -gt 0 ]; then
    rc=1
    grep -niE '—|\b(delve|delving|seamless(ly)?|robust(ly)?|leverage[sd]?|leveraging|worth noting|it is important to note|tapestry|game-changer|cutting-edge|unlock)\b' "$f" | head -20
  fi
done
exit $rc
