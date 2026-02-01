#!/bin/bash
# Unified Container Entrypoint - Enhanced Edition
# Handles multi-user setup, credential distribution, service initialization, and CLAUDE.md enhancement

set -e

echo "========================================"
echo "  TURBO FLOW UNIFIED CONTAINER"
echo "========================================"
echo ""

# ============================================================================
# Phase 1: Directory Setup & Docker Socket Configuration
# ============================================================================

echo "[1/10] Setting up directories and Docker socket..."

# Ensure all required directories exist
mkdir -p /home/devuser/{workspace,models,agents,.claude/skills,.config,.cache,logs,.local/share,.ssh}
mkdir -p /home/gemini-user/{workspace,.config,.cache,.gemini-flow}
mkdir -p /home/openai-user/{workspace,.config,.cache}
mkdir -p /home/zai-user/{workspace,.config,.cache}
mkdir -p /home/deepseek-user/{workspace,.config/deepseek,.cache}

# Set SSH directory permissions (required for SSH to work)
chmod 700 /home/devuser/.ssh
chown devuser:devuser /home/devuser/.ssh
mkdir -p /var/log /var/log/supervisor /run/dbus /run/user/1000 /tmp/.X11-unix /tmp/.ICE-unix
chmod 1777 /tmp/.X11-unix /tmp/.ICE-unix
chmod 700 /run/user/1000
chown devuser:devuser /run/user/1000

# Set permissions (skip read-only mounts like .ssh and .claude)
# Only chown known writable directories, skip .ssh and .claude which may be read-only mounts
set +e
chown -R devuser:devuser /home/devuser/workspace 2>/dev/null
chown -R devuser:devuser /home/devuser/models 2>/dev/null
chown -R devuser:devuser /home/devuser/agents 2>/dev/null
chown -R devuser:devuser /home/devuser/logs 2>/dev/null
chown -R devuser:devuser /home/devuser/.config 2>/dev/null
chown -R devuser:devuser /home/devuser/.cache 2>/dev/null
chown -R devuser:devuser /home/devuser/.local 2>/dev/null
chown -R gemini-user:gemini-user /home/gemini-user 2>/dev/null
chown -R openai-user:openai-user /home/openai-user 2>/dev/null
chown -R zai-user:zai-user /home/zai-user 2>/dev/null
chown -R deepseek-user:deepseek-user /home/deepseek-user 2>/dev/null
set -e

# Configure Docker socket permissions for docker-manager skill
if [ -S /var/run/docker.sock ]; then
    chmod 666 /var/run/docker.sock
    echo "✓ Docker socket permissions configured for docker-manager skill"
else
    echo "ℹ️  Docker socket not found (this is normal if not mounting host socket)"
fi

echo "✓ Directories created and permissions set"

# Detect host gateway IP for HTTPS bridge proxy
if [ -z "$HOST_GATEWAY_IP" ]; then
    HOST_GATEWAY_IP=$(ip route | grep default | awk '{print $3}' 2>/dev/null || echo "192.168.0.51")
fi
export HOST_GATEWAY_IP
echo "✓ Host gateway IP detected: $HOST_GATEWAY_IP"

# ============================================================================
# Phase 2: Credential Distribution from Environment
# ============================================================================

echo "[2/10] Distributing credentials to users..."

# devuser - Claude Code configuration
if [ -n "$ANTHROPIC_API_KEY" ]; then
    sudo -u devuser bash -c "mkdir -p ~/.config/claude && cat > ~/.config/claude/config.json" <<EOF
{
  "apiKey": "$ANTHROPIC_API_KEY",
  "defaultModel": "claude-sonnet-4"
}
EOF
    echo "✓ Claude API key configured for devuser"
fi

# devuser - Z.AI API key for web-summary skill
if [ -n "$ZAI_API_KEY" ]; then
    sudo -u devuser bash -c "mkdir -p ~/.config/zai && cat > ~/.config/zai/api.json" <<EOF
{
  "apiKey": "$ZAI_API_KEY"
}
EOF
    echo "✓ Z.AI API key configured for devuser (web-summary skill)"
fi

# gemini-user - Google Gemini configuration
if [ -n "$GOOGLE_GEMINI_API_KEY" ]; then
    sudo -u gemini-user bash -c "mkdir -p ~/.config/gemini && cat > ~/.config/gemini/config.json" <<EOF
{
  "apiKey": "$GOOGLE_GEMINI_API_KEY",
  "defaultModel": "gemini-2.0-flash"
}
EOF
    export GOOGLE_API_KEY="$GOOGLE_GEMINI_API_KEY"
    echo "✓ Gemini API key configured for gemini-user"
fi

# openai-user - OpenAI configuration
if [ -n "$OPENAI_API_KEY" ]; then
    sudo -u openai-user bash -c "mkdir -p ~/.config/openai && cat > ~/.config/openai/config.json" <<EOF
{
  "apiKey": "$OPENAI_API_KEY",
  "organization": "$OPENAI_ORG_ID"
}
EOF
    echo "✓ OpenAI API key configured for openai-user"
fi

# zai-user - Z.AI service configuration
if [ -n "$ANTHROPIC_API_KEY" ] && [ -n "$ANTHROPIC_BASE_URL" ]; then
    sudo -u zai-user bash -c "mkdir -p ~/.config/zai && cat > ~/.config/zai/config.json" <<EOF
{
  "apiKey": "$ANTHROPIC_API_KEY",
  "baseUrl": "$ANTHROPIC_BASE_URL",
  "port": 9600,
  "workerPoolSize": ${CLAUDE_WORKER_POOL_SIZE:-4},
  "maxQueueSize": ${CLAUDE_MAX_QUEUE_SIZE:-50}
}
EOF
    # Also create api.json for backwards compatibility
    sudo -u zai-user bash -c "cat > ~/.config/zai/api.json" <<EOF
{
  "apiKey": "$ANTHROPIC_API_KEY"
}
EOF
    echo "✓ Z.AI configuration created for zai-user"
fi

# deepseek-user - DeepSeek reasoning API configuration
if [ -n "$DEEPSEEK_API_KEY" ]; then
    sudo -u deepseek-user bash -c "mkdir -p ~/.config/deepseek && cat > ~/.config/deepseek/config.json" <<EOF
{
  "apiKey": "$DEEPSEEK_API_KEY",
  "baseUrl": "${DEEPSEEK_BASE_URL:-https://api.deepseek.com}",
  "maxTokens": 4096,
  "model": "deepseek-reasoner"
}
EOF
    chmod 600 /home/deepseek-user/.config/deepseek/config.json
    chown deepseek-user:deepseek-user /home/deepseek-user/.config/deepseek/config.json
    echo "✓ DeepSeek credentials configured for deepseek-user"
fi

# GitHub token for all users
if [ -n "$GITHUB_TOKEN" ]; then
    for user in devuser gemini-user openai-user; do
        sudo -u $user bash -c "mkdir -p ~/.config/gh && cat > ~/.config/gh/config.yml" <<EOF
