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
  dark)   CONFIG="$SKILL_DIR/resources/templates/theme-dark.json" ;;
  light)  CONFIG="$SKILL_DIR/resources/templates/theme-light.json" ;;
  *)      CONFIG="" ;;
esac

# Puppeteer config for headless environments
PUPPETEER_CONF="$SKILL_DIR/resources/templates/puppeteer.json"

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

  ARGS=(-i "$f" -o "$OUTPUT_DIR/${BASENAME}.png" -w 2000 -H 1200)
  [ -n "$CONFIG" ] && [ -f "$CONFIG" ] && ARGS+=(-C "$CONFIG")
  [ "$THEME" = "dark" ] && ARGS+=(-b '#0B2545')
  [ -f "$PUPPETEER_CONF" ] && ARGS+=(-p "$PUPPETEER_CONF")

  if mmdc "${ARGS[@]}" 2>/dev/null; then
    SIZE=$(ls -la "$OUTPUT_DIR/${BASENAME}.png" | awk '{print $5}')
    echo "OK (${SIZE} bytes)"
    COUNT=$((COUNT + 1))
  else
    echo "FAILED"
    ERRORS=$((ERRORS + 1))
  fi

  # Also render PDF for LaTeX
  mmdc -i "$f" -o "$OUTPUT_DIR/${BASENAME}.pdf" -w 2000 ${CONFIG:+-C "$CONFIG"} 2>/dev/null || true
done

echo ""
echo "Rendered: $COUNT diagrams, $ERRORS errors"
