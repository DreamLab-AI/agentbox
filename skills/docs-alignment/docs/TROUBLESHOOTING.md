# Troubleshooting Guide

## Common Issues

### Installation Issues

#### Python Dependencies Not Found

**Symptoms**: `ModuleNotFoundError` when running scripts

**Solution**:
```bash
cd multi-agent-docker/skills/docs-alignment
pip install -r scripts/requirements.txt
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
python validate_links.py --root /path/to/project --docs-dir docs
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
python detect_ascii.py --root docs --min-lines 5
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
python validate_links.py --no-external

# Use exclusion patterns
python validate_links.py --ignore node_modules target .git

# Run individual scripts instead of full alignment
python validate_links.py --root .
python check_mermaid.py --root docs
```

#### Memory Errors

**Symptoms**: `MemoryError` or script killed by OOM

**Solutions**:
```bash
# Process in batches
python validate_links.py --batch-size 100

# Run scripts individually
for script in validate_links.py check_mermaid.py detect_ascii.py; do
  python "$script" --root . --output "${script%.py}.json"
done
```

### Swarm Issues

#### Agents Not Spawning

**Symptoms**: `Task` tool returns without spawning agents

**Solution**:
```bash
# Verify claude-flow installation
claude-flow --version

# Initialize swarm first
claude-flow swarm init --topology mesh
```

#### Memory Coordination Failures

**Symptoms**: Agents cannot read results from other agents

**Solution**:
```bash
# Check memory status
claude-flow memory list --prefix "swarm/"

# Manually store test data
claude-flow memory set "test/key" '{"test": true}'
claude-flow memory get "test/key"
```

## Debugging

### Enable Verbose Output

```bash
# Python scripts
python validate_links.py --root . --verbose

# View detailed logs
python docs_alignment.py --project-root . --debug
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
python -m json.tool .doc-alignment-reports/link-report.json

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
