---
name: git-architect
version: 1.0.0
description: High-level repository management - semantic search, smart diffs, repo maps
author: agentic-workstation
tags: [git, repository, semantic-search, architecture, codebase-analysis]
mcp_server: true
---

# Git Architect Skill

High-level repository management tools for semantic search, intelligent diffing, and architectural analysis. Unlike granular git commands, this skill provides architect-level insights into codebases.

## Overview

Git Architect transforms raw git data into architectural insights. It helps you understand:
- Repository structure and token-optimized views
- Smart diffs that exclude noise (lockfiles, generated code)
- File evolution and collaboration patterns
- Codebase hotspots and technical debt indicators
- Contributor patterns and code ownership

## Tools

### Repository Structure

#### `repo_map`
Generate a token-optimized repository tree view.

```json
{
  "path": ".",
  "max_depth": 3,
  "show_size": false,
  "ignore_patterns": ["node_modules", "*.lock", "dist"]
}
```

Returns a hierarchical view with optional file sizes, optimized for LLM context windows.

#### `find_large_files`
Identify large files that may bloat the repository.

```json
{
  "path": ".",
  "top_n": 10,
  "threshold_kb": 100
}
```

Helps identify candidates for Git LFS or cleanup.

### Intelligent Diffs

#### `smart_diff`
Context-aware diffs that exclude noise.

```json
{
  "base": "main",
  "exclude": ["*.lock", "node_modules", "dist", "build"]
}
```

Automatically filters:
- Lockfiles (package-lock.json, yarn.lock, Cargo.lock)
- Dependencies (node_modules, vendor)
- Generated code (dist, build, .next, target)
- Binary files

#### `branch_diff`
Compare two branches at a high level.

```json
{
  "branch1": "main",
  "branch2": "feature/new-api"
}
```

Returns:
- Files changed
- Commit count
- Authors involved
- Change summary

### File Evolution

#### `file_history`
Track how a file evolved over time.

```json
{
  "file": "src/core/api.ts",
  "limit": 10,
  "stat": true
}
```

Shows commit history with optional change statistics.

#### `blame_summary`
Aggregated authorship analysis.

```json
{
  "file": "src/core/api.ts"
}
```

Groups line ownership by author with percentages, more useful than line-by-line blame.

#### `hotspots`
Find most frequently changed files.

```json
{
  "path": ".",
  "limit": 10
}
```

High change frequency may indicate:
- Core business logic
- Technical debt
- API boundaries
- Bug-prone areas

### Collaboration Analysis

#### `contributors`
Understand who works on what.

```json
{
  "path": "src/frontend"
}
```

Returns contributor statistics for a directory.

#### `file_co_changes`
Discover files that change together.

```json
{
  "file": "src/api/handler.ts",
  "limit": 10
}
```

Helps identify:
- Hidden dependencies
- Module coupling
- Test coverage patterns

### Time-Based Analysis

#### `recent_changes`
What changed recently?

```json
{
  "days": 7,
  "author": "user@example.com"
}
```

Filter by author to track individual contributions.

#### `commit_stats`
Repository activity statistics.

```json
{
  "since": "2024-01-01",
  "until": "2024-12-31"
}
```

Provides:
- Commit frequency
- Author activity
- File churn metrics
- Lines changed over time

#### `stale_branches`
Find abandoned branches.

```json
{
  "days": 30
}
```

Helps with repository hygiene.

### Search

#### `search_commits`
Semantic commit message search.

```json
{
  "query": "fix authentication bug",
  "limit": 20
}
```

Uses git log grep for fast searching.

## Semantic Search Setup

For advanced semantic search capabilities, integrate with vector databases:

### Option 1: ChromaDB Integration

```python
# In your Claude Code environment
from chromadb import Client
import git

# Index commits
client = Client()
collection = client.create_collection("commits")

repo = git.Repo(".")
for commit in repo.iter_commits():
    collection.add(
        ids=[commit.hexsha],
        documents=[f"{commit.message}\n\n{commit.stats.files}"],
        metadatas=[{
            "author": commit.author.name,
            "date": str(commit.committed_datetime)
        }]
    )

# Semantic search
results = collection.query(
    query_texts=["authentication refactor"],
    n_results=5
)
```

### Option 2: AgentDB Integration

```python
# Use AgentDB for persistent memory
from agentdb import AgentDB

db = AgentDB("repo-memory.db")
db.store_commits(repo_path=".")

# Query with natural language
similar = db.find_similar_commits(
    "implement new API endpoint",
    limit=10
)
```

## Token Optimization

### Smart Filtering

All tools use intelligent defaults to minimize token usage:

