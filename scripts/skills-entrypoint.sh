#!/bin/bash
# Agentbox Skills Entrypoint Script
# Initializes RuVector (PostgreSQL + pgvector) and skills environment
#
# NOTE: RuVector is NOT standard PostgreSQL - it's a custom drop-in replacement
# with vector embeddings and HNSW indexing for 150x-12,500x faster similarity search

set -e

echo "=== Agentbox Skills Initialization ==="
echo "Architecture: $(uname -m)"
echo "Date: $(date -Iseconds)"

# ============================================================================
# Configuration
# ============================================================================

export PGDATA="${PGDATA:-/var/lib/postgresql/data}"
export RUVECTOR_DB="${RUVECTOR_DB:-ruvector}"
export RUVECTOR_USER="${RUVECTOR_USER:-ruvector}"
export RUVECTOR_PASSWORD="${RUVECTOR_PASSWORD:-ruvector_secure_pass}"
export RUVECTOR_PORT="${RUVECTOR_PORT:-5432}"

# Connection string for applications
export RUVECTOR_PG_CONNINFO="host=localhost port=$RUVECTOR_PORT user=$RUVECTOR_USER password=$RUVECTOR_PASSWORD dbname=$RUVECTOR_DB"

# ============================================================================
# Phase 1: PostgreSQL Data Directory
# ============================================================================

echo "[1/5] Checking PostgreSQL data directory..."

# Create postgres user if not exists
if ! id -u postgres &>/dev/null; then
    useradd -r -d /var/lib/postgresql -s /bin/false postgres 2>/dev/null || true
fi

mkdir -p "$(dirname "$PGDATA")"

if [ ! -d "$PGDATA" ] || [ ! -f "$PGDATA/PG_VERSION" ]; then
    echo "  Initializing PostgreSQL data directory..."
    mkdir -p "$PGDATA"
    chown postgres:postgres "$PGDATA"
    chmod 700 "$PGDATA"

    # Initialize cluster with UTF-8 encoding
    sudo -u postgres initdb -D "$PGDATA" --encoding=UTF8 --locale=C.UTF-8 2>/dev/null || \
        su -s /bin/sh postgres -c "initdb -D '$PGDATA' --encoding=UTF8 --locale=C.UTF-8"

    # Configure for RuVector workloads (vector operations, HNSW)
    cat >> "$PGDATA/postgresql.conf" << 'PGCONF'
# RuVector optimizations for vector workloads
listen_addresses = 'localhost'
port = 5432
max_connections = 100

# Memory settings optimized for vector operations
shared_buffers = 256MB
work_mem = 64MB
maintenance_work_mem = 128MB
effective_cache_size = 512MB

# WAL settings for container (minimal for single-instance)
wal_level = minimal
max_wal_senders = 0
fsync = off
synchronous_commit = off

# HNSW index optimizations (parallel workers)
max_parallel_workers_per_gather = 4
max_parallel_workers = 8
parallel_tuple_cost = 0.001
parallel_setup_cost = 10

# Logging
log_destination = 'stderr'
logging_collector = off
log_statement = 'none'
PGCONF

    # Configure host-based authentication (trust for local)
    cat > "$PGDATA/pg_hba.conf" << 'HBACONF'
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             postgres                                trust
local   all             all                                     trust
host    all             all             127.0.0.1/32            md5
host    all             all             ::1/128                 md5
HBACONF

    echo "  ✓ PostgreSQL data directory initialized"
else
    echo "  ✓ PostgreSQL data directory exists"
fi

# ============================================================================
# Phase 2: Start PostgreSQL
# ============================================================================

echo "[2/5] Starting PostgreSQL..."

# Check if already running
if sudo -u postgres pg_isready -q 2>/dev/null; then
    echo "  ✓ PostgreSQL already running"
else
    # Start PostgreSQL
    sudo -u postgres pg_ctl -D "$PGDATA" -l /var/log/postgresql.log start -w -t 30 2>/dev/null || \
        su -s /bin/sh postgres -c "pg_ctl -D '$PGDATA' -l /var/log/postgresql.log start -w -t 30"

    # Wait for ready
    for i in $(seq 1 30); do
        if sudo -u postgres pg_isready -q 2>/dev/null || \
           su -s /bin/sh postgres -c "pg_isready -q" 2>/dev/null; then
            echo "  ✓ PostgreSQL started (attempt $i)"
            break
        fi
        sleep 1
    done
fi

# Verify PostgreSQL is ready
if ! (sudo -u postgres pg_isready -q 2>/dev/null || su -s /bin/sh postgres -c "pg_isready -q" 2>/dev/null); then
    echo "  ✗ PostgreSQL failed to start"
    cat /var/log/postgresql.log 2>/dev/null | tail -20
    exit 1
fi

# ============================================================================
# Phase 3: Create RuVector Database and User
# ============================================================================

echo "[3/5] Setting up RuVector database..."

