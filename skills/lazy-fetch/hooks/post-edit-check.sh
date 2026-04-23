#!/bin/bash
# Hook: PostToolUse on Write|Edit — lightweight validation after code changes
# Only runs on source code files, not docs/config

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Extract file path from stdin
FILE="$1"

# Skip if not a source file
case "$FILE" in
  *.ts|*.js|*.py|*.rs|*.go|*.rb)
    ;;
  *)
    exit 0
    ;;
esac

# Run typecheck only (fast, catches real issues)
if [ -f tsconfig.json ]; then
  RESULT=$(npx tsc --noEmit 2>&1)
  EXIT=$?
  if [ $EXIT -ne 0 ]; then
    # Count errors
    ERRORS=$(echo "$RESULT" | grep -c "error TS" 2>/dev/null || echo "0")
    # Get first 3 errors for context
    FIRST_ERRORS=$(echo "$RESULT" | grep "error TS" | head -3)
    jq -n --arg errors "$ERRORS" --arg detail "$FIRST_ERRORS" '{
      "hookSpecificOutput": {
        "hookEventName": "PostToolUse",
        "additionalContext": ("TypeScript check found " + $errors + " error(s) after this edit:\n" + $detail + "\nConsider fixing these before proceeding.")
      }
    }'
  fi
fi
