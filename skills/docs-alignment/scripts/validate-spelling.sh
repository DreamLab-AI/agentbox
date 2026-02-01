#!/bin/bash
# validate-spelling.sh - Validate UK English spelling
# Returns: 0 on success, 1 on failure

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCS_DIR="$(dirname "$SCRIPT_DIR")"

OUTPUT_FORMAT="human"
if [[ "${1:-}" == "--json" ]]; then
    OUTPUT_FORMAT="json"
fi

TOTAL_FILES=0
SPELLING_ERRORS=0
ERROR_LIST=()

# Common US vs UK spelling differences to check
declare -A US_TO_UK=(
    ["color"]="colour"
    ["flavor"]="flavour"
    ["behavior"]="behaviour"
    ["center"]="centre"
    ["meter"]="metre"
    ["liter"]="litre"
    ["fiber"]="fibre"
    ["theater"]="theatre"
    ["defense"]="defence"
    ["license"]="licence"
    ["organize"]="organise"
    ["realize"]="realise"
    ["analyze"]="analyse"
    ["paralyze"]="paralyse"
    ["catalog"]="catalogue"
    ["dialog"]="dialogue"
    ["analog"]="analogue"
    ["traveled"]="travelled"
    ["canceled"]="cancelled"
    ["labeled"]="labelled"
)

check_spelling() {
    local file="$1"
    local relative_path="${file#$DOCS_DIR/}"
    ((TOTAL_FILES++))

    # Skip code blocks and inline code
    local content=$(awk '
        BEGIN { in_code = 0; }
        /^```/ { in_code = !in_code; next; }
        !in_code { gsub(/`[^`]+`/, ""); print; }
    ' "$file")

    for us_word in "${!US_TO_UK[@]}"; do
        uk_word="${US_TO_UK[$us_word]}"

        # Use word boundaries to avoid partial matches
        if echo "$content" | grep -qiP "\\b${us_word}\\b"; then
            ((SPELLING_ERRORS++))
            local line_num=$(grep -inP "\\b${us_word}\\b" "$file" | head -n 1 | cut -d: -f1)
            ERROR_LIST+=("$relative_path:$line_num: Use '$uk_word' instead of '$us_word' (UK English)")
        fi
    done
}

# Find all markdown files
while IFS= read -r file; do
    check_spelling "$file"
done < <(find "$DOCS_DIR" -type f -name "*.md")

# Output results
if [[ "$OUTPUT_FORMAT" == "json" ]]; then
    cat <<EOF
{
    "total_files": $TOTAL_FILES,
    "spelling_errors": $SPELLING_ERRORS,
    "errors": $(printf '%s\n' "${ERROR_LIST[@]:-}" | jq -R . | jq -s .)
}
EOF
else
    echo "========================================="
    echo "UK English Spelling Validation Report"
    echo "========================================="
    echo "Total files checked: $TOTAL_FILES"
    echo "Spelling errors found: $SPELLING_ERRORS"
    echo "========================================="

    if [[ $SPELLING_ERRORS -gt 0 ]]; then
        echo "Spelling issues (use UK English):"
        printf '  - %s\n' "${ERROR_LIST[@]}"
    fi
fi

[[ $SPELLING_ERRORS -eq 0 ]]
