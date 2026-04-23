#!/bin/bash
# Hook: Remind to tag insights when writing research files
# Checks that research files contain category tags

FILE="$1"

if [[ "$FILE" == research/**/*.md ]]; then
  if ! grep -qE '\[(hook|skill|mcp|agent|pattern|memory|sandbox|orchestration)\]' "$FILE" 2>/dev/null; then
    echo "REMINDER: Research file has no category tags. Consider adding: [hook], [skill], [mcp], [agent], [pattern], [memory], [sandbox], [orchestration]"
    # Non-blocking — just a reminder
    exit 0
  fi
fi

exit 0
