#!/bin/bash
# Hook: PreCompact — save critical context before compaction loses it
# Ensures plan, memory, and current state survive context compression

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Ensure build exists
if [ ! -f dist/cli.js ]; then
  echo "lazy-fetch not built. Run: cd $(pwd) && npm run build" >&2
  exit 0
fi

# Snapshot current state before compaction
node dist/cli.js snapshot "pre-compact" >/dev/null 2>&1 || true

# Regenerate CONTEXT.md so it's fresh post-compaction
node dist/cli.js claudemd >/dev/null 2>&1 || true

# Inject context that should survive compaction
CONTEXT=""

if [ -f .lazy/plan.md ]; then
  PLAN=$(cat .lazy/plan.md 2>/dev/null)
  CONTEXT="${CONTEXT}## Active Plan\n${PLAN}\n\n"
fi

if [ -f .lazy/memory.json ]; then
  MEM=$(node -e "
    const m = JSON.parse(require('fs').readFileSync('.lazy/memory.json','utf-8'));
    Object.entries(m).forEach(([k,v]) => console.log('- **' + k + '**: ' + v.value));
  " 2>/dev/null)
  if [ -n "$MEM" ]; then
    CONTEXT="${CONTEXT}## Persistent Memory\n${MEM}\n\n"
  fi
fi

if [ -n "$CONTEXT" ]; then
  MSG=$(printf "%b" "$CONTEXT")
  jq -n --arg ctx "$MSG" '{
    "hookSpecificOutput": {
      "hookEventName": "PreCompact",
      "additionalContext": ("IMPORTANT — Lazy Fetch state to preserve through compaction:\n\n" + $ctx + "\nFull state available via `lazy status` and `lazy recall`.")
    }
  }'
fi
