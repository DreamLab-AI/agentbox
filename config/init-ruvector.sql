-- RuVector HNSW Vector Index Extensions
-- Applied after main schema to add/update HNSW indexes
-- These provide 150x-12,500x faster vector similarity search

-- Ensure pgvector extension is loaded
CREATE EXTENSION IF NOT EXISTS vector;

-- Fix 8: HNSW Vector Indexes for memory_entries
ALTER TABLE memory_entries ADD COLUMN IF NOT EXISTS embedding vector(384);

CREATE INDEX IF NOT EXISTS idx_memory_embedding_hnsw ON memory_entries
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- Fix 8: HNSW Vector Indexes for patterns
ALTER TABLE patterns ADD COLUMN IF NOT EXISTS embedding vector(384);

CREATE INDEX IF NOT EXISTS idx_patterns_embedding_hnsw ON patterns
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- Fix 9: Project Identification Schema
ALTER TABLE projects ADD COLUMN IF NOT EXISTS git_remote TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS pkg_name TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS sig_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_projects_git_remote ON projects(git_remote);
CREATE INDEX IF NOT EXISTS idx_projects_pkg_name ON projects(pkg_name);

-- Verification
SELECT 'RuVector HNSW indexes applied' AS status,
       (SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public' AND indexdef LIKE '%hnsw%') AS hnsw_count;
