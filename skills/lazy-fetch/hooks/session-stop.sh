#!/bin/bash
# Hook: Stop — update lazy fetch state when Claude Code stops
# Captures what happened, updates access patterns

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Ensure build exists
if [ ! -f dist/cli.js ]; then
  echo "lazy-fetch not built. Run: cd $(pwd) && npm run build" >&2
  exit 0
fi

# Update file access patterns from git
node dist/cli.js watch >/dev/null 2>&1 || true

# Regenerate context for next session
node dist/cli.js claudemd >/dev/null 2>&1 || true

# Auto-journal: log what files changed in this session
CHANGED=$(git diff --name-only 2>/dev/null | head -10)
STAGED=$(git diff --cached --name-only 2>/dev/null | head -10)
ALL_CHANGED=$(printf "%s\n%s" "$CHANGED" "$STAGED" | sort -u | grep -v '^$')

if [ -n "$ALL_CHANGED" ]; then
  COUNT=$(echo "$ALL_CHANGED" | wc -l | tr -d ' ')
  SUMMARY="Auto-log: ${COUNT} file(s) modified — $(echo "$ALL_CHANGED" | head -5 | tr '\n' ', ' | sed 's/,$//')"

  # Append to journal
  DATE=$(date +%Y-%m-%d)
  TIME=$(date +%H:%M)

  if [ -f .lazy/journal.md ]; then
    printf "\n## %s %s\n%s\n" "$DATE" "$TIME" "$SUMMARY" >> .lazy/journal.md
  fi
fi

exit 0