1. **Exclude Patterns**: `node_modules`, `.git`, `__pycache__`, `*.lock`, `dist`, `build`, `.next`, `target`
2. **Binary Detection**: Automatically skip binary files in diffs
3. **Depth Limiting**: Configurable tree depth for `repo_map`
4. **Summary Modes**: Aggregate data (blame_summary) vs. raw output

### Best Practices

```python
# Instead of full diff
full_diff = git diff  # May be 10K+ tokens

# Use smart_diff
smart = tools.smart_diff(base="main")  # Filtered, ~500 tokens

# Instead of full tree
tree = git ls-tree -r HEAD  # Every file

# Use repo_map
map = tools.repo_map(max_depth=2, show_size=False)  # Hierarchical view
```

## Usage Examples

### Analyze Feature Branch

```python
# Compare to main
diff = tools.branch_diff("main", "feature/auth")

# Find hotspots in changed areas
for file in diff['files_changed']:
    history = tools.file_history(file, limit=5)
    co_changes = tools.file_co_changes(file)
```

### Code Review Assistant

```python
# Get smart diff
changes = tools.smart_diff(base="main")

# Find related files
for changed_file in changes:
    related = tools.file_co_changes(changed_file)

# Check contributor context
contributors = tools.contributors(path="src/")
```

### Repository Health Check

```python
# Find technical debt indicators
hotspots = tools.hotspots(limit=20)
large_files = tools.find_large_files(threshold_kb=500)
stale = tools.stale_branches(days=60)

# Analyze activity
stats = tools.commit_stats(since="2024-01-01")
recent = tools.recent_changes(days=30)
```

### Find Relevant Context

```python
# Search commit history
bug_fixes = tools.search_commits("fix bug", limit=50)

# Get file evolution
for commit in bug_fixes:
    for file in commit.files:
        history = tools.file_history(file)
        blame = tools.blame_summary(file)
```

## Integration with Claude Code

This skill is designed to work seamlessly with Claude Code workflows:

```javascript
// In your agent coordination
mcp__git-architect__repo_map({
  path: "src/",
  max_depth: 3,
  ignore_patterns: ["*.test.ts", "*.spec.ts"]
})

// Smart context gathering
mcp__git-architect__smart_diff({
  base: "main",
  exclude: ["package-lock.json", "dist"]
})

// Track impact
mcp__git-architect__file_co_changes({
  file: "src/core/api.ts"
})
```

## Advanced Patterns

### Architectural Boundaries

```python
# Detect module coupling
def analyze_coupling(module_path):
    hotspots = tools.hotspots(path=module_path)

    coupling_map = {}
    for file in hotspots:
        co_changes = tools.file_co_changes(file)
        coupling_map[file] = co_changes

    return coupling_map
```

### Change Impact Analysis

```python
# Predict test requirements
def test_coverage_needed(changed_files):
    impact = []

    for file in changed_files:
        # Find related files
        related = tools.file_co_changes(file, limit=20)

        # Check history for bug patterns
        history = tools.file_history(file, limit=50)

        # Calculate risk score
        risk = len(related) * 0.5 + len(history) * 0.3
        impact.append({"file": file, "risk": risk})

    return sorted(impact, key=lambda x: x["risk"], reverse=True)
```

### Knowledge Graph

```python
# Build repository knowledge graph
def build_repo_graph():
    contributors = tools.contributors(".")
    hotspots = tools.hotspots(limit=50)

    graph = {
        "files": {},
        "people": contributors,
        "edges": []
    }

    for file in hotspots:
        co_changes = tools.file_co_changes(file)
        blame = tools.blame_summary(file)

        graph["files"][file] = {
            "owners": blame,
            "related": co_changes
        }

        for related in co_changes:
            graph["edges"].append({
                "from": file,
                "to": related,
                "type": "co_changes"
            })

    return graph
```

## Performance Considerations

- **repo_map**: O(n) where n = files, but depth-limited
- **smart_diff**: O(m) where m = changed files (filtered)
- **hotspots**: O(n*log(n)) for sorting commit history
- **file_co_changes**: O(k) where k = commits touching file
- **search_commits**: Uses git's native grep (fast)

## Limitations

- Requires git repository (checks .git directory)
- Large repositories (100K+ commits) may be slow for full history
- Binary file detection is heuristic-based
- Co-change analysis limited to default branch

## Future Enhancements

- Vector database integration for semantic search
- Graphical repository visualization
- Machine learning for bug prediction
- Integration with code quality tools
- Cross-repository analysis
- Temporal pattern detection

## See Also

- **agentic-jujutsu**: For advanced version control workflows
- **github-code-review**: For PR-specific analysis
- **swarm-orchestration**: For multi-agent repository analysis
- **agentdb-vector-search**: For semantic code search
