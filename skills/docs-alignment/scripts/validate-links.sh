#!/bin/bash
# Link Validator - Finds broken links and orphaned documents
set -euo pipefail

DOCS_ROOT="${DOCS_ROOT:-$(dirname "$(dirname "$(realpath "$0")")")}"
REPORT_FILE="${REPORT_FILE:-/tmp/link-validation-report.txt}"
OUTPUT_FORMAT="human"
if [[ "${1:-}" == "--json" ]]; then
    OUTPUT_FORMAT="json"
fi
EXIT_CODE=0

echo "=== Link Validation Report ===" > "$REPORT_FILE"
echo "Generated: $(date)" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# Find all markdown files
ALL_DOCS=$(find "$DOCS_ROOT" -name "*.md" -type f)
TOTAL_DOCS=$(echo "$ALL_DOCS" | wc -l)

# Track all internal links
declare -A ALL_LINKS
declare -A REFERENCED_FILES
declare -A BROKEN_LINKS

echo "Scanning $TOTAL_DOCS markdown files..." >&2

# Extract all internal links
while IFS= read -r file; do
    # Find markdown links: [text](path)
    grep -oP '\[([^\]]+)\]\((?!http|#)([^)]+)\)' "$file" | while IFS= read -r link; do
        link_path=$(echo "$link" | sed -E 's/\[([^\]]+)\]\(([^)]+)\)/\2/')

        # Resolve relative paths
        file_dir=$(dirname "$file")
        resolved_path=$(realpath -m "$file_dir/$link_path")

        # Track link
        ALL_LINKS["$file|$link_path"]="$resolved_path"
        REFERENCED_FILES["$resolved_path"]=1

        # Check if target exists
        if [[ ! -f "$resolved_path" && ! -d "$resolved_path" ]]; then
            BROKEN_LINKS["$file"]="${BROKEN_LINKS[$file]:-}$link_path\n"
            EXIT_CODE=1
        fi
    done || true
done <<< "$ALL_DOCS"

# Find orphaned files (no incoming links)
echo "" >> "$REPORT_FILE"
echo "### Orphaned Documents (no incoming links)" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

ORPHAN_COUNT=0
while IFS= read -r file; do
    # Skip INDEX.md and files in root
    if [[ "$file" == */INDEX.md ]] || [[ "$file" == "$DOCS_ROOT"/*.md ]]; then
        continue
    fi

    if [[ ! -v REFERENCED_FILES["$file"] ]]; then
        echo "- $file" >> "$REPORT_FILE"
        ((ORPHAN_COUNT++)) || true
        EXIT_CODE=1
    fi
done <<< "$ALL_DOCS"

if [[ $ORPHAN_COUNT -eq 0 ]]; then
    echo "✓ No orphaned documents found" >> "$REPORT_FILE"
fi

# Report broken links
echo "" >> "$REPORT_FILE"
echo "### Broken Links" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

if [[ ${#BROKEN_LINKS[@]} -eq 0 ]]; then
    echo "✓ No broken links found" >> "$REPORT_FILE"
else
    for file in "${!BROKEN_LINKS[@]}"; do
        echo "**$file:**" >> "$REPORT_FILE"
        echo -e "${BROKEN_LINKS[$file]}" | while read -r link; do
            [[ -n "$link" ]] && echo "  - $link" >> "$REPORT_FILE"
        done
        echo "" >> "$REPORT_FILE"
    done
fi

# Summary
echo "" >> "$REPORT_FILE"
echo "### Summary" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "- Total documents: $TOTAL_DOCS" >> "$REPORT_FILE"
echo "- Orphaned documents: $ORPHAN_COUNT" >> "$REPORT_FILE"
echo "- Files with broken links: ${#BROKEN_LINKS[@]}" >> "$REPORT_FILE"

cat "$REPORT_FILE"
exit $EXIT_CODE
