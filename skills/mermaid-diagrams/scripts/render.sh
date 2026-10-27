#!/bin/bash
# Mermaid Diagrams — Batch Renderer
# Usage: ./render.sh [input_dir] [output_dir] [theme: dark|light|default]

set -e

INPUT_DIR="${1:-.}"
OUTPUT_DIR="${2:-${INPUT_DIR}}"
THEME="${3:-dark}"
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Select theme config
case "$THEME" in
  dark)   CONFIG="$SKILL_DIR/resources/templates/theme-dark.json"; MERMAID_THEME="dark" ;;
  light)  CONFIG="$SKILL_DIR/resources/templates/theme-light.json"; MERMAID_THEME="default" ;;
  *)      CONFIG=""; MERMAID_THEME="default" ;;
esac

echo "=== Mermaid Batch Renderer ==="
echo "Input:  $INPUT_DIR"
echo "Output: $OUTPUT_DIR"
echo "Theme:  $THEME"
echo ""

COUNT=0
ERRORS=0

for f in "$INPUT_DIR"/*.mmd "$INPUT_DIR"/*.mermaid; do
  [ ! -f "$f" ] && continue
  BASENAME=$(basename "${f%.*}")

  echo -n "  Rendering $BASENAME... "

  ARGS=(-i "$f" -o "$OUTPUT_DIR/${BASENAME}.png" -w 2000 -H 1200 -t "$MERMAID_THEME")
  [ -n "$CONFIG" ] && [ -f "$CONFIG" ] && ARGS+=(-c "$CONFIG")
  [ "$THEME" = "dark" ] && ARGS+=(-b '#0B2545')

  if mmdc "${ARGS[@]}"; then
    SIZE=$(wc -c < "$OUTPUT_DIR/${BASENAME}.png")
    echo "OK (${SIZE} bytes)"
    COUNT=$((COUNT + 1))
  else
    echo "FAILED"
    ERRORS=$((ERRORS + 1))
  fi

  # Also render PDF for LaTeX
  PDF_ARGS=(-i "$f" -o "$OUTPUT_DIR/${BASENAME}.pdf" -w 2000 -H 1200 -t "$MERMAID_THEME")
  [ -n "$CONFIG" ] && [ -f "$CONFIG" ] && PDF_ARGS+=(-c "$CONFIG")
  mmdc "${PDF_ARGS[@]}" >/dev/null || echo "  PDF render failed for $BASENAME" >&2
done

echo ""
echo "Rendered: $COUNT diagrams, $ERRORS errors"
