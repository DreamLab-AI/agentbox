#!/bin/bash
# Report Generator - Creates statistics and metrics
set -euo pipefail

DOCS_ROOT="${DOCS_ROOT:-$(dirname "$(dirname "$(realpath "$0")")")}"
REPORT_FILE="${REPORT_FILE:-$DOCS_ROOT/DOCUMENTATION_METRICS.md}"

cat > "$REPORT_FILE" <<EOF
# Documentation Metrics Report

**Generated:** $(date)
**Version:** 2.0.0

---

## Overview Statistics

EOF

# Count documents by category
echo "### Documents by Category" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

for category_dir in "$DOCS_ROOT"/*/; do
    if [[ -d "$category_dir" ]]; then
        category=$(basename "$category_dir")
        doc_count=$(find "$category_dir" -name "*.md" -type f | wc -l)
        word_count=$(find "$category_dir" -name "*.md" -type f -exec wc -w {} + 2>/dev/null | tail -1 | awk '{print $1}')

        echo "- **$category**: $doc_count documents ($word_count words)" >> "$REPORT_FILE"
    fi
done

# Total statistics
TOTAL_DOCS=$(find "$DOCS_ROOT" -name "*.md" -type f | wc -l)
TOTAL_WORDS=$(find "$DOCS_ROOT" -name "*.md" -type f -exec wc -w {} + | tail -1 | awk '{print $1}')
TOTAL_DIAGRAMS=$(find "$DOCS_ROOT" -name "*.md" -type f -exec grep -c '^```mermaid' {} + 2>/dev/null | awk '{sum+=$1}END{print sum}')
TOTAL_CODE_BLOCKS=$(find "$DOCS_ROOT" -name "*.md" -type f -exec grep -c '^```' {} + 2>/dev/null | awk '{sum+=$1}END{print sum/2}')

cat >> "$REPORT_FILE" <<EOF

### Totals

- **Total Documents:** $TOTAL_DOCS
- **Total Words:** $TOTAL_WORDS
- **Total Diagrams:** $TOTAL_DIAGRAMS
- **Total Code Blocks:** $TOTAL_CODE_BLOCKS
- **Average Words per Document:** $((TOTAL_WORDS / TOTAL_DOCS))

---

## Content Analysis

### Documentation Health

EOF

# Check for recent updates
RECENT_COUNT=$(find "$DOCS_ROOT" -name "*.md" -type f -mtime -30 | wc -l)
OLD_COUNT=$(find "$DOCS_ROOT" -name "*.md" -type f -mtime +180 | wc -l)

cat >> "$REPORT_FILE" <<EOF
- Documents updated in last 30 days: $RECENT_COUNT
- Documents older than 180 days: $OLD_COUNT
- Update frequency: $((RECENT_COUNT * 100 / TOTAL_DOCS))% recent

### Link Density

EOF

# Calculate link density
TOTAL_LINKS=$(find "$DOCS_ROOT" -name "*.md" -type f -exec grep -o '\[.*\](.*\.md)' {} + 2>/dev/null | wc -l)
AVG_LINKS=$((TOTAL_LINKS / TOTAL_DOCS))

cat >> "$REPORT_FILE" <<EOF
- Total internal links: $TOTAL_LINKS
- Average links per document: $AVG_LINKS
- Link density: $(echo "scale=2; $TOTAL_LINKS / $TOTAL_WORDS * 1000" | bc) links per 1000 words

### Tag Distribution

EOF

# Extract and count tags
find "$DOCS_ROOT" -name "*.md" -type f -exec grep "^tags:" {} + 2>/dev/null | \
    sed 's/tags://g' | tr ',' '\n' | sed 's/[][]//g' | sed 's/^[[:space:]]*//g' | \
    sort | uniq -c | sort -rn | head -10 | \
    awk '{printf "- **%s**: %d documents\n", $2, $1}' >> "$REPORT_FILE"

cat >> "$REPORT_FILE" <<EOF

---

## Quality Metrics

### Documentation Completeness

EOF

# Check front matter completeness
DOCS_WITH_FRONTMATTER=$(find "$DOCS_ROOT" -name "*.md" -type f -exec head -1 {} \; | grep -c '^---$' || true)
COMPLETENESS=$((DOCS_WITH_FRONTMATTER * 100 / TOTAL_DOCS))

cat >> "$REPORT_FILE" <<EOF
- Documents with front matter: $DOCS_WITH_FRONTMATTER / $TOTAL_DOCS ($COMPLETENESS%)
- Mermaid diagram adoption: $TOTAL_DIAGRAMS diagrams across $TOTAL_DOCS docs
- Code example coverage: $TOTAL_CODE_BLOCKS code blocks

### Readability Metrics

EOF

# Calculate average document size
AVG_DOC_SIZE=$((TOTAL_WORDS / TOTAL_DOCS))
LARGE_DOCS=$(find "$DOCS_ROOT" -name "*.md" -type f -exec wc -w {} + | awk '$1 > 3000 {count++} END {print count+0}')

cat >> "$REPORT_FILE" <<EOF
- Average document size: $AVG_DOC_SIZE words
- Documents over 3000 words: $LARGE_DOCS (may need splitting)
- Optimal size range (500-2000 words): $((TOTAL_DOCS - LARGE_DOCS)) documents

---

## Recommendations

EOF

# Generate recommendations
if [[ $OLD_COUNT -gt $((TOTAL_DOCS / 4)) ]]; then
    echo "- ⚠ Consider reviewing and updating older documents" >> "$REPORT_FILE"
fi

if [[ $AVG_LINKS -lt 3 ]]; then
    echo "- ⚠ Low link density - consider adding more cross-references" >> "$REPORT_FILE"
fi

if [[ $COMPLETENESS -lt 90 ]]; then
    echo "- ⚠ Add front matter to remaining documents" >> "$REPORT_FILE"
fi

if [[ $LARGE_DOCS -gt 5 ]]; then
    echo "- ⚠ Consider splitting large documents for better readability" >> "$REPORT_FILE"
fi

cat >> "$REPORT_FILE" <<EOF

---

*This report is automatically generated. Run \`./scripts/generate-reports.sh\` to update.*
EOF

echo "Report generated: $REPORT_FILE"
cat "$REPORT_FILE"
