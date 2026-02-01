#!/bin/bash
# Front Matter Validator - Ensures all required fields are present
set -euo pipefail

DOCS_ROOT="${DOCS_ROOT:-$(dirname "$(dirname "$(realpath "$0")")")}"
REPORT_FILE="${REPORT_FILE:-/tmp/frontmatter-validation-report.txt}"
OUTPUT_FORMAT="human"
if [[ "${1:-}" == "--json" ]]; then
    OUTPUT_FORMAT="json"
fi
EXIT_CODE=0

REQUIRED_FIELDS=("title" "description" "category")

echo "=== Front Matter Validation Report ===" > "$REPORT_FILE"
echo "Generated: $(date)" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# Find all markdown files
ALL_DOCS=$(find "$DOCS_ROOT" -name "*.md" -type f)
TOTAL_DOCS=$(echo "$ALL_DOCS" | wc -l)
INVALID_COUNT=0

echo "Validating front matter in $TOTAL_DOCS files..." >&2

while IFS= read -r file; do
    # Skip INDEX.md files
    if [[ "$file" == */INDEX.md ]]; then
        continue
    fi

    # Check if file has front matter
    if ! head -1 "$file" | grep -q "^---$"; then
        echo "**$file:** Missing front matter block" >> "$REPORT_FILE"
        ((INVALID_COUNT++)) || true
        EXIT_CODE=1
        continue
    fi

    # Extract front matter
    FRONTMATTER=$(awk '/^---$/{flag=!flag;next}flag' "$file" | head -n 100)

    # Check required fields
    MISSING_FIELDS=()
    for field in "${REQUIRED_FIELDS[@]}"; do
        if ! echo "$FRONTMATTER" | grep -q "^${field}:"; then
            MISSING_FIELDS+=("$field")
        fi
    done

    if [[ ${#MISSING_FIELDS[@]} -gt 0 ]]; then
        echo "**$file:** Missing fields: ${MISSING_FIELDS[*]}" >> "$REPORT_FILE"
        ((INVALID_COUNT++)) || true
        EXIT_CODE=1
    fi
done <<< "$ALL_DOCS"

# Summary
echo "" >> "$REPORT_FILE"
echo "### Summary" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "- Total documents validated: $TOTAL_DOCS" >> "$REPORT_FILE"
echo "- Documents with issues: $INVALID_COUNT" >> "$REPORT_FILE"

if [[ $INVALID_COUNT -eq 0 ]]; then
    echo "" >> "$REPORT_FILE"
    echo "✓ All documents have valid front matter" >> "$REPORT_FILE"
fi

cat "$REPORT_FILE"
exit $EXIT_CODE
