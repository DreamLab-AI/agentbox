---
name: text-processing
version: 1.0.0
description: High-performance text processing with jq, yq, ripgrep, awk for massive log/JSON files
author: agentic-workstation
tags: [jq, yq, ripgrep, rg, awk, json, yaml, logs, grep, text]
mcp_server: true
---

# Text Processing Skill

High-performance text processing tools optimized for massive files (100MB+). Token-efficient streaming operations without loading full files into memory.

## Overview

Process gigabyte-scale files efficiently with industry-standard tools:
- **jq** - JSON processing and transformation
- **yq** - YAML query and manipulation
- **ripgrep (rg)** - Ultra-fast regex search (10x faster than grep)
- **awk** - Pattern scanning and text processing
- **Log slicing** - Time-windowed log extraction
- **Stream utilities** - head, tail, unique, column extraction

All operations use streaming/subprocess pipes to minimize memory usage and maximize token efficiency.

## Tools Overview

### JSON Processing (jq)
- `jq_query` - Query JSON files with jq syntax
- `jq_slurp` - Process multiple JSON files together

### YAML Processing (yq)
- `yq_query` - Query YAML files with yq syntax

### Search & Replace (ripgrep)
- `rg_search` - Ultra-fast pattern search with context
- `rg_files` - List files containing pattern
- `rg_count` - Count matches per file
- `rg_replace` - Search and replace with dry-run

### Text Processing (awk)
- `awk_run` - Execute awk programs on files

### Log Processing
- `log_slice` - Extract time-windowed log segments
- `head_lines` - First N lines
- `tail_lines` - Last N lines

### Utilities
- `unique_lines` - Deduplicate with optional counts
- `column_extract` - Extract specific columns
- `wc_stats` - File statistics (lines, words, bytes)

## Performance Tips

1. **Use ripgrep over grep**: 10-100x faster on large files
2. **Stream processing**: All tools use pipes, never load full files
3. **Filter early**: Combine tools (rg | jq | awk) to reduce data volume
4. **Type filters**: Use `--type` with ripgrep to skip irrelevant files
5. **Limit output**: Use `max_count` and `head_lines` to control result size
6. **Dry-run first**: Always test replacements with `dry_run=true`

## Example Workflows

### Extract errors from last hour of logs
```python
log_slice(
    file="/var/log/app.log",
    start="1h ago",
    pattern="ERROR|FATAL"
)
```

### Find API latency over 1s in JSON logs
```python
jq_query(
    file="access.log.json",
    query='select(.response_time > 1000) | {timestamp, url, response_time}'
)
```

### Count occurrences of each error code
```python
rg_search(
    pattern='error_code":\s*"([A-Z0-9]+)"',
    path="logs/",
    type="json"
) | unique_lines(count=True)
```

### Extract user IDs from column 3
```python
column_extract(
    file="data.csv",
    columns="3",
    delimiter=","
)
```

### Complex transformation with awk
```python
awk_run(
    file="data.log",
    program='$5 > 100 { sum += $5; count++ } END { print sum/count }'
)
```

### Search and replace API endpoints
```python
rg_replace(
    pattern='api/v1/',
    replacement='api/v2/',
    path="src/",
    dry_run=True  # Review changes first
)
```

### Process multiple JSON files together
```python
jq_slurp(
    files=["day1.json", "day2.json", "day3.json"],
    query='[.[] | select(.status == "error")] | length'
)
```

### YAML configuration query
```python
yq_query(
    file="config.yaml",
    query='.services[] | select(.enabled == true) | .name'
)
```

## Common Patterns

### Log Analysis Pipeline
```bash
# 1. Find relevant logs
rg_search(pattern="payment_failed", type="log")

# 2. Extract JSON fields
jq_query(query='{user_id, amount, error_code}')

# 3. Count by error code
awk_run(program='{codes[$3]++} END {for(c in codes) print c, codes[c]}')
```

### Data Cleaning
```bash
# 1. Extract column
column_extract(columns="2,4", delimiter=",")

# 2. Remove duplicates
unique_lines(count=False)

# 3. Get statistics
wc_stats()
```