git_protocol: https
editor: vim
prompt: enabled
pager:
oauth_token: $GITHUB_TOKEN
EOF
    done
    echo "✓ GitHub token configured for all users"
fi

# ============================================================================
# Phase 3: GPU Verification
# ============================================================================

echo "[3/10] Verifying GPU access..."

# nvidia-container-toolkit injects host driver at runtime
# Check if driver was properly injected
if [ -f /proc/driver/nvidia/version ]; then
    HOST_DRIVER_VERSION=$(grep -oP 'Module\s+\K[0-9.]+' /proc/driver/nvidia/version | head -1)
    echo "✓ Host NVIDIA driver detected: $HOST_DRIVER_VERSION"
else
    echo "⚠️  NVIDIA driver not detected in /proc - check nvidia-container-toolkit"
fi

# Check nvidia-smi (injected by nvidia-container-toolkit from host)
if command -v nvidia-smi &> /dev/null; then
    if nvidia-smi &> /dev/null; then
        GPU_COUNT=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | wc -l)
        DRIVER_VER=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1)
        echo "✓ nvidia-smi working (driver: $DRIVER_VER) - $GPU_COUNT GPU(s) detected"
        nvidia-smi --query-gpu=index,name,memory.total --format=csv,noheader | \
            awk -F', ' '{printf "  GPU %s: %s (%s)\n", $1, $2, $3}'
    else
        echo "⚠️  nvidia-smi failed - check container runtime configuration"
        echo "   Ensure docker-compose has: runtime: nvidia"
    fi
else
    echo "⚠️  nvidia-smi not found - nvidia-container-toolkit may not be injecting drivers"
fi

# Check CUDA toolkit installation
if command -v nvcc &> /dev/null; then
    NVCC_VER=$(nvcc --version | grep "release" | sed 's/.*release \([0-9.]*\).*/\1/')
    echo "✓ CUDA Toolkit installed: nvcc $NVCC_VER"
    echo "  Tools available: nvcc, ptxas, cuda-gdb, cuobjdump, nvprof"
else
    echo "⚠️  nvcc not found - CUDA toolkit may not be installed"
fi

