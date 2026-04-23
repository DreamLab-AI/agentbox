#!/bin/bash
# Hook: SessionStart — inject lazy fetch context into Claude Code
# Runs lazy read + feeds CONTEXT.md as additional context

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Ensure build exists
if [ ! -f dist/cli.js ]; then
  echo "lazy-fetch not built. Run: cd $(pwd) && npm run build" >&2
  exit 0
fi

# Ensure .lazy exists
node dist/cli.js init >/dev/null 2>&1 || true

# Update file access patterns silently
node dist/cli.js watch >/dev/null 2>&1 || true

# Generate fresh context
node dist/cli.js claudemd >/dev/null 2>&1 || true

# Build the context summary for Claude Code
CONTEXT=""

# Plan status
if [ -f .lazy/plan.json ]; then
  PLAN_MD=$(cat .lazy/plan.md 2>/dev/null)
  if [ -n "$PLAN_MD" ]; then
    CONTEXT="${CONTEXT}## Current Plan\n${PLAN_MD}\n\n"
  fi
fi

# Memory
if [ -f .lazy/memory.json ]; then
  MEM=$(node -e "
    const m = JSON.parse(require('fs').readFileSync('.lazy/memory.json','utf-8'));
    Object.entries(m).forEach(([k,v]) => console.log('- **' + k + '**: ' + v.value));
  " 2>/dev/null)
  if [ -n "$MEM" ]; then
    CONTEXT="${CONTEXT}## Persistent Memory\n${MEM}\n\n"
  fi
fi

# Recent journal entries (last 3)
if [ -f .lazy/journal.md ]; then
  JOURNAL=$(tail -20 .lazy/journal.md 2>/dev/null)
  if [ -n "$JOURNAL" ]; then
    CONTEXT="${CONTEXT}## Recent Journal\n${JOURNAL}\n\n"
  fi
fi

# Git summary
BRANCH=$(git branch --show-current 2>/dev/null)
DIRTY=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
if [ -n "$BRANCH" ]; then
  CONTEXT="${CONTEXT}## Git State\nBranch: ${BRANCH}, ${DIRTY} uncommitted changes\n"
fi

# Output as system message + additional context
if [ -n "$CONTEXT" ]; then
  # Use printf to handle \n properly
  MSG=$(printf "%b" "$CONTEXT")
  # Output JSON that injects context into the model
  jq -n --arg ctx "$MSG" '{
    "hookSpecificOutput": {
      "hookEventName": "SessionStart",
      "additionalContext": ("Lazy Fetch session context (auto-loaded):\n\n" + $ctx + "\n\nUse `lazy status` for full plan details, `lazy recall` for all memory.")
    }
  }'
fi