### Performance Monitoring
```bash
# 1. Slice last hour
log_slice(start="1h ago")

# 2. Extract response times
rg_search(pattern="response_time=([0-9]+)")

# 3. Calculate percentiles
awk_run(program='percentile calculation')
```

## Tool Reference

### jq_query
Query JSON files with jq syntax. Streams output for large files.

**Parameters:**
- `file` (str): Path to JSON file
- `query` (str): jq query expression
- `raw` (bool): Raw output without JSON formatting

**Examples:**
```python
# Extract specific fields
jq_query(file="data.json", query='.users[] | {id, name}')

# Filter and transform
jq_query(file="logs.json", query='select(.level == "error") | .message')

# Complex aggregation
jq_query(file="stats.json", query='group_by(.category) | map({category: .[0].category, count: length})')
```

### rg_search
Ultra-fast regex search using ripgrep.

**Parameters:**
- `pattern` (str): Regex pattern
- `path` (str): Search path (default: ".")
- `type` (str): File type filter (json, log, py, etc.)
- `context` (int): Lines of context (0-10)
- `max_count` (int): Maximum results (default: 100)

**Examples:**
```python
# Basic search
rg_search(pattern="ERROR", path="logs/")

# With context and type filter
rg_search(pattern="exception", type="py", context=3)

# Case-insensitive
rg_search(pattern="(?i)warning", path=".")
```

### log_slice
Extract time-windowed segments from logs.

**Parameters:**
- `file` (str): Log file path
- `start` (str): Start time ("1h ago", "2023-01-01 10:00", relative/absolute)
- `end` (str): End time (optional)
- `pattern` (str): Additional grep filter
- `format` (str): Timestamp format ("auto", "iso8601", "unix", custom strftime)

**Examples:**
```python
# Last hour
log_slice(file="app.log", start="1h ago")

# Specific window
log_slice(file="app.log", start="2024-01-01 09:00", end="2024-01-01 17:00")

# With pattern filter
log_slice(file="app.log", start="30m ago", pattern="ERROR|WARN")
```

## Installation

All required tools are pre-installed in the Docker environment:
- jq (1.6+)
- yq (4.0+)
- ripgrep (13.0+)
- awk (GNU awk)

## Performance Characteristics

| Tool | Speed | Memory | Best For |
|------|-------|--------|----------|
| ripgrep | 10-100x grep | O(1) | Pattern search |
| jq | Fast | O(record) | JSON transform |
| yq | Fast | O(record) | YAML queries |
| awk | Very fast | O(1) | Column processing |
| log_slice | Medium | O(1) | Time windows |

## Best Practices

1. **Filter early in pipeline**: Use ripgrep before jq/awk
2. **Limit output size**: Always use max_count or head_lines
3. **Test patterns first**: Use small files or dry_run mode
4. **Use type filters**: Dramatically speeds up searches
5. **Combine tools**: Create efficient pipelines
6. **Stream processing**: Never cat | grep, use native tools

## Error Handling

All tools return structured errors:
```json
{
  "error": "File not found",
  "tool": "jq_query",
  "file": "missing.json",
  "suggestion": "Check file path"
}
```

## Integration Examples

### With claude-flow memory
```python
# Store search results
results = rg_search(pattern="critical", type="log")
mcp__claude_flow__memory_usage({
    "action": "store",
    "key": "critical_errors",
    "value": results
})
```

### Multi-agent log analysis
```python
# Agent 1: Find errors
errors = log_slice(start="1h ago", pattern="ERROR")

# Agent 2: Categorize
categories = jq_query(query='group_by(.error_code)')

# Agent 3: Report
summary = awk_run(program='summary statistics')
```

## Limitations

- Binary files not supported (use specialized tools)
- Very large single-line files may timeout
- Complex jq queries can be CPU-intensive
- Time parsing relies on common log formats

## See Also

- [jq Manual](https://stedolan.github.io/jq/manual/)
- [ripgrep Guide](https://github.com/BurntSushi/ripgrep/blob/master/GUIDE.md)
- [AWK Tutorial](https://www.gnu.org/software/gawk/manual/)
- [yq Documentation](https://mikefarah.gitbook.io/yq/)
