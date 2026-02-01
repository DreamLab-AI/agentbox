-- RuVector Unified Memory Schema for Claude Flow V3
-- PostgreSQL + pgvector with HNSW indexing
-- NOT standard PostgreSQL - custom vector memory store optimized for AI workloads

-- Install pgvector extension (required for vector operations)
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- Core Memory Storage (memory_entries)
-- Main storage for all agent memory with vector embeddings
-- ============================================================================

CREATE TABLE IF NOT EXISTS memory_entries (
    id SERIAL PRIMARY KEY,
    key VARCHAR(512) UNIQUE NOT NULL,
    namespace VARCHAR(128) DEFAULT 'default',
    type VARCHAR(32) NOT NULL DEFAULT 'persistent',
    value JSONB NOT NULL,
    embedding vector(384),  -- all-MiniLM-L6-v2 dimensions
    embedding_json JSONB,   -- JSON fallback for embedding storage
    metadata JSONB DEFAULT '{}',
    tags TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE,
    agent_id VARCHAR(128),
    session_id VARCHAR(128),
    project_id INTEGER
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_memory_namespace ON memory_entries(namespace);
CREATE INDEX IF NOT EXISTS idx_memory_type ON memory_entries(type);
CREATE INDEX IF NOT EXISTS idx_memory_agent ON memory_entries(agent_id);
CREATE INDEX IF NOT EXISTS idx_memory_session ON memory_entries(session_id);
CREATE INDEX IF NOT EXISTS idx_memory_created ON memory_entries(created_at);
CREATE INDEX IF NOT EXISTS idx_memory_expires ON memory_entries(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_memory_metadata ON memory_entries USING gin(metadata);
CREATE INDEX IF NOT EXISTS idx_memory_tags ON memory_entries USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_memory_project ON memory_entries(project_id);

-- HNSW index for vector similarity search (150x-12,500x faster than brute force)
-- m=16: connections per layer, ef_construction=64: quality during build
CREATE INDEX IF NOT EXISTS idx_memory_embedding_hnsw
    ON memory_entries USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ============================================================================
-- Project Tracking (projects)
-- Track different projects/repositories for memory isolation
-- ============================================================================

CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    name VARCHAR(256) UNIQUE NOT NULL,
    path VARCHAR(1024),
    git_remote TEXT,
    pkg_name TEXT,
    sig_hash TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);
CREATE INDEX IF NOT EXISTS idx_projects_git_remote ON projects(git_remote);
CREATE INDEX IF NOT EXISTS idx_projects_pkg_name ON projects(pkg_name);

-- ============================================================================
-- ReasoningBank Pattern Storage (reasoning_patterns)
-- Store learned patterns for agent decision making
-- ============================================================================

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

-- ============================================================================
-- Pattern Storage (patterns)
-- General pattern storage for hooks and learning
-- ============================================================================

CREATE TABLE IF NOT EXISTS patterns (
    id SERIAL PRIMARY KEY,
    pattern_key VARCHAR(512) UNIQUE NOT NULL,
    pattern_type VARCHAR(64) NOT NULL,
    content TEXT,
    embedding vector(384),
    confidence FLOAT DEFAULT 0.5,
    usage_count INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_patterns_key ON patterns(pattern_key);
CREATE INDEX IF NOT EXISTS idx_patterns_p_type ON patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_patterns_p_embedding_hnsw
    ON patterns USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ============================================================================
-- SONA Trajectory Tracking (sona_trajectories)
-- Track agent learning trajectories for reinforcement learning
-- ============================================================================

CREATE TABLE IF NOT EXISTS sona_trajectories (
    id SERIAL PRIMARY KEY,
    trajectory_id VARCHAR(128) UNIQUE NOT NULL,
    agent_id VARCHAR(128),
    task_description TEXT,
    steps JSONB DEFAULT '[]',
    success BOOLEAN,
    feedback TEXT,
    quality_score FLOAT,
    reward FLOAT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_trajectories_agent ON sona_trajectories(agent_id);
CREATE INDEX IF NOT EXISTS idx_trajectories_success ON sona_trajectories(success);
CREATE INDEX IF NOT EXISTS idx_trajectories_quality ON sona_trajectories(quality_score DESC);

-- ============================================================================
-- Session State Persistence (session_state)
-- Store and restore agent sessions
-- ============================================================================

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

CREATE INDEX IF NOT EXISTS idx_session_name ON session_state(name);

-- ============================================================================
-- Agent Routing History (routing_history)
-- Track agent routing decisions for learning optimization
-- ============================================================================

CREATE TABLE IF NOT EXISTS routing_history (
    id SERIAL PRIMARY KEY,
    task_hash VARCHAR(64),
    task_description TEXT,
    selected_agent VARCHAR(128),
    alternatives JSONB DEFAULT '[]',
    confidence FLOAT,
    success BOOLEAN,
    feedback TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_routing_task ON routing_history(task_hash);
CREATE INDEX IF NOT EXISTS idx_routing_agent ON routing_history(selected_agent);
CREATE INDEX IF NOT EXISTS idx_routing_success ON routing_history(success);

-- ============================================================================
-- Functions and Triggers
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to all tables with updated_at
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN SELECT table_name FROM information_schema.columns
             WHERE column_name = 'updated_at'
             AND table_schema = 'public'
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS update_%I_modtime ON %I', t, t);
        EXECUTE format('CREATE TRIGGER update_%I_modtime
                       BEFORE UPDATE ON %I
                       FOR EACH ROW EXECUTE FUNCTION update_modified_column()', t, t);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Permissions (grant to all users in container)
-- ============================================================================

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO PUBLIC;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC;

-- ============================================================================
-- Verification
-- ============================================================================

SELECT 'RuVector unified memory schema initialized' AS status,
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public') AS table_count,
       (SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public' AND indexdef LIKE '%hnsw%') AS hnsw_indexes;
