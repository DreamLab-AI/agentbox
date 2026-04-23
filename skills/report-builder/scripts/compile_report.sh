#!/bin/bash
# Report Builder — Full LaTeX Compilation Pipeline
# Usage: ./compile_report.sh [report_dir]

set -e

REPORT_DIR="${1:-.}"
cd "$REPORT_DIR"

echo "=== Report Builder: Full Compilation Pipeline ==="
echo "Directory: $(pwd)"
echo ""

# Clean previous build artifacts
echo "[1/6] Cleaning build artifacts..."
rm -f main.{aux,bbl,bcf,blg,run.xml,toc,lof,lot,idx,ind,ilg,ist,acn,acr,alg,glo,gls,glg,out,log}

# Pass 1: Initial compilation
echo "[2/6] LaTeX Pass 1..."
pdflatex -interaction=nonstopmode main.tex > /dev/null 2>&1 || true

# Biber: Process bibliography
echo "[3/6] Biber (bibliography)..."
biber main > /dev/null 2>&1 || echo "  WARNING: biber had issues"

# Glossaries and Index
echo "[4/6] Glossaries and Index..."
makeglossaries main > /dev/null 2>&1 || echo "  WARNING: makeglossaries had issues"
makeindex main > /dev/null 2>&1 || echo "  WARNING: makeindex had issues"

# Pass 2 and 3: Resolve references
echo "[5/6] LaTeX Pass 2..."
pdflatex -interaction=nonstopmode main.tex > /dev/null 2>&1 || true
echo "[6/6] LaTeX Pass 3..."
pdflatex -interaction=nonstopmode main.tex 2>&1 | grep "Output written on" || echo "  WARNING: no output line found"

# Verification
echo ""
echo "=== Build Results ==="
if [ -f main.pdf ]; then
    SIZE=$(ls -la main.pdf | awk '{print $5}')
    ERRORS=$(grep -c '^!' main.log 2>/dev/null || echo 0)
    WARNINGS=$(grep -c 'Warning' main.log 2>/dev/null || echo 0)
    UNDEF_CITE=$(grep -c 'Citation.*undefined' main.log 2>/dev/null || echo 0)

    echo "  PDF: main.pdf (${SIZE} bytes)"
    echo "  Errors: ${ERRORS}"
    echo "  Warnings: ${WARNINGS}"
    echo "  Undefined citations: ${UNDEF_CITE}"

    # PyMuPDF page count if available
    PYTHONPATH="" python3 -c "
import fitz
doc = fitz.open('main.pdf')
print(f'  Pages: {len(doc)}')
doc.close()
" 2>/dev/null || echo "  Pages: (install pymupdf to count)"

    if [ "$ERRORS" -eq 0 ]; then
        echo "  Status: SUCCESS"
    else
        echo "  Status: COMPILED WITH ERRORS"
    fi
else
    echo "  Status: FAILED — no PDF produced"
    echo "  Check main.log for details"
    exit 1
fi