# Test PyTorch CUDA detection
echo "Testing PyTorch CUDA support..."
set +e
PYTORCH_TEST=$(/opt/venv/bin/python3 -c "
import torch
print(f'PyTorch: {torch.__version__}')
print(f'CUDA available: {torch.cuda.is_available()}')
if torch.cuda.is_available():
    print(f'CUDA version: {torch.version.cuda}')
    print(f'GPU count: {torch.cuda.device_count()}')
    for i in range(torch.cuda.device_count()):
        print(f'  GPU {i}: {torch.cuda.get_device_name(i)}')
else:
    print('WARNING: PyTorch cannot access CUDA')
" 2>&1)
set -e

echo "$PYTORCH_TEST"

if echo "$PYTORCH_TEST" | grep -q "CUDA available: True"; then
    echo "✓ PyTorch GPU acceleration ready"
else
    echo "⚠️  PyTorch GPU acceleration not available - will fallback to CPU"
fi

# ============================================================================
# Phase 4: Verify Host Claude Configuration Mount
# ============================================================================

echo "[4/10] Verifying host Claude configuration..."

if [ -d "/home/devuser/.claude" ]; then
    # Ensure proper ownership (host mount may have different UID)
    # Skip node_modules to avoid processing thousands of files
    # Use -prune to skip entire directories, much faster than -exec on each file
    set +e
    find /home/devuser/.claude -name node_modules -prune -o -type f -writable -exec chown devuser:devuser {} + 2>/dev/null
    find /home/devuser/.claude -name node_modules -prune -o -type d -writable -exec chown devuser:devuser {} + 2>/dev/null
    set -e

    # Ensure Claude Code credentials have proper permissions
    if [ -f "/home/devuser/.claude/.credentials.json" ]; then
        chmod 600 /home/devuser/.claude/.credentials.json 2>/dev/null || true
        echo "  - OAuth credentials: .credentials.json found"
    else
        echo "  ⚠️  No .credentials.json found - Claude Code will require login"
    fi

    # Ensure settings files are accessible
    if [ -f "/home/devuser/.claude/settings.json" ]; then
        chmod 644 /home/devuser/.claude/settings.json 2>/dev/null || true
        echo "  - Settings: settings.json found"
    fi

    echo "✓ Host Claude configuration mounted at /home/devuser/.claude (read-write)"
else
    # Create directory if mount failed
    mkdir -p /home/devuser/.claude/skills
    chown -R devuser:devuser /home/devuser/.claude
    echo "⚠️  Claude config directory created (host mount not detected)"
fi

# Setup ~/.config/claude if mounted
if [ -d "/home/devuser/.config/claude" ]; then
    chown -R devuser:devuser /home/devuser/.config/claude 2>/dev/null || true
    echo "✓ Claude desktop config mounted at /home/devuser/.config/claude"
fi

# ============================================================================
# Phase 5: Initialize DBus
# ============================================================================

echo "[5/10] Initializing DBus..."

# Clean up any stale PID files from previous runs
rm -f /run/dbus/pid /var/run/dbus/pid

# DBus will be started by supervisord
echo "✓ DBus configured (supervisord will start)"

# ============================================================================
# Phase 5.5: PostgreSQL Initialization for RuVector Memory Storage
# ============================================================================

echo "[5.5/10] Initializing PostgreSQL for RuVector unified memory..."

# Check if using external RuVector PostgreSQL (ragflow network)
RUVECTOR_USE_EXTERNAL="${RUVECTOR_USE_EXTERNAL:-true}"
RUVECTOR_PG_HOST="${RUVECTOR_PG_HOST:-ruvector-postgres}"
RUVECTOR_PG_PORT="${RUVECTOR_PG_PORT:-5432}"
RUVECTOR_PG_USER="${RUVECTOR_PG_USER:-ruvector}"
RUVECTOR_PG_PASSWORD="${RUVECTOR_PG_PASSWORD:-ruvector_secure_pass}"
RUVECTOR_PG_DATABASE="${RUVECTOR_PG_DATABASE:-ruvector}"

# Export connection string for psycopg
export RUVECTOR_PG_CONNINFO="host=$RUVECTOR_PG_HOST port=$RUVECTOR_PG_PORT user=$RUVECTOR_PG_USER password=$RUVECTOR_PG_PASSWORD dbname=$RUVECTOR_PG_DATABASE"

if [ "$RUVECTOR_USE_EXTERNAL" = "true" ]; then
    echo "  Checking external RuVector PostgreSQL at $RUVECTOR_PG_HOST:$RUVECTOR_PG_PORT..."

    # Test connection to external PostgreSQL
    set +e
    PGPASSWORD="$RUVECTOR_PG_PASSWORD" psql -h "$RUVECTOR_PG_HOST" -p "$RUVECTOR_PG_PORT" -U "$RUVECTOR_PG_USER" -d "$RUVECTOR_PG_DATABASE" -c "SELECT 1" >/dev/null 2>&1
    EXTERNAL_PG_STATUS=$?
    set -e

    if [ $EXTERNAL_PG_STATUS -eq 0 ]; then
        echo "  ✓ External RuVector PostgreSQL connected successfully"

        # Get stats from external database
        ENTRY_COUNT=$(PGPASSWORD="$RUVECTOR_PG_PASSWORD" psql -h "$RUVECTOR_PG_HOST" -p "$RUVECTOR_PG_PORT" -U "$RUVECTOR_PG_USER" -d "$RUVECTOR_PG_DATABASE" -t -c "SELECT COUNT(*) FROM memory_entries" 2>/dev/null | xargs)
        EMBEDDED_COUNT=$(PGPASSWORD="$RUVECTOR_PG_PASSWORD" psql -h "$RUVECTOR_PG_HOST" -p "$RUVECTOR_PG_PORT" -U "$RUVECTOR_PG_USER" -d "$RUVECTOR_PG_DATABASE" -t -c "SELECT COUNT(*) FROM memory_entries WHERE embedding_json IS NOT NULL" 2>/dev/null | xargs)
        PROJECT_COUNT=$(PGPASSWORD="$RUVECTOR_PG_PASSWORD" psql -h "$RUVECTOR_PG_HOST" -p "$RUVECTOR_PG_PORT" -U "$RUVECTOR_PG_USER" -d "$RUVECTOR_PG_DATABASE" -t -c "SELECT COUNT(*) FROM projects" 2>/dev/null | xargs)

        echo "  📊 External DB Stats: $ENTRY_COUNT entries, $EMBEDDED_COUNT embedded, $PROJECT_COUNT projects"
        echo "  ✓ Using external RuVector PostgreSQL (skipping local PostgreSQL setup)"
        echo "✓ External PostgreSQL connection configured"

        # Fix 8 & 9: Initialize RuVector Schema/Indexes on external DB
        if [ -f "/home/devuser/.claude-flow/init-ruvector.sql" ]; then
            echo "  Initializing RuVector schema extensions (Fix 8/9)..."
            PGPASSWORD="$RUVECTOR_PG_PASSWORD" psql -h "$RUVECTOR_PG_HOST" -p "$RUVECTOR_PG_PORT" -U "$RUVECTOR_PG_USER" -d "$RUVECTOR_PG_DATABASE" -f /home/devuser/.claude-flow/init-ruvector.sql >/dev/null 2>&1 && \
            echo "  ✓ RuVector schema extensions applied" || \
            echo "  ⚠️  Failed to apply schema extensions (might already exist)"
        fi

        # Skip local PostgreSQL initialization
        goto_phase_6=true
    else
        echo "  ⚠️  External PostgreSQL not reachable, falling back to local PostgreSQL"
        RUVECTOR_USE_EXTERNAL="false"
    fi
fi

# Only initialize local PostgreSQL if not using external
if [ "$RUVECTOR_USE_EXTERNAL" != "true" ]; then
    echo "  Setting up local PostgreSQL..."

    # Create postgres user if it doesn't exist
    if ! id -u postgres &>/dev/null; then
        useradd -r -d /var/lib/postgres -s /bin/false postgres
    fi

# Initialize data directory if needed
PGDATA="/var/lib/postgres/data"
if [ ! -d "$PGDATA" ] || [ ! -f "$PGDATA/PG_VERSION" ]; then
    echo "  Initializing PostgreSQL data directory..."
    mkdir -p "$PGDATA"
    chown postgres:postgres "$PGDATA"
    chmod 700 "$PGDATA"

    sudo -u postgres initdb -D "$PGDATA" --encoding=UTF8 --locale=C.UTF-8

    # Configure PostgreSQL for container environment
    cat >> "$PGDATA/postgresql.conf" << 'PGCONF'
# RuVector optimizations for vector workloads
listen_addresses = 'localhost'
max_connections = 100
shared_buffers = 256MB
work_mem = 64MB
maintenance_work_mem = 128MB
effective_cache_size = 512MB
wal_level = minimal
max_wal_senders = 0
# HNSW index optimizations
max_parallel_workers_per_gather = 4
max_parallel_workers = 8
parallel_tuple_cost = 0.001
parallel_setup_cost = 10
PGCONF

    # Configure authentication
    cat > "$PGDATA/pg_hba.conf" << 'HBACONF'
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             postgres                                trust
local   all             all                                     trust
host    all             all             127.0.0.1/32            trust
host    all             all             ::1/128                 trust
HBACONF

    echo "  ✓ PostgreSQL data directory initialized"
else
    echo "  ✓ PostgreSQL data directory already exists"
fi

# Start PostgreSQL temporarily to create databases
echo "  Starting PostgreSQL for database setup..."
sudo -u postgres pg_ctl -D "$PGDATA" -l /tmp/pg_startup.log start -w || {
    echo "  ⚠️  PostgreSQL startup failed, checking logs:"
    cat /tmp/pg_startup.log 2>/dev/null || true
}

# Wait for PostgreSQL to be ready
for i in $(seq 1 30); do
    if sudo -u postgres pg_isready -q; then
        break
    fi
    sleep 0.5
done

if sudo -u postgres pg_isready -q; then
    echo "  ✓ PostgreSQL is ready"

    # Create ruvector database if not exists
    if ! sudo -u postgres psql -lqt | cut -d \| -f 1 | grep -qw ruvector; then
        echo "  Creating ruvector database..."
        sudo -u postgres createdb ruvector
        echo "  ✓ ruvector database created"
    fi

    # Install pgvector extension if available
    sudo -u postgres psql -d ruvector -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null && \
        echo "  ✓ pgvector extension installed" || \
        echo "  ⚠️  pgvector extension not available (will use pure ruvector)"

    # Create unified memory schema
    sudo -u postgres psql -d ruvector << 'SCHEMA'
-- RuVector Unified Memory Schema for Claude Flow V3
CREATE TABLE IF NOT EXISTS memory_entries (
    id SERIAL PRIMARY KEY,
    key VARCHAR(512) UNIQUE NOT NULL,
    namespace VARCHAR(128) DEFAULT 'default',
    type VARCHAR(32) NOT NULL DEFAULT 'persistent',
    value JSONB NOT NULL,
    embedding vector(384),  -- all-MiniLM-L6-v2 dimensions
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE,
    agent_id VARCHAR(128),
    session_id VARCHAR(128)
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_memory_namespace ON memory_entries(namespace);
CREATE INDEX IF NOT EXISTS idx_memory_type ON memory_entries(type);
CREATE INDEX IF NOT EXISTS idx_memory_agent ON memory_entries(agent_id);
CREATE INDEX IF NOT EXISTS idx_memory_session ON memory_entries(session_id);
CREATE INDEX IF NOT EXISTS idx_memory_created ON memory_entries(created_at);
CREATE INDEX IF NOT EXISTS idx_memory_metadata ON memory_entries USING gin(metadata);

-- HNSW index for vector similarity search (150x-12,500x faster)
CREATE INDEX IF NOT EXISTS idx_memory_embedding_hnsw
    ON memory_entries USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ReasoningBank pattern storage
CREATE TABLE IF NOT EXISTS reasoning_patterns (
    id SERIAL PRIMARY KEY,
    pattern_key VARCHAR(512) UNIQUE NOT NULL,
    pattern_type VARCHAR(64) NOT NULL,
    description TEXT,
    embedding vector(384),
    confidence FLOAT DEFAULT 0.5,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_patterns_type ON reasoning_patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_patterns_confidence ON reasoning_patterns(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_patterns_embedding_hnsw
    ON reasoning_patterns USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- SONA trajectory tracking
CREATE TABLE IF NOT EXISTS sona_trajectories (
    id SERIAL PRIMARY KEY,
    trajectory_id VARCHAR(128) UNIQUE NOT NULL,
    agent_id VARCHAR(128),
    task_description TEXT,
    steps JSONB DEFAULT '[]',
    success BOOLEAN,
    feedback TEXT,
    quality_score FLOAT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_trajectories_agent ON sona_trajectories(agent_id);
CREATE INDEX IF NOT EXISTS idx_trajectories_success ON sona_trajectories(success);

-- Session state persistence
CREATE TABLE IF NOT EXISTS session_state (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(128) UNIQUE NOT NULL,
    name VARCHAR(256),
    description TEXT,
    state JSONB NOT NULL,
    agents JSONB DEFAULT '[]',
    tasks JSONB DEFAULT '[]',
    metrics JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Grant permissions to all users
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO PUBLIC;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO PUBLIC;

SELECT 'RuVector unified memory schema initialized' AS status;
SCHEMA

    echo "  ✓ RuVector unified memory schema created"

    # Stop PostgreSQL (supervisord will manage it)
    sudo -u postgres pg_ctl -D "$PGDATA" stop -m fast
    echo "  ✓ PostgreSQL stopped (supervisord will restart)"

    # Update connection string for local PostgreSQL
    export RUVECTOR_PG_CONNINFO="host=localhost port=5432 user=postgres dbname=ruvector"
else
    echo "  ⚠️  PostgreSQL not ready, skipping database setup"
fi

echo "✓ Local PostgreSQL initialization complete"
fi  # End of local PostgreSQL block

echo "✓ PostgreSQL initialization complete"

# ============================================================================
# Phase 6: Setup Claude Skills
# ============================================================================

echo "[6/10] Setting up Claude Code skills..."

# Make skill tools executable
find /home/devuser/.claude/skills -name "*.py" -exec chmod +x {} \;
find /home/devuser/.claude/skills -name "*.js" -exec chmod +x {} \;
find /home/devuser/.claude/skills -name "*.sh" -exec chmod +x {} \;

# Count skills
SKILL_COUNT=$(find /home/devuser/.claude/skills -name "SKILL.md" | wc -l)
echo "✓ $SKILL_COUNT Claude Code skills available"

# ============================================================================
# Phase 6.1: Build Chrome Extensions (Console Buddy, etc.)
# ============================================================================

echo "[6.1/10] Building Chrome extensions..."

# Build Console Buddy Chrome Extension
# Check multiple possible locations
CONSOLE_BUDDY_PATHS=(
    "/home/devuser/.claude/skills/console-buddy"
    "/home/devuser/workspace/project/multi-agent-docker/skills/console-buddy"
)

CONSOLE_BUDDY_DIR=""
for cb_path in "${CONSOLE_BUDDY_PATHS[@]}"; do
    if [ -d "$cb_path" ] && [ -f "$cb_path/package.json" ]; then
        CONSOLE_BUDDY_DIR="$cb_path"
        break
    fi
done

if [ -n "$CONSOLE_BUDDY_DIR" ]; then
    echo "  Building Console Buddy from: $CONSOLE_BUDDY_DIR"
    if [ ! -f "$CONSOLE_BUDDY_DIR/dist/manifest.json" ] || [ "$CONSOLE_BUDDY_DIR/package.json" -nt "$CONSOLE_BUDDY_DIR/dist/manifest.json" ]; then
        (
            cd "$CONSOLE_BUDDY_DIR"
            # Install with dev dependencies (vite, typescript)
            npm install --include=dev --silent 2>/dev/null || npm install --include=dev 2>&1 | head -5
            # Build with vite
            npx vite build 2>/dev/null || npx vite build 2>&1 | head -10
            if [ -f "dist/manifest.json" ]; then
                echo "  ✓ Console Buddy built successfully (22+ tools)"
            else
                echo "  ⚠️ Console Buddy build may have failed (no dist/manifest.json)"
            fi
        )
    else
        echo "  ✓ Console Buddy already built (dist/ up to date)"
    fi
    # Fix ownership of built artifacts
    chown -R devuser:devuser "$CONSOLE_BUDDY_DIR" 2>/dev/null || true
else
    echo "  ℹ️ Console Buddy not found (will be available when cloned)"
fi

# ============================================================================
# Phase 6: Setup Agents
# ============================================================================

echo "[7/10] Setting up Claude agents..."

AGENT_COUNT=$(find /home/devuser/agents -name "*.md" 2>/dev/null | wc -l)
if [ "$AGENT_COUNT" -gt 0 ]; then
    echo "✓ $AGENT_COUNT agent templates available"
else
    echo "ℹ️  No agent templates found"
fi

# ============================================================================
# Phase 6.5: Initialize Claude Flow & Clean NPX Cache
# ============================================================================

echo "[6.5/10] Initializing Claude Flow..."

# Clean any stale NPX caches from all users to prevent corruption
rm -rf /home/devuser/.npm/_npx/* 2>/dev/null || true
rm -rf /home/gemini-user/.npm/_npx/* 2>/dev/null || true
rm -rf /home/openai-user/.npm/_npx/* 2>/dev/null || true
rm -rf /home/zai-user/.npm/_npx/* 2>/dev/null || true
rm -rf /root/.npm/_npx/* 2>/dev/null || true

# Run Claude-Flow V3 init --force as devuser IN BACKGROUND (non-blocking)
# This prevents blocking supervisord startup while npm packages compile
# Using @claude-flow/cli@3.0.2 (latest stable)
(sudo -u devuser bash -c "cd /home/devuser && npx @claude-flow/cli@3.0.2 init --force" > /var/log/claude-flow-init.log 2>&1 &) || true
echo "ℹ️  Claude Flow V3 init started in background (see /var/log/claude-flow-init.log)"

# Fix hooks to use global claude-flow binary (Fix 3)
if [ -f /home/devuser/.claude/settings.json ]; then
    # Replace slow npx invocations with global binary
    sed -i 's|npx @claude-flow/cli|claude-flow|g' /home/devuser/.claude/settings.json
    sed -i 's|npx claude-flow|claude-flow|g' /home/devuser/.claude/settings.json
    # Clean up any remaining legacy formats
    sed -i 's|claude-flow@v3alpha|claude-flow|g' /home/devuser/.claude/settings.json
    chown devuser:devuser /home/devuser/.claude/settings.json
    echo "✓ Hooks updated to use global claude-flow binary"
fi

# Initialize @claude-flow/browser for AI-optimized browser automation
echo "ℹ️  Initializing @claude-flow/browser (59 MCP tools)..."
(sudo -u devuser bash -c "cd /home/devuser && npx @claude-flow/browser init 2>/dev/null" >> /var/log/claude-flow-init.log 2>&1 &) || true

echo "✓ Claude Flow V3 initialized and NPX cache cleared"

# ============================================================================
# Phase 6.6: Initialize AISP 5.1 Platinum Neuro-Symbolic Protocol
# ============================================================================

echo "[6.6/10] Initializing AISP 5.1 Platinum protocol..."

if [ -d "/opt/aisp" ] && [ -f "/opt/aisp/index.js" ]; then
    # Run AISP initialization in background (non-blocking)
    (
        cd /opt/aisp

        # Initialize AISP validator and load glossary
        node -e "
const { AISPValidator } = require('./index.js');
const validator = new AISPValidator();
validator.initialize().then(() => {
    const stats = validator.getStats();
    console.log('[AISP] ✓ Σ_512 glossary loaded:', stats.glossarySize, 'symbols');
    console.log('[AISP] Signal: V_H=' + stats.config.signalDims.V_H + ', V_L=' + stats.config.signalDims.V_L + ', V_S=' + stats.config.signalDims.V_S);
    console.log('[AISP] Hebbian: α=' + stats.config.hebbian.α + ', β=' + stats.config.hebbian.β);
}).catch(err => {
    console.error('[AISP] Init failed:', err.message);
});
" >> /var/log/aisp-init.log 2>&1

        # Register AISP config in claude-flow memory
        if command -v claude-flow &> /dev/null; then
            claude-flow memory store --key "aisp/version" --value "5.1.0" --namespace aisp 2>/dev/null || true
            claude-flow memory store --key "aisp/status" --value "initialized" --namespace aisp 2>/dev/null || true
        fi
    ) &

    echo "✓ AISP 5.1 Platinum initializing in background"
    echo "  - Glossary: Σ_512 (8 categories × 64 symbols)"
    echo "  - Signal Theory: V_H(768d), V_L(512d), V_S(256d)"
    echo "  - Pocket Architecture: ⟨ℋ:Header, ℳ:Membrane, 𝒩:Nucleus⟩"
    echo "  - Hebbian Learning: ⊕(+1), ⊖(-10), τ_v=0.7"
    echo "  - Binding States: Δ⊗λ ∈ {crash, null, adapt, zero-cost}"
    echo "  - Quality Tiers: ◊⁺⁺, ◊⁺, ◊, ◊⁻, ⊘"
    echo "  - Log: /var/log/aisp-init.log"
else
    echo "ℹ️  AISP integration module not installed (optional)"
fi

# ============================================================================
# Phase 6.7: Configure Cross-User Service Access & Dynamic MCP Discovery
# ============================================================================

echo "[6.7/10] Configuring cross-user service access..."

# Create shared directory for inter-service sockets
mkdir -p /var/run/agentic-services
chmod 755 /var/run/agentic-services

# Set agent events bridge environment variables
export ENABLE_MCP_BRIDGE="${ENABLE_MCP_BRIDGE:-true}"
export MCP_TCP_HOST="${MCP_TCP_HOST:-localhost}"
export MCP_TCP_PORT="${MCP_TCP_PORT:-9500}"

# Create symlinks for devuser to access isolated services
mkdir -p /home/devuser/.local/share/agentic-sockets
ln -sf /var/run/agentic-services/gemini-mcp.sock /home/devuser/.local/share/agentic-sockets/gemini-mcp.sock 2>/dev/null || true
ln -sf http://localhost:9600 /home/devuser/.local/share/agentic-sockets/zai-api.txt 2>/dev/null || true

# Add environment variable exports to devuser's zshrc for service discovery
sudo -u devuser bash -c 'cat >> ~/.zshrc' <<'ENV_EXPORTS'

# Cross-user service access (auto-configured)
export GEMINI_MCP_SOCKET="/var/run/agentic-services/gemini-mcp.sock"
export ZAI_API_URL="http://localhost:9600"
export ZAI_CONTAINER_URL="http://localhost:9600"
export OPENAI_CODEX_SOCKET="/var/run/agentic-services/openai-codex.sock"

# Agent Event Bridge to VisionFlow
export ENABLE_MCP_BRIDGE="true"
export MCP_TCP_HOST="localhost"
export MCP_TCP_PORT="9500"

# QGIS Python 3.14 Support (adds site-packages to PYTHONPATH)
export PYTHONPATH=/usr/lib/python3.14/site-packages:\$PYTHONPATH

# Display and supervisorctl configuration
export DISPLAY=:1
alias supervisorctl="/opt/venv/bin/supervisorctl"

# Disable Claude Code auto-updater (2.1.15 burns excessive tokens)
export DISABLE_AUTOUPDATER=1

# Claude Code aliases (non-interactive mode works with existing OAuth credentials)
alias dsp="claude --dangerously-skip-permissions"
alias claude-ask='f() { echo "$1" | claude -p --dangerously-skip-permissions; }; f'
alias claude-chat='claude --dangerously-skip-permissions --continue'
ENV_EXPORTS

# ============================================================================
# Dynamic MCP Settings Generation
# Discovers skills with mcp_server: true in SKILL.md frontmatter
# ============================================================================

echo "  Discovering MCP-enabled skills..."

mkdir -p /home/devuser/.config/claude

# Use generate-mcp-settings.sh if available and readable, otherwise inline discovery
# Note: Run as root since the script may not be readable by devuser, then fix ownership
set +e  # Don't exit on error for this section
if [ -x /usr/local/bin/generate-mcp-settings.sh ] && [ -r /usr/local/bin/generate-mcp-settings.sh ]; then
    SKILLS_DIR=/home/devuser/.claude/skills \
        OUTPUT_FILE=/home/devuser/.config/claude/mcp_settings.json \
        /usr/local/bin/generate-mcp-settings.sh
    chown devuser:devuser /home/devuser/.config/claude/mcp_settings.json 2>/dev/null
elif [ -x /usr/local/bin/generate-mcp-settings.sh ]; then
    # Script exists but not readable - run as root and fix ownership
    SKILLS_DIR=/home/devuser/.claude/skills \
        OUTPUT_FILE=/home/devuser/.config/claude/mcp_settings.json \
        bash /usr/local/bin/generate-mcp-settings.sh 2>/dev/null || true
    chown devuser:devuser /home/devuser/.config/claude/mcp_settings.json 2>/dev/null
else
    # Inline dynamic discovery (fallback)
    sudo -u devuser bash -c '
        SKILLS_DIR="/home/devuser/.claude/skills"
        OUTPUT_FILE="/home/devuser/.config/claude/mcp_settings.json"

        # Start JSON
        echo "{" > "$OUTPUT_FILE"
        echo "  \"mcpServers\": {" >> "$OUTPUT_FILE"

        first=true
        skill_count=0

        for skill_md in "$SKILLS_DIR"/*/SKILL.md; do
            [ -f "$skill_md" ] || continue
            skill_dir=$(dirname "$skill_md")
            skill_name=$(basename "$skill_dir")

            # Parse frontmatter for mcp_server: true
            mcp_server=$(awk "/^---$/,/^---$/" "$skill_md" | grep "^mcp_server:" | sed "s/mcp_server:[[:space:]]*//" | tr -d " ")
            [ "$mcp_server" != "true" ] && continue

            # Get entry_point and protocol
            entry_point=$(awk "/^---$/,/^---$/" "$skill_md" | grep "^entry_point:" | sed "s/entry_point:[[:space:]]*//" | tr -d " ")
            protocol=$(awk "/^---$/,/^---$/" "$skill_md" | grep "^protocol:" | sed "s/protocol:[[:space:]]*//" | tr -d " ")

            [ -z "$entry_point" ] && continue

            full_path="$skill_dir/$entry_point"
            [ ! -f "$full_path" ] && continue

            # Determine command
            case "$entry_point" in
                *.py) cmd="python3"; args="[\"-u\", \"$full_path\"]" ;;
                *.js) cmd="node"; args="[\"$full_path\"]" ;;
                *) continue ;;
            esac

            # Comma handling
            [ "$first" = "true" ] && first=false || echo "," >> "$OUTPUT_FILE"

            # Build skill entry with env vars based on skill name
            echo -n "    \"$skill_name\": {\"command\": \"$cmd\", \"args\": $args" >> "$OUTPUT_FILE"

            case "$skill_name" in
                web-summary)
                    echo -n ", \"env\": {\"ZAI_URL\": \"http://localhost:9600/chat\", \"ZAI_TIMEOUT\": \"60\"}" >> "$OUTPUT_FILE"
                    ;;
                qgis)
                    echo -n ", \"env\": {\"QGIS_HOST\": \"localhost\", \"QGIS_PORT\": \"9877\"}" >> "$OUTPUT_FILE"
                    ;;
                blender)
                    echo -n ", \"env\": {\"BLENDER_HOST\": \"localhost\", \"BLENDER_PORT\": \"9876\"}" >> "$OUTPUT_FILE"
                    ;;
                playwright)
                    echo -n ", \"env\": {\"DISPLAY\": \":1\", \"CHROMIUM_PATH\": \"/usr/bin/chromium\"}" >> "$OUTPUT_FILE"
                    ;;
                comfyui)
                    # ComfyUI runs as external container, accessed via docker network
                    echo -n ", \"env\": {\"COMFYUI_URL\": \"http://comfyui:8188\"}" >> "$OUTPUT_FILE"
                    ;;
                perplexity)
                    echo -n ", \"env\": {\"PERPLEXITY_API_KEY\": \"\$PERPLEXITY_API_KEY\"}" >> "$OUTPUT_FILE"
                    ;;
                deepseek-reasoning)
                    echo -n ", \"env\": {\"DEEPSEEK_API_KEY\": \"\$DEEPSEEK_API_KEY\"}" >> "$OUTPUT_FILE"
                    ;;
            esac

            echo -n "}" >> "$OUTPUT_FILE"
            skill_count=$((skill_count + 1))
        done

        # Close mcpServers and add VisionFlow config
        echo "" >> "$OUTPUT_FILE"
        cat >> "$OUTPUT_FILE" <<VISIONFLOW
  },
  "visionflow": {
    "tcp_bridge": {"host": "localhost", "port": 9500},
    "discovery": {"resource_pattern": "{skill}://capabilities", "refresh_interval": 300}
  },
  "metadata": {
    "generated_at": "$(date -Iseconds)",
    "skills_count": $skill_count,
    "generator": "entrypoint-unified.sh v2.0.0"
  }
}
VISIONFLOW

        echo "  Found $skill_count MCP-enabled skills"
    '
