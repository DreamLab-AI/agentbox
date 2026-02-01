#!/bin/bash
# Coverage Validator - Ensures 100% documentation coverage
set -euo pipefail

DOCS_ROOT="${DOCS_ROOT:-$(dirname "$(dirname "$(realpath "$0")")")}"
PROJECT_ROOT="${PROJECT_ROOT:-$(dirname "$DOCS_ROOT")}"
REPORT_FILE="${REPORT_FILE:-/tmp/coverage-validation-report.txt}"
EXIT_CODE=0

echo "=== Documentation Coverage Report ===" > "$REPORT_FILE"
echo "Generated: $(date)" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# Expected documentation categories
REQUIRED_CATEGORIES=(
    "architecture"
    "development"
    "deployment"
    "api"
    "guides"
    "reference"
)

# Check INDEX.md exists
if [[ ! -f "$DOCS_ROOT/INDEX.md" ]]; then
    echo "❌ Missing INDEX.md" >> "$REPORT_FILE"
    EXIT_CODE=1
else
    echo "✓ INDEX.md present" >> "$REPORT_FILE"
fi

# Check category coverage
echo "" >> "$REPORT_FILE"
echo "### Category Coverage" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

for category in "${REQUIRED_CATEGORIES[@]}"; do
    category_dir="$DOCS_ROOT/$category"
    if [[ -d "$category_dir" ]]; then
        doc_count=$(find "$category_dir" -name "*.md" -type f | wc -l)
        echo "✓ $category: $doc_count documents" >> "$REPORT_FILE"
    else
        echo "❌ Missing category: $category" >> "$REPORT_FILE"
        EXIT_CODE=1
    fi
done

# Check for undocumented features
echo "" >> "$REPORT_FILE"
echo "### Feature Coverage Analysis" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# Check if major components are documented
MAJOR_COMPONENTS=(
    "multi-agent-docker"
    "claude-flow"
    "cuda"
    "comfyui"
)

for component in "${MAJOR_COMPONENTS[@]}"; do
    if grep -rq "$component" "$DOCS_ROOT"/*.md 2>/dev/null; then
        echo "✓ $component documented" >> "$REPORT_FILE"
    else
        echo "⚠ $component may need documentation" >> "$REPORT_FILE"
    fi
done

# Summary statistics
TOTAL_DOCS=$(find "$DOCS_ROOT" -name "*.md" -type f | wc -l)
TOTAL_WORDS=$(find "$DOCS_ROOT" -name "*.md" -type f -exec wc -w {} + | tail -1 | awk '{print $1}')
TOTAL_DIAGRAMS=$(find "$DOCS_ROOT" -name "*.md" -type f -exec grep -c '^```mermaid' {} + | awk '{sum+=$1}END{print sum}')

echo "" >> "$REPORT_FILE"
echo "### Statistics" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "- Total documents: $TOTAL_DOCS" >> "$REPORT_FILE"
echo "- Total words: $TOTAL_WORDS" >> "$REPORT_FILE"
echo "- Total diagrams: $TOTAL_DIAGRAMS" >> "$REPORT_FILE"
echo "- Average words per doc: $((TOTAL_WORDS / TOTAL_DOCS))" >> "$REPORT_FILE"

cat "$REPORT_FILE"
exit $EXIT_CODE
