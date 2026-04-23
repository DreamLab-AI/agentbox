#!/bin/bash
# Hook: Validate that new framework analysis files follow the template structure
# Triggers on file writes to research/frameworks/

FILE="$1"

if [[ "$FILE" == research/frameworks/*.md ]]; then
  # Check for required sections
  REQUIRED_SECTIONS=("Overview" "Architecture" "Key Patterns" "Strengths" "Weaknesses" "Unique Ideas")
  MISSING=()

  for section in "${REQUIRED_SECTIONS[@]}"; do
    if ! grep -qi "## .*$section" "$FILE" 2>/dev/null; then
      MISSING+=("$section")
    fi
  done

  if [ ${#MISSING[@]} -gt 0 ]; then
    echo "WARNING: Framework analysis missing sections: ${MISSING[*]}"
    echo "See CLAUDE.md for the required template."
    exit 1
  fi
fi

exit 0