fi
set -e  # Re-enable exit on error

# Count registered skills
MCP_SKILL_COUNT=$(grep -c '"command":' /home/devuser/.config/claude/mcp_settings.json 2>/dev/null || echo "0")

chown -R devuser:devuser /home/devuser/.local/share/agentic-sockets
chown -R devuser:devuser /home/devuser/.config/claude

echo "✓ Cross-user service access configured"
echo "  - Gemini MCP socket: /var/run/agentic-services/gemini-mcp.sock"
echo "  - Z.AI API: http://localhost:9600"
echo "  - MCP Servers: $MCP_SKILL_COUNT skills auto-discovered from SKILL.md frontmatter"
echo "  - VisionFlow TCP bridge: localhost:9500"
echo "  - Environment variables added to devuser's .zshrc"

# ============================================================================
# Phase 7: Generate SSH Host Keys
# ============================================================================

echo "[8/10] Generating SSH host keys..."

if [ ! -f /etc/ssh/ssh_host_rsa_key ]; then
    ssh-keygen -A
    echo "✓ SSH host keys generated"
else
    echo "ℹ️  SSH host keys already exist"
fi

# ============================================================================
# Phase 7.3: Configure SSH Credentials (Host Mount)
# ============================================================================

echo "[7.3/10] Configuring SSH credentials..."

