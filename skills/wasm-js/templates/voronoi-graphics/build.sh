#!/bin/bash
# Build script for WASM Voronoi Graphics module
# Produces optimized WASM binary for web deployment

set -e

echo "🔧 Building Voronoi Graphics WASM module..."

# Check for wasm-pack
if ! command -v wasm-pack &> /dev/null; then
    echo "Installing wasm-pack..."
    cargo install wasm-pack
fi

# Build for web target (ES modules)
echo "📦 Building for web target..."
wasm-pack build --target web --release

# Report sizes
echo ""
echo "📊 Build Results:"
ls -lh pkg/*.wasm 2>/dev/null || echo "No WASM files found"
ls -lh pkg/*.js 2>/dev/null || echo "No JS files found"

# Calculate total size
WASM_SIZE=$(stat -c%s pkg/*.wasm 2>/dev/null | head -1 || echo 0)
echo ""
echo "✅ WASM binary size: $(numfmt --to=iec-i --suffix=B $WASM_SIZE 2>/dev/null || echo "${WASM_SIZE} bytes")"

# Verify TypeScript types were generated
if [ -f "pkg/voronoi_graphics.d.ts" ]; then
    echo "✅ TypeScript definitions generated"
else
    echo "⚠️  No TypeScript definitions found"
fi

echo ""
echo "🚀 Build complete! Files in pkg/ directory:"
ls -la pkg/