# Create ruvector user if not exists
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$RUVECTOR_USER'" 2>/dev/null | grep -q 1 || \
    sudo -u postgres psql -c "CREATE USER $RUVECTOR_USER WITH PASSWORD '$RUVECTOR_PASSWORD' CREATEDB;" 2>/dev/null || \
    su -s /bin/sh postgres -c "psql -c \"CREATE USER $RUVECTOR_USER WITH PASSWORD '$RUVECTOR_PASSWORD' CREATEDB;\""

echo "  ✓ User '$RUVECTOR_USER' ready"

# Create ruvector database if not exists
if ! (sudo -u postgres psql -lqt 2>/dev/null || su -s /bin/sh postgres -c "psql -lqt") | cut -d \| -f 1 | grep -qw "$RUVECTOR_DB"; then
    echo "  Creating '$RUVECTOR_DB' database..."
    sudo -u postgres createdb -O "$RUVECTOR_USER" "$RUVECTOR_DB" 2>/dev/null || \
        su -s /bin/sh postgres -c "createdb -O '$RUVECTOR_USER' '$RUVECTOR_DB'"
    echo "  ✓ Database created"
else
    echo "  ✓ Database '$RUVECTOR_DB' exists"
fi

# ============================================================================
# Phase 4: Install pgvector Extension and Schema
# ============================================================================

echo "[4/5] Installing pgvector extension and RuVector schema..."

# Install pgvector extension
sudo -u postgres psql -d "$RUVECTOR_DB" -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null && \
    echo "  ✓ pgvector extension installed" || \
    echo "  ⚠ pgvector extension may already exist"

# Apply RuVector schema
SCHEMA_FILE="/opt/config/init-ruvector-schema.sql"
if [ ! -f "$SCHEMA_FILE" ]; then
    SCHEMA_FILE="/etc/agentbox/init-ruvector-schema.sql"
fi
if [ ! -f "$SCHEMA_FILE" ]; then
    SCHEMA_FILE="$(dirname "$0")/../config/init-ruvector-schema.sql"
fi

if [ -f "$SCHEMA_FILE" ]; then
    echo "  Applying schema from $SCHEMA_FILE..."
    sudo -u postgres psql -d "$RUVECTOR_DB" -f "$SCHEMA_FILE" 2>/dev/null || \
        su -s /bin/sh postgres -c "psql -d '$RUVECTOR_DB' -f '$SCHEMA_FILE'"
    echo "  ✓ RuVector schema applied"
else
    echo "  ⚠ Schema file not found, skipping (tables may need manual creation)"
fi

# Grant permissions to ruvector user
sudo -u postgres psql -d "$RUVECTOR_DB" -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO $RUVECTOR_USER;" 2>/dev/null
sudo -u postgres psql -d "$RUVECTOR_DB" -c "GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO $RUVECTOR_USER;" 2>/dev/null

# ============================================================================
# Phase 5: Export Environment and Verify
# ============================================================================

echo "[5/5] Verifying RuVector installation..."

# Get stats
STATS=$(sudo -u postgres psql -d "$RUVECTOR_DB" -t -c "
    SELECT json_build_object(
        'tables', (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'),
        'hnsw_indexes', (SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public' AND indexdef LIKE '%hnsw%'),
        'vector_extension', (SELECT extversion FROM pg_extension WHERE extname = 'vector')
    );
" 2>/dev/null | tr -d ' \n')

echo "  RuVector Stats: $STATS"

# Export connection info for skills
cat > /tmp/ruvector-env.sh << ENVFILE
# RuVector Environment (source this file)
export RUVECTOR_PG_CONNINFO="$RUVECTOR_PG_CONNINFO"
export RUVECTOR_HOST="localhost"
export RUVECTOR_PORT="$RUVECTOR_PORT"
export RUVECTOR_USER="$RUVECTOR_USER"
export RUVECTOR_PASSWORD="$RUVECTOR_PASSWORD"
export RUVECTOR_DB="$RUVECTOR_DB"
export DATABASE_URL="postgresql://$RUVECTOR_USER:$RUVECTOR_PASSWORD@localhost:$RUVECTOR_PORT/$RUVECTOR_DB"
ENVFILE

# Copy to standard locations if writable
cp /tmp/ruvector-env.sh /etc/profile.d/ruvector.sh 2>/dev/null || true
cp /tmp/ruvector-env.sh /home/devuser/.ruvector-env 2>/dev/null && \
    chown devuser:devuser /home/devuser/.ruvector-env 2>/dev/null || true

echo ""
echo "=== RuVector Initialization Complete ==="
echo "Connection: $RUVECTOR_PG_CONNINFO"
echo ""
echo "To connect:"
echo "  psql \"$RUVECTOR_PG_CONNINFO\""
echo ""
echo "Environment exported to:"
echo "  /etc/profile.d/ruvector.sh"
echo "  /home/devuser/.ruvector-env"
echo ""
