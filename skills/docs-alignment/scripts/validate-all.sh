#!/bin/bash
# Master Validation Script - Runs all validators
set -euo pipefail

SCRIPT_DIR="$(dirname "$(realpath "$0")")"
DOCS_ROOT="$(dirname "$SCRIPT_DIR")"
REPORT_DIR="${REPORT_DIR:-/tmp/docs-validation}"

mkdir -p "$REPORT_DIR"

echo "========================================="
echo "Documentation Validation Suite"
echo "========================================="
echo ""

EXIT_CODE=0

# Run all validators
VALIDATORS=(
    "validate-links.sh|Link Validation"
    "validate-frontmatter.sh|Front Matter Validation"
    "validate-mermaid.sh|Mermaid Diagram Validation"
    "detect-ascii.sh|ASCII Diagram Detection"
    "validate-spelling.sh|UK English Spelling"
    "validate-structure.sh|Structure Validation"
)

for validator_info in "${VALIDATORS[@]}"; do
    IFS='|' read -r script name <<< "$validator_info"

    echo "Running: $name..."
    if REPORT_FILE="$REPORT_DIR/${script%.sh}.txt" "$SCRIPT_DIR/$script"; then
        echo "✓ $name passed"
    else
        echo "✗ $name failed"
        EXIT_CODE=1
    fi
    echo ""
done

# Generate combined report
COMBINED_REPORT="$REPORT_DIR/combined-report.md"

cat > "$COMBINED_REPORT" <<EOF
# Documentation Validation Report

**Generated:** $(date)

---

EOF

for validator_info in "${VALIDATORS[@]}"; do
    IFS='|' read -r script name <<< "$validator_info"
    report_file="$REPORT_DIR/${script%.sh}.txt"

    if [[ -f "$report_file" ]]; then
        cat >> "$COMBINED_REPORT" <<EOF

## $name

\`\`\`
$(cat "$report_file")
\`\`\`

---

EOF
    fi
done

echo "========================================="
echo "Validation Complete"
echo "========================================="
echo ""
echo "Combined report: $COMBINED_REPORT"
echo ""

if [[ $EXIT_CODE -eq 0 ]]; then
    echo "✓ All validations passed"
else
    echo "✗ Some validations failed"
fi

exit $EXIT_CODE
