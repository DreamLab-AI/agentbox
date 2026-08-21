# AgentDB Vector Search — CLI Cookbook

Commands for initialising, querying, and importing/exporting vector databases from the CLI.

## Initialize Vector Database

```bash
# Initialize with default dimensions (1536 for OpenAI ada-002)
npx agentdb@latest init ./vectors.db

# Custom dimensions for different embedding models
npx agentdb@latest init ./vectors.db --dimension 768  # sentence-transformers
npx agentdb@latest init ./vectors.db --dimension 384  # all-MiniLM-L6-v2

# Use preset configurations
npx agentdb@latest init ./vectors.db --preset small   # <10K vectors
npx agentdb@latest init ./vectors.db --preset medium  # 10K-100K vectors
npx agentdb@latest init ./vectors.db --preset large   # >100K vectors

# In-memory database for testing
npx agentdb@latest init ./vectors.db --in-memory
```

## Query Vector Database

```bash
# Basic similarity search
npx agentdb@latest query ./vectors.db "[0.1,0.2,0.3,...]"

# Top-k results
npx agentdb@latest query ./vectors.db "[0.1,0.2,0.3]" -k 10

# With similarity threshold (cosine similarity)
npx agentdb@latest query ./vectors.db "0.1 0.2 0.3" -t 0.75 -m cosine

# Different distance metrics
npx agentdb@latest query ./vectors.db "[...]" -m euclidean  # L2 distance
npx agentdb@latest query ./vectors.db "[...]" -m dot        # Dot product

# JSON output for automation
npx agentdb@latest query ./vectors.db "[...]" -f json -k 5

# Verbose output with distances
npx agentdb@latest query ./vectors.db "[...]" -v
```

## Import/Export Vectors

```bash
# Export vectors to JSON
npx agentdb@latest export ./vectors.db ./backup.json

# Import vectors from JSON
npx agentdb@latest import ./backup.json

# Get database statistics
npx agentdb@latest stats ./vectors.db
```

## Database Statistics

```bash
# Get comprehensive stats
npx agentdb@latest stats ./vectors.db

# Shows:
# - Total patterns/vectors
# - Database size
# - Average confidence
# - Domains distribution
# - Index status
```

## Learn More

- CLI Help: `npx agentdb@latest --help`
- Command Help: `npx agentdb@latest help <command>`
- See [AgentDB Overview](../../agentdb-advanced/docs/agentdb-overview.md#links) for general links.
