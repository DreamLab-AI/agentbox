-- Fix 8: HNSW Vector Indexes
ALTER TABLE memory_entries ADD COLUMN IF NOT EXISTS embedding vector(384);
ALTER TABLE patterns ADD COLUMN IF NOT EXISTS embedding vector(384);

CREATE INDEX IF NOT EXISTS idx_memory_embedding_hnsw ON memory_entries
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_patterns_embedding_hnsw ON patterns
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- Fix 9: Project Identification Schema
ALTER TABLE projects ADD COLUMN IF NOT EXISTS git_remote TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS pkg_name TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS sig_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_projects_git_remote ON projects(git_remote);
CREATE INDEX IF NOT EXISTS idx_projects_pkg_name ON projects(pkg_name);
