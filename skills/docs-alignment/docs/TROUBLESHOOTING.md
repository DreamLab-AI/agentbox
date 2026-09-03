# Troubleshooting Guide

## Common Issues

### Installation Issues

#### Python Dependencies Not Found

**Symptoms**: `ModuleNotFoundError` when running the still-Python
`archive_working_docs.py` / `scan_stubs.py` steps (the other five
validators are Rust binaries with no Python dependency)

**Solution**:
```bash
cd <agentbox>/skills/docs-alignment
pip install -r requirements.txt
```

#### Mermaid CLI Not Available

**Symptoms**: Warning about `mmdc` not found

**Solution**:
```bash
npm install -g @mermaid-js/mermaid-cli
mmdc --version  # Verify installation
```

### Validation Errors

#### All Links Reported as Broken

**Symptoms**: Every link shows as broken, even valid ones

**Causes**:
1. Wrong project root specified
2. Documentation not in expected location

**Solution**:
```bash
# Verify project structure
ls -la /path/to/project/docs

# Run with explicit docs directory
docs-validate-links --root /path/to/project --docs-dir docs
```

#### Mermaid Diagrams All Invalid

**Symptoms**: All mermaid diagrams reported as invalid

**Causes**:
1. Mermaid CLI not installed
2. Using outdated mermaid syntax

**Solution**:
```bash
# Install mermaid CLI
npm install -g @mermaid-js/mermaid-cli

# Check for syntax updates
# Old: graph TD
# New: flowchart TD (recommended)
```

#### False Positives in ASCII Detection

**Symptoms**: Tables detected as ASCII diagrams

**Solution**:
```bash
# Increase minimum lines threshold
docs-detect-ascii --root docs --min-lines 5
```

### Permission Issues

#### Cannot Create Archive Directory

**Symptoms**: `PermissionError` when running archiver

**Solution**:
```bash
# Create directory manually
mkdir -p docs/archive
chmod 755 docs/archive
```

#### Cannot Write Report

**Symptoms**: `PermissionError` when generating report

**Solution**:
```bash
# Check file permissions
ls -la docs/

# Create with proper permissions
touch docs/DOCUMENTATION_ISSUES.md
chmod 644 docs/DOCUMENTATION_ISSUES.md
```

### Performance Issues

#### Script Takes Too Long

**Symptoms**: Script runs for more than 10 minutes

**Causes**:
1. Very large codebase
2. Checking external URLs
3. Deep directory nesting

**Solutions**:
```bash
# Skip external URL checks
docs-validate-links --root .  # omit --check-external to skip external URL checks

# Use exclusion patterns
docs-validate-links --ignore node_modules target .git

# Run individual scripts instead of full alignment
docs-validate-links --root .
docs-check-mermaid --root docs
```

#### Memory Errors

**Symptoms**: `MemoryError` or script killed by OOM

**Solutions**:
```bash
# Process in batches
docs-validate-links --batch-size 100

# Run scripts individually
for bin in docs-validate-links docs-check-mermaid docs-detect-ascii; do
  "$bin" --root . --output "${bin}.json"
done
```

### Swarm Issues

#### Agents Not Spawning

**Symptoms**: `Task` tool returns without spawning agents

**Solution**:
```bash
# Verify claude-flow installation
npx claude-flow@alpha --version

# Initialize swarm first
npx claude-flow@alpha swarm init --topology mesh
```

#### Memory Coordination Failures

**Symptoms**: Agents cannot read results from other agents

**Solution**:
```bash
# Check memory status
npx claude-flow@alpha memory list --prefix "swarm/"

# Manually store test data
npx claude-flow@alpha memory set "test/key" '{"test": true}'
npx claude-flow@alpha memory get "test/key"
```

## Debugging

### Enable Verbose Output

```bash
# Python scripts
docs-validate-links --root . --verbose

# View detailed logs
docs-alignment --project-root . --debug
```

### Check Intermediate Reports

```bash
# Reports are saved in .doc-alignment-reports/
ls -la .doc-alignment-reports/

# View individual report
cat .doc-alignment-reports/link-report.json | jq .
```

### Validate JSON Output

```bash
# Check if report is valid JSON
python3 -m json.tool .doc-alignment-reports/link-report.json

# Pretty print
jq . .doc-alignment-reports/link-report.json
```

## Getting Help

If issues persist:

1. Check the logs in `.doc-alignment-reports/`
2. Run with `--debug` flag
3. Create a minimal reproduction case
4. File an issue with:
   - Python version
   - OS and version
   - Complete error message
   - Relevant file structure
