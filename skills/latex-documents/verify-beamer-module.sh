#!/bin/bash
# Verification script for Beamer module installation

echo "=== Beamer Module Verification ==="
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

check_file() {
  if [ -f "$1" ]; then
    echo -e "${GREEN}✓${NC} $1"
    return 0
  else
    echo -e "${RED}✗${NC} $1 (missing)"
    return 1
  fi
}

check_dir() {
  if [ -d "$1" ]; then
    echo -e "${GREEN}✓${NC} $1/"
    return 0
  else
    echo -e "${RED}✗${NC} $1/ (missing)"
    return 1
  fi
}

ERRORS=0

echo "Checking directory structure..."
check_dir "templates/beamer" || ((ERRORS++))
check_dir "examples/beamer" || ((ERRORS++))
check_dir "themes/amurmaple" || ((ERRORS++))
check_dir "themes/amurmaple/img" || ((ERRORS++))
echo ""

echo "Checking theme files..."
check_file "themes/amurmaple/beamerthemeAmurmaple.sty" || ((ERRORS++))
echo ""

echo "Checking templates..."
check_file "templates/beamer/amurmaple-basic.tex" || ((ERRORS++))
check_file "templates/beamer/amurmaple-academic.tex" || ((ERRORS++))
check_file "templates/beamer/amurmaple-technical.tex" || ((ERRORS++))
echo ""

echo "Checking examples..."
check_file "examples/beamer/demo-presentation.tex" || ((ERRORS++))
check_file "examples/beamer/references.bib" || ((ERRORS++))
check_file "examples/beamer/compile-beamer.sh" || ((ERRORS++))
echo ""

echo "Checking documentation..."
check_file "SKILL.md" || ((ERRORS++))
check_file "BEAMER-QUICK-REFERENCE.md" || ((ERRORS++))
check_file "BEAMER-MODULE-SUMMARY.md" || ((ERRORS++))
check_file "examples/beamer/README.md" || ((ERRORS++))
check_file "examples/beamer/USAGE-EXAMPLES.md" || ((ERRORS++))
echo ""

echo "Checking file permissions..."
if [ -x "examples/beamer/compile-beamer.sh" ]; then
  echo -e "${GREEN}✓${NC} compile-beamer.sh is executable"
else
  echo -e "${RED}✗${NC} compile-beamer.sh is not executable"
  ((ERRORS++))
fi
echo ""

echo "Checking file sizes..."
SKILL_SIZE=$(wc -l < SKILL.md)
if [ "$SKILL_SIZE" -gt 800 ]; then
  echo -e "${GREEN}✓${NC} SKILL.md has comprehensive content ($SKILL_SIZE lines)"
else
  echo -e "${RED}✗${NC} SKILL.md may be incomplete ($SKILL_SIZE lines)"
  ((ERRORS++))
fi
echo ""

echo "=== Summary ==="
if [ $ERRORS -eq 0 ]; then
  echo -e "${GREEN}All checks passed! Beamer module is complete.${NC}"
  echo ""
  echo "Quick start:"
  echo "  cd examples/beamer"
  echo "  ./compile-beamer.sh demo-presentation.tex"
  exit 0
else
  echo -e "${RED}Found $ERRORS error(s). Please review the installation.${NC}"
  exit 1
fi
