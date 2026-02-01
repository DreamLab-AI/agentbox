#!/bin/bash
# Mermaid Diagram Validator - Validates Mermaid syntax
set -euo pipefail

DOCS_ROOT="${DOCS_ROOT:-$(dirname "$(dirname "$(realpath "$0")")")}"
REPORT_FILE="${REPORT_FILE:-/tmp/mermaid-validation-report.txt}"
EXIT_CODE=0

echo "=== Mermaid Diagram Validation Report ===" > "$REPORT_FILE"
echo "Generated: $(date)" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# Find all markdown files with mermaid blocks
ALL_DOCS=$(find "$DOCS_ROOT" -name "*.md" -type f)
TOTAL_DIAGRAMS=0
INVALID_COUNT=0

echo "Scanning for Mermaid diagrams..." >&2

while IFS= read -r file; do
    # Extract mermaid blocks
    awk '/^```mermaid$/,/^```$/' "$file" | grep -v '^```' > /tmp/mermaid_block_$$.txt || true

    if [[ -s /tmp/mermaid_block_$$.txt ]]; then
        ((TOTAL_DIAGRAMS++)) || true

        # Basic syntax validation
        CONTENT=$(cat /tmp/mermaid_block_$$.txt)

        # Check for common diagram types
        if echo "$CONTENT" | grep -qE '^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph)'; then
            # Check for proper syntax patterns
            if ! echo "$CONTENT" | grep -qE '(-->|---|\[|\]|\(|\)|{|}|:)'; then
                echo "**$file:** Possible syntax error in Mermaid diagram" >> "$REPORT_FILE"
                ((INVALID_COUNT++)) || true
                EXIT_CODE=1
            fi
        else
            echo "**$file:** Unknown or invalid Mermaid diagram type" >> "$REPORT_FILE"
            ((INVALID_COUNT++)) || true
            EXIT_CODE=1
        fi
    fi

    rm -f /tmp/mermaid_block_$$.txt
done <<< "$ALL_DOCS"

# Summary
echo "" >> "$REPORT_FILE"
echo "### Summary" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "- Total Mermaid diagrams: $TOTAL_DIAGRAMS" >> "$REPORT_FILE"
echo "- Diagrams with potential issues: $INVALID_COUNT" >> "$REPORT_FILE"

if [[ $INVALID_COUNT -eq 0 ]]; then
    echo "" >> "$REPORT_FILE"
    echo "✓ All Mermaid diagrams appear valid" >> "$REPORT_FILE"
fi

cat "$REPORT_FILE"
exit $EXIT_CODE
