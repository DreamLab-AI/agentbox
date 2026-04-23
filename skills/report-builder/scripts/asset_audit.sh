#!/bin/bash
# Report Builder — Asset Audit
# Checks that every \includegraphics reference has a corresponding file
# and every generated figure is referenced in at LaTeX.

set -e
REPORT_DIR="${1:-.}"
cd "$REPORT_DIR"

echo "=== Report Builder: Asset Audit ==="
echo ""

ERRORS=0

# Check: every \includegraphics points to an existing file
echo "Checking: All referenced figures exist..."
grep -rh 'includegraphics' chapters/*.tex 2>/dev/null | sed 's/.*{\(.*\)}/\1/' | sort -u | while read ref; do
  if [ ! -f "$ref" ]; then
    echo "  BROKEN REF: $ref (file not found)"
    ERRORS=$((ERRORS + 1))
  fi
done

# Check: every generated figure is referenced
echo "Checking: All generated figures are referenced..."
for f in figures/*.pdf diagrams/infographics/*_v3.png diagrams/infographics/*_v3.jpg 2>/dev/null; do
  [ ! -f "$f" ] && continue
  if ! grep -rq "$f" chapters/*.tex main.tex 2>/dev/null; then
    echo "  UNUSED: $f"
    ERRORS=$((ERRORS + 1))
  fi
done

echo ""
if [ "$ERRORS" -eq 0 ]; then
  REFS=$(grep -rh 'includegraphics' chapters/*.tex 2>/dev/null | wc -l)
  echo "PASS: $REFS figure references, all resolved, zero unused assets."
else
  echo "FAIL: $ERRORS issues found."
fi
