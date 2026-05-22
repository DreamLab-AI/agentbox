#!/bin/bash
# Compile Beamer presentation with AmurMaple theme
#
# Usage: ./compile-beamer.sh <file.tex> [options]
#
# Options:
#   --clean     Clean auxiliary files before compilation
#   --handout   Generate handout version (no overlays)
#   --notes     Generate version with notes
#   --biber     Run biber for bibliography
#   --xelatex   Use XeLaTeX instead of pdfLaTeX
#   --lualatex  Use LuaLaTeX (required for delaunay option)

set -e

# Configuration
TEXFILE=""
CLEAN=0
HANDOUT=0
NOTES=0
BIBER=0
ENGINE="pdflatex"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --clean)
      CLEAN=1
      shift
      ;;
    --handout)
      HANDOUT=1
      shift
      ;;
    --notes)
      NOTES=1
      shift
      ;;
    --biber)
      BIBER=1
      shift
      ;;
    --xelatex)
      ENGINE="xelatex"
      shift
      ;;
    --lualatex)
      ENGINE="lualatex"
      shift
      ;;
    *.tex)
      TEXFILE="$1"
      shift
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Check if file was provided
if [ -z "$TEXFILE" ]; then
  echo "Usage: $0 <file.tex> [options]"
  echo ""
  echo "Options:"
  echo "  --clean     Clean auxiliary files before compilation"
  echo "  --handout   Generate handout version"
  echo "  --notes     Generate version with notes"
  echo "  --biber     Run biber for bibliography"
  echo "  --xelatex   Use XeLaTeX instead of pdfLaTeX"
  echo "  --lualatex  Use LuaLaTeX (required for delaunay option)"
  exit 1
fi

# Check if file exists
if [ ! -f "$TEXFILE" ]; then
  echo "Error: File '$TEXFILE' not found"
  exit 1
fi

# Get base filename without extension
BASENAME="${TEXFILE%.tex}"

# Set TEXINPUTS to include theme directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
THEME_DIR="$SCRIPT_DIR/../../themes/amurmaple"
export TEXINPUTS=".:$THEME_DIR:$TEXINPUTS"

echo "=== Beamer Compilation ==="
echo "File: $TEXFILE"
echo "Engine: $ENGINE"
echo "Theme directory: $THEME_DIR"
echo ""

# Clean auxiliary files if requested
if [ $CLEAN -eq 1 ]; then
  echo "Cleaning auxiliary files..."
  rm -f "$BASENAME.aux" "$BASENAME.log" "$BASENAME.nav" \
        "$BASENAME.out" "$BASENAME.snm" "$BASENAME.toc" \
        "$BASENAME.vrb" "$BASENAME.bbl" "$BASENAME.blg" \
        "$BASENAME.bcf" "$BASENAME.run.xml"
  echo "Clean complete"
  echo ""
fi

# Prepare compilation options
COMPILE_OPTS=""
if [ $HANDOUT -eq 1 ]; then
  COMPILE_OPTS="$COMPILE_OPTS \\PassOptionsToClass{handout}{beamer}"
  echo "Generating handout version..."
fi

if [ $NOTES -eq 1 ]; then
  COMPILE_OPTS="$COMPILE_OPTS \\setbeameroption{show notes}"
  echo "Including notes..."
fi

# First compilation pass
echo "Running first $ENGINE pass..."
$ENGINE -interaction=nonstopmode "$TEXFILE" > /dev/null 2>&1 || {
  echo "Error: First compilation pass failed"
  echo "Check the log file: $BASENAME.log"
  exit 1
}

# Run biber if requested
if [ $BIBER -eq 1 ]; then
  echo "Running biber..."
  biber "$BASENAME" > /dev/null 2>&1 || {
    echo "Warning: Biber failed (may be expected if no bibliography)"
  }
fi

# Second compilation pass (for TOC and references)
echo "Running second $ENGINE pass..."
$ENGINE -interaction=nonstopmode "$TEXFILE" > /dev/null 2>&1 || {
  echo "Error: Second compilation pass failed"
  echo "Check the log file: $BASENAME.log"
  exit 1
}

# Third compilation pass (to resolve all references)
echo "Running third $ENGINE pass..."
$ENGINE -interaction=nonstopmode "$TEXFILE" > /dev/null 2>&1 || {
  echo "Error: Third compilation pass failed"
  echo "Check the log file: $BASENAME.log"
  exit 1
}

echo ""
echo "=== Compilation Complete ==="
echo "Output: $BASENAME.pdf"
echo ""

# Display file size
if [ -f "$BASENAME.pdf" ]; then
  FILE_SIZE=$(du -h "$BASENAME.pdf" | cut -f1)
  echo "PDF size: $FILE_SIZE"

  # Count pages
  if command -v pdfinfo &> /dev/null; then
    PAGE_COUNT=$(pdfinfo "$BASENAME.pdf" | grep "Pages:" | awk '{print $2}')
    echo "Pages: $PAGE_COUNT"
  fi
fi

echo ""
echo "To view the presentation:"
echo "  evince $BASENAME.pdf        # GNOME"
echo "  okular $BASENAME.pdf        # KDE"
echo "  xdg-open $BASENAME.pdf      # Default viewer"