# Check if SSH mount exists (individual key files mounted)
if [ -d "/home/devuser/.ssh" ] && [ "$(ls -A /home/devuser/.ssh 2>/dev/null)" ]; then
    echo "✓ SSH credentials detected from host mount"

    # Ensure SSH directory has correct permissions
    chmod 700 /home/devuser/.ssh 2>/dev/null || true

    # Set key file permissions (read-only mounts may fail silently, which is fine)
    chmod 600 /home/devuser/.ssh/id_* 2>/dev/null || true
    chmod 644 /home/devuser/.ssh/*.pub 2>/dev/null || true
    chmod 644 /home/devuser/.ssh/known_hosts 2>/dev/null || true

    # Add GitHub to known_hosts if not present (prevents first-connect prompt)
    if [ -f /home/devuser/.ssh/known_hosts ]; then
        if ! grep -q "github.com" /home/devuser/.ssh/known_hosts 2>/dev/null; then
            ssh-keyscan -t ed25519 github.com >> /home/devuser/.ssh/known_hosts 2>/dev/null || true
            echo "  - Added github.com to known_hosts"
        fi
    fi

    # Verify key files
    KEY_COUNT=$(find /home/devuser/.ssh -type f -name "id_*" ! -name "*.pub" 2>/dev/null | wc -l)
    PUB_COUNT=$(find /home/devuser/.ssh -type f -name "*.pub" 2>/dev/null | wc -l)

    echo "  - Private keys: $KEY_COUNT"
    echo "  - Public keys: $PUB_COUNT"
    echo "  - Mount: read-only (secure)"

    # Add SSH environment setup to devuser's zshrc if not already present
    if ! grep -q "SSH_AUTH_SOCK" /home/devuser/.zshrc 2>/dev/null; then
        sudo -u devuser bash -c 'cat >> ~/.zshrc' <<'SSH_ENV'

# SSH Agent Configuration (auto-configured)
# Start ssh-agent if not running
if [ -z "$SSH_AUTH_SOCK" ]; then
    eval "$(ssh-agent -s)" > /dev/null 2>&1
    # Auto-add keys on first shell
    find ~/.ssh -type f -name "id_*" ! -name "*.pub" -exec ssh-add {} \; 2>/dev/null
fi
SSH_ENV
        echo "  - SSH agent auto-start configured in .zshrc"
    fi

    echo "✓ SSH credentials configured successfully"
else
    echo "ℹ️  SSH credentials not mounted (mount ~/.ssh to container for SSH key access)"
fi

# ============================================================================
# Phase 7.5: Install Management API Health Check Script
# ============================================================================

echo "[7.5/10] Installing Management API health check script..."

# Create scripts directory
mkdir -p /opt/scripts

# Copy verification script if available in unified-config
if [ -f "/unified-config/scripts/verify-management-api.sh" ]; then
    cp /unified-config/scripts/verify-management-api.sh /opt/scripts/
    chmod +x /opt/scripts/verify-management-api.sh
    echo "✓ Management API health check script installed"
else
    # Create inline if not available (fallback)
    cat > /opt/scripts/verify-management-api.sh <<'HEALTHCHECK_SCRIPT'
#!/bin/bash
# Management API Health Check Script
set -e
MANAGEMENT_API_HOST="${MANAGEMENT_API_HOST:-localhost}"
MANAGEMENT_API_PORT="${MANAGEMENT_API_PORT:-9090}"
MAX_RETRIES=30
RETRY_DELAY=2
echo "=== Management API Health Check ==="
echo "Target: http://${MANAGEMENT_API_HOST}:${MANAGEMENT_API_PORT}/health"
for i in $(seq 1 $MAX_RETRIES); do
    if curl -s -f "http://${MANAGEMENT_API_HOST}:${MANAGEMENT_API_PORT}/health" > /dev/null 2>&1; then
        RESPONSE=$(curl -s "http://${MANAGEMENT_API_HOST}:${MANAGEMENT_API_PORT}/health")
        echo "✅ Management API is healthy (attempt $i/$MAX_RETRIES)"
        echo "   Response: $RESPONSE"
        exit 0
    else
        echo "⏳ Attempt $i/$MAX_RETRIES: Management API not ready..."
        if /opt/venv/bin/supervisorctl status management-api | grep -q "RUNNING"; then
            echo "   Process status: RUNNING"
        else
            echo "   ⚠️  Process not running! Restarting..."
            /opt/venv/bin/supervisorctl restart management-api
        fi
        sleep $RETRY_DELAY
    fi
done
echo "❌ Management API health check FAILED"
/opt/venv/bin/supervisorctl status management-api
exit 1
HEALTHCHECK_SCRIPT
    chmod +x /opt/scripts/verify-management-api.sh
    echo "✓ Management API health check script created inline"
fi

# ============================================================================
# Phase 7.6: Setup Agent-Browser (Vercel Labs)
# Install playwright browsers and fix version compatibility
# ============================================================================

echo "[7.6/10] Setting up agent-browser (Vercel Labs browser automation)..."

# Agent-browser uses playwright internally. Install browsers as devuser.
# Also create symlinks for playwright version compatibility (1200 -> 1208, etc.)
if command -v agent-browser &> /dev/null; then
    # Install playwright browsers silently
    sudo -u devuser bash -c '
        mkdir -p ~/.cache/ms-playwright
        agent-browser install 2>&1 | tail -2

        # Create symlinks for version compatibility (playwright version mismatches)
        # This allows agent-browser to work even with minor playwright version differences
        cd ~/.cache/ms-playwright 2>/dev/null || exit 0
        for dir in chromium-*; do
            [[ -d "$dir" ]] || continue
            version="${dir##*-}"
            # Create symlinks for common version offsets (+/- 8 builds)
            for offset in 1 2 3 4 5 6 7 8; do
                target_v=$((version + offset))
                [[ -e "chromium-$target_v" ]] || ln -sf "$dir" "chromium-$target_v" 2>/dev/null
                target_v=$((version - offset))
                [[ -e "chromium-$target_v" ]] || ln -sf "$dir" "chromium-$target_v" 2>/dev/null
            done
        done
        for dir in chromium_headless_shell-*; do
            [[ -d "$dir" ]] || continue
            version="${dir##*-}"
            for offset in 1 2 3 4 5 6 7 8; do
                target_v=$((version + offset))
                [[ -e "chromium_headless_shell-$target_v" ]] || ln -sf "$dir" "chromium_headless_shell-$target_v" 2>/dev/null
                target_v=$((version - offset))
                [[ -e "chromium_headless_shell-$target_v" ]] || ln -sf "$dir" "chromium_headless_shell-$target_v" 2>/dev/null
            done
        done
    ' 2>/dev/null || true

    echo "✓ agent-browser $(agent-browser --version 2>/dev/null || echo 'ready')"
    echo "  Commands: open, click, fill, snapshot, screenshot, eval, close"
    echo "  Usage: agent-browser open <url> && agent-browser snapshot -i"
else
    echo "ℹ️  agent-browser not installed (optional)"
fi

# ============================================================================
# Phase 8: Enhance CLAUDE.md with Project Context
# ============================================================================

echo "[9/10] Enhancing CLAUDE.md with project-specific context..."

# Append compact project documentation to BOTH home and workspace CLAUDE.md
# (Claude Code reads from workspace when running in project directory)
# IDEMPOTENCY: Only append if marker not present (prevents duplication on restart)
for claude_md in /home/devuser/CLAUDE.md /home/devuser/workspace/CLAUDE.md; do
  if [ -f "$claude_md" ] && grep -q "## 🚀 Project-Specific: Turbo Flow Claude" "$claude_md" 2>/dev/null; then
    echo "  → Skipping $claude_md (project context already present)"
    continue
  fi
  sudo -u devuser bash -c "cat >> $claude_md" <<'CLAUDE_APPEND'

---

## 🚀 Project-Specific: Turbo Flow Claude

### 610 Claude Sub-Agents
- **Repository**: https://github.com/ChrisRoyse/610ClaudeSubagents
- **Location**: `/home/devuser/agents/*.md` (610+ templates)
- **Usage**: Load specific agents with `cat agents/<agent-name>.md`
- **Key Agents**: doc-planner, microtask-breakdown, github-pr-manager, tdd-london-swarm

### Z.AI Service (Cost-Effective Claude API)
**Port**: 9600 (internal only) | **User**: zai-user | **Worker Pool**: 4 concurrent
```bash
# Health check
curl http://localhost:9600/health

# Chat request
curl -X POST http://localhost:9600/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Your prompt here", "timeout": 30000}'

# Switch to zai-user
as-zai
```

### Gemini Flow Commands
```bash
gf-init        # Initialize (protocols: a2a,mcp, topology: hierarchical)
gf-swarm       # 66 agents with intelligent coordination
gf-architect   # 5 system architects
gf-coder       # 12 master coders
gf-status      # Swarm status
gf-monitor     # Protocols and performance
gf-health      # Health check
```

### Multi-User System
| User | UID | Purpose | Switch |
|------|-----|---------|--------|
| devuser | 1000 | Claude Code, primary dev | - |
| gemini-user | 1001 | Google Gemini, gemini-flow | `as-gemini` |
| openai-user | 1002 | OpenAI Codex | `as-openai` |
| zai-user | 1003 | Z.AI service (port 9600) | `as-zai` |

### tmux Workspace (8 Windows)
**Attach**: `tmux attach -t workspace`
| Win | Name | Purpose |
|-----|------|---------|
| 0 | Claude-Main | Primary workspace |
| 1 | Claude-Agent | Agent execution |
| 2 | Services | supervisord monitoring |
| 3 | Development | Python/Rust/CUDA dev |
| 4 | Logs | Service logs (split) |
| 5 | System | htop monitoring |
| 6 | VNC-Status | VNC info |
| 7 | SSH-Shell | General shell |

### Management API
**Base**: http://localhost:9090 | **Auth**: `X-API-Key: <MANAGEMENT_API_KEY>`
```bash
GET  /health              # Health (no auth)
GET  /api/status          # System status
POST /api/tasks           # Create task
GET  /api/tasks/:id       # Task status
GET  /metrics             # Prometheus metrics
GET  /documentation       # Swagger UI
```

### Diagnostic Commands
```bash
# Service status
sudo supervisorctl status

# Container diagnostics
docker exec turbo-flow-unified supervisorctl status
docker stats turbo-flow-unified

# Logs
sudo supervisorctl tail -f management-api
sudo supervisorctl tail -f claude-zai
tail -f /var/log/supervisord.log

# User switching test
as-gemini whoami  # Should output: gemini-user
```

### Service Ports
| Port | Service | Access |
|------|---------|--------|
| 22 | SSH | Public (mapped to 2222) |
| 5901 | VNC | Public |
| 8080 | code-server | Public |
| 9090 | Management API | Public |
| 9600 | Z.AI | Internal only |

**Security**: Default creds are DEVELOPMENT ONLY. Change before production:
- SSH: `devuser:turboflow`
- VNC: `turboflow`
- Management API: `X-API-Key: change-this-secret-key`

### Development Environment Notes

**Container Modification Best Practices**:
- ✅ **DO**: Modify Dockerfile and entrypoint scripts DIRECTLY in the project
- ❌ **DON'T**: Create patching scripts or temporary fixes
- ✅ **DO**: Edit /home/devuser/workspace/project/multi-agent-docker/ files
- ❌ **DON'T**: Use workarounds - fix the root cause

**Isolated Docker Environment**:
- This container is isolated from external build systems
- Only these validation tools work:
  - \`cargo test\` - Rust project testing
  - \`npm run check\` / \`npm test\` - Node.js validation
  - \`pytest\` - Python testing
- **DO NOT** attempt to:
  - Build external projects directly
  - Run production builds inside container
  - Execute deployment scripts
  - Access external build infrastructure
- **Instead**: Test, validate, and export artifacts

**File Organization**:
- Never save working files to root (/)
- Use appropriate subdirectories:
  - /docs - Documentation
  - /scripts - Helper scripts
  - /tests - Test files
  - /config - Configuration
CLAUDE_APPEND
done

echo "✓ CLAUDE.md enhanced with project context (both /home and /workspace)"

# ============================================================================
# Phase 9: Display Connection Information
# ============================================================================

echo "[10/10] Container ready! Connection information:"
echo ""
echo "+-------------------------------------------------------------+"
echo "│                   CONNECTION DETAILS                        │"
echo "+-------------------------------------------------------------│"
echo "│ SSH:             ssh devuser@<container-ip> -p 22           │"
echo "│                  Password: turboflow                        │"
echo "│                                                             │"
echo "│ VNC:             vnc://<container-ip>:5901                  │"
echo "│                  Password: turboflow                        │"
echo "│                  Display: :1                                │"
echo "│                                                             │"
echo "│ code-server:     http://<container-ip>:8080                 │"
echo "│                  (No authentication required)              │"
echo "│                                                             │"
echo "│ Management API:  http://<container-ip>:9090                 │"
echo "│                  Health: /health                            │"
echo "│                  Status: /api/v1/status                     │"
echo "│                                                             │"
echo "│ Z.AI Service:    http://localhost:9600 (internal only)      │"
echo "│                  Accessible via ragflow network            │"
echo "+-------------------------------------------------------------│"
echo "│ Users:                                                      │"
echo "│   devuser (1000)      - Claude Code, development           │"
echo "│   gemini-user (1001)  - Google Gemini CLI, gemini-flow     │"
echo "│   openai-user (1002)  - OpenAI Codex                       │"
echo "│   zai-user (1003)     - Z.AI service                       │"
echo "+-------------------------------------------------------------│"
echo "│ Skills:           $SKILL_COUNT custom Claude Code skills             │"
echo "│ Agents:           $AGENT_COUNT agent templates                       │"
echo "+-------------------------------------------------------------│"
echo "│ tmux Session:     workspace (8 windows)                     │"
echo "│   Attach with:    tmux attach-session -t workspace         │"
echo "+-------------------------------------------------------------+"
echo ""

# ============================================================================
# Phase 10: Start Supervisord
# ============================================================================

echo "[11/11] Starting supervisord (all services)..."
echo ""

# Display what will start
echo "Starting services:"
echo "  ✓ DBus daemon"
echo "  ✓ SSH server (port 22)"
echo "  ✓ VNC server (port 5901)"
echo "  ✓ XFCE4 desktop"
echo "  ✓ Management API (port 9090)"
echo "  ✓ code-server (port 8080)"
echo "  ✓ Claude Z.AI service (port 9600)"
echo "  ✓ ComfyUI skill (connects to external comfyui container)"
echo "  ✓ @claude-flow/browser via claude-flow MCP (primary, 59 tools)"
echo "  ✓ MCP servers (qgis, blender - on-demand: web-summary, imagemagick)"
echo "  ✓ Gemini-flow daemon"
echo "  ✓ tmux workspace auto-start"
echo ""
echo "========================================"
echo "  ALL SYSTEMS READY - STARTING NOW"
echo "========================================"
echo ""

# Start supervisord (will run in foreground)
exec /opt/venv/bin/supervisord -n -c /etc/supervisord.conf
