#!/bin/bash
# validate-structure.sh - Validate Diataxis structure and naming conventions
# Returns: 0 on success, 1 on failure

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCS_DIR="$(dirname "$SCRIPT_DIR")"

OUTPUT_FORMAT="human"
if [[ "${1:-}" == "--json" ]]; then
    OUTPUT_FORMAT="json"
fi

TOTAL_FILES=0
STRUCTURE_ERRORS=0
ERROR_LIST=()

# Diataxis categories
VALID_CATEGORIES=("tutorial" "how-to" "reference" "explanation")

validate_structure() {
    local file="$1"
    local relative_path="${file#$DOCS_DIR/}"
    ((TOTAL_FILES++))

    # Skip non-documentation files
    [[ "$relative_path" =~ ^(scripts|templates)/ ]] && return 0

    # Check filename convention (lowercase with hyphens)
    local filename=$(basename "$file")
    if [[ ! "$filename" =~ ^[a-z0-9-]+\.md$ ]]; then
        ((STRUCTURE_ERRORS++))
        ERROR_LIST+=("$relative_path: Filename should be lowercase with hyphens (kebab-case)")
    fi

    # Extract category from frontmatter
    local category=$(awk '/^---$/,/^---$/ {print}' "$file" | grep "^category:" | awk '{print $2}' | tr -d '"' | tr -d "'")

    if [[ -n "$category" ]]; then
        local valid=0
        for valid_cat in "${VALID_CATEGORIES[@]}"; do
            if [[ "$category" == "$valid_cat" ]]; then
                valid=1
                break
            fi
        done

        if [[ $valid -eq 0 ]]; then
            ((STRUCTURE_ERRORS++))
            ERROR_LIST+=("$relative_path: Invalid category '$category' (must be: ${VALID_CATEGORIES[*]})")
        fi
    fi

    # Check for proper heading hierarchy
    local prev_level=0
    local line_num=0
    while IFS= read -r line; do
        ((line_num++))
        if [[ "$line" =~ ^(#{1,6})[[:space:]] ]]; then
            local level=${#BASH_REMATCH[1]}

            if [[ $prev_level -gt 0 ]] && [[ $((level - prev_level)) -gt 1 ]]; then
                ((STRUCTURE_ERRORS++))
                ERROR_LIST+=("$relative_path:$line_num: Heading hierarchy skip (h$prev_level to h$level)")
            fi
            prev_level=$level
        fi
    done < "$file"
}

# Find all markdown files
while IFS= read -r file; do
    validate_structure "$file"
done < <(find "$DOCS_DIR" -type f -name "*.md")

# Output results
if [[ "$OUTPUT_FORMAT" == "json" ]]; then
    cat <<EOF
{
    "total_files": $TOTAL_FILES,
    "structure_errors": $STRUCTURE_ERRORS,
    "errors": $(printf '%s\n' "${ERROR_LIST[@]:-}" | jq -R . | jq -s .)
}
EOF
else
    echo "========================================="
    echo "Structure Validation Report"
    echo "========================================="
    echo "Total files checked: $TOTAL_FILES"
    echo "Structure errors: $STRUCTURE_ERRORS"
    echo "========================================="

    if [[ $STRUCTURE_ERRORS -gt 0 ]]; then
        echo "Structure issues:"
        printf '  - %s\n' "${ERROR_LIST[@]}"
    fi
fi

[[ $STRUCTURE_ERRORS -eq 0 ]]
