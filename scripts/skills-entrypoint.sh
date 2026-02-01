#!/bin/bash
# Agentbox Skills Entrypoint Script
# Initializes RuVector standalone vector database (NO PostgreSQL required)
#
# RuVector is a Rust-native vector database with:
# - Embedded redb storage (no external DB needed)
# - HNSW indexing for 150x-12,500x faster similarity search
# - GNN layers for graph neural network operations
# - Self-learning capabilities
# - MCP integration for Claude Code/Flow

set -e

echo "=== Agentbox Skills Initialization ==="
echo "Architecture: $(uname -m)"
echo "Date: $(date -Iseconds)"

# ============================================================================
# Configuration
# ============================================================================

export RUVECTOR_DATA_DIR="${RUVECTOR_DATA_DIR:-/var/lib/ruvector}"
export RUVECTOR_PORT="${RUVECTOR_PORT:-9700}"
export RUVECTOR_LOG_LEVEL="${RUVECTOR_LOG_LEVEL:-info}"

# ============================================================================
# Phase 1: Data Directory Setup
# ============================================================================

echo "[1/3] Setting up RuVector data directory..."

# Create data directory with proper permissions
if [ ! -d "$RUVECTOR_DATA_DIR" ]; then
    echo "  Creating $RUVECTOR_DATA_DIR..."
    mkdir -p "$RUVECTOR_DATA_DIR"
fi

# Set ownership to devuser (RuVector runs as devuser)
chown -R devuser:devuser "$RUVECTOR_DATA_DIR" 2>/dev/null || true
chmod 755 "$RUVECTOR_DATA_DIR"

echo "  Data directory: $RUVECTOR_DATA_DIR"

# ============================================================================
# Phase 2: Install RuVector npm package (if not present)
# ============================================================================

echo "[2/3] Checking RuVector installation..."

# Check if ruvector is available via npm
if command -v npx &> /dev/null; then
    # Check if package is cached
    if npx --yes ruvector --version &>/dev/null 2>&1; then
        echo "  RuVector npm package available"
    else
        echo "  Installing ruvector npm package..."
        npm install -g ruvector 2>/dev/null || true
    fi
else
    echo "  Warning: npx not available, RuVector must be started manually"
fi

# ============================================================================
# Phase 3: Export Environment and Verify
# ============================================================================

echo "[3/3] Exporting RuVector configuration..."

# Export connection info for skills
cat > /tmp/ruvector-env.sh << ENVFILE
# RuVector Environment (source this file)
# Standalone vector database - NO PostgreSQL required
export RUVECTOR_DATA_DIR="$RUVECTOR_DATA_DIR"
export RUVECTOR_PORT="$RUVECTOR_PORT"
export RUVECTOR_LOG_LEVEL="$RUVECTOR_LOG_LEVEL"
export RUVECTOR_API_URL="http://localhost:$RUVECTOR_PORT"

# Legacy compatibility (for apps expecting DATABASE_URL)
# RuVector doesn't need this, but some apps check for it
export RUVECTOR_BACKEND="redb"
ENVFILE

# Copy to standard locations if writable
cp /tmp/ruvector-env.sh /etc/profile.d/ruvector.sh 2>/dev/null || true
cp /tmp/ruvector-env.sh /home/devuser/.ruvector-env 2>/dev/null && \
    chown devuser:devuser /home/devuser/.ruvector-env 2>/dev/null || true

echo ""
echo "=== RuVector Initialization Complete ==="
echo ""
echo "Configuration:"
echo "  Data directory: $RUVECTOR_DATA_DIR"
echo "  API port:       $RUVECTOR_PORT"
echo "  Backend:        redb (embedded)"
echo ""
echo "To start RuVector manually:"
echo "  npx ruvector serve --port $RUVECTOR_PORT --data-dir $RUVECTOR_DATA_DIR"
echo ""
echo "To start RuVector MCP server:"
echo "  npx ruvector mcp --port 9701"
echo ""
echo "Environment exported to:"
echo "  /etc/profile.d/ruvector.sh"
echo "  /home/devuser/.ruvector-env"
echo ""
