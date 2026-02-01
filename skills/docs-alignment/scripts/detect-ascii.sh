#!/bin/bash
# ASCII Diagram Detector - Finds remaining ASCII art diagrams
set -euo pipefail

DOCS_ROOT="${DOCS_ROOT:-$(dirname "$(dirname "$(realpath "$0")")")}"
REPORT_FILE="${REPORT_FILE:-/tmp/ascii-detection-report.txt}"
EXIT_CODE=0

echo "=== ASCII Diagram Detection Report ===" > "$REPORT_FILE"
echo "Generated: $(date)" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# ASCII art patterns
ASCII_PATTERNS=(
    '\+[-=]+\+'     # Box drawing with +---+
    '\|.*\|.*\|'    # Multiple pipes in a line
    '┌[─┐]'         # Unicode box drawing
    '├[─┤]'         # Unicode box drawing
    '└[─┘]'         # Unicode box drawing
    '▼|▲|►|◄'       # Arrow symbols
    '─{3,}'         # Three or more horizontal lines
    '│{2,}'         # Two or more vertical bars
)

ALL_DOCS=$(find "$DOCS_ROOT" -name "*.md" -type f)
ASCII_COUNT=0

echo "Scanning for ASCII diagrams..." >&2

while IFS= read -r file; do
    # Skip code blocks and front matter
    CONTENT=$(awk '
        /^```/{flag=!flag;next}
        /^---$/{if(NR<5){fm=!fm;next}}
        !flag && !fm {print}
    ' "$file")

    for pattern in "${ASCII_PATTERNS[@]}"; do
        if echo "$CONTENT" | grep -qE "$pattern"; then
            if [[ $ASCII_COUNT -eq 0 ]]; then
                echo "### Files with ASCII Diagrams" >> "$REPORT_FILE"
                echo "" >> "$REPORT_FILE"
            fi
            echo "- $file" >> "$REPORT_FILE"
            ((ASCII_COUNT++)) || true
            EXIT_CODE=1
            break
        fi
    done
done <<< "$ALL_DOCS"

if [[ $ASCII_COUNT -eq 0 ]]; then
    echo "✓ No ASCII diagrams detected" >> "$REPORT_FILE"
fi

# Summary
echo "" >> "$REPORT_FILE"
echo "### Summary" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "- Files with ASCII diagrams: $ASCII_COUNT" >> "$REPORT_FILE"

cat "$REPORT_FILE"
exit $EXIT_CODE
