# Advanced Configuration

## Custom Swarm Topologies

### Hierarchical Topology (Large Codebases)

For projects with 1000+ documentation files, use hierarchical topology with queen coordination:

```bash
# Initialize hierarchical swarm
npx claude-flow@alpha swarm init \
  --topology hierarchical \
  --agents 12 \
  --strategy adaptive

# Spawn queen coordinator
npx claude-flow@alpha agent spawn \
  --type coordinator \
  --name "queen-doc-aligner" \
  --capabilities "orchestration,memory,reporting"

# Spawn worker agents
for agent in link-validator mermaid-checker ascii-detector archiver stub-scanner readme-integrator; do
  npx claude-flow@alpha agent spawn \
    --type specialist \
    --name "$agent" \
    --capabilities "analysis,memory"
done
```

### Mesh Topology (Parallel Execution)

For smaller projects or when speed is critical:

```bash
npx claude-flow@alpha swarm init \
  --topology mesh \
  --agents 8 \
  --strategy balanced
```

## Custom Validation Rules

### Link Validation Customisation

Create a custom configuration file:

```json
{
  "ignore_patterns": [
    "node_modules",
    ".git",
    "target",
    "__pycache__",
    "*.test.md"
  ],
  "external_url_timeout": 5,
  "check_anchors": true,
  "severity_levels": {
    "broken_internal": "error",
    "broken_external": "warning",
    "orphan_doc": "info"
  }
}
```

### Mermaid Validation Options

```json
{
  "strict_mode": true,
  "allowed_diagram_types": [
    "flowchart",
    "sequenceDiagram",
    "classDiagram",
    "stateDiagram"
  ],
  "github_compatibility_check": true,
  "max_diagram_size": 5000
}
```

## Integration with CI/CD

### GitHub Actions Workflow

```yaml
name: Documentation Validation

on:
  pull_request:
    paths:
      - 'docs/**'
      - '*.md'

jobs:
  validate-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: |
          pip install -r multi-agent-docker/skills/docs-alignment/scripts/requirements.txt

      - name: Run documentation alignment
        run: |
          python multi-agent-docker/skills/docs-alignment/scripts/docs_alignment.py \
            --project-root . \
            --output-dir ./doc-reports

      - name: Upload report
        uses: actions/upload-artifact@v4
        with:
          name: doc-alignment-report
          path: docs/DOCUMENTATION_ISSUES.md
```

### GitLab CI Configuration

```yaml
documentation-check:
  stage: test
  image: python:3.11
  script:
    - pip install -r multi-agent-docker/skills/docs-alignment/scripts/requirements.txt
    - python multi-agent-docker/skills/docs-alignment/scripts/docs_alignment.py --project-root .
  artifacts:
    paths:
      - docs/DOCUMENTATION_ISSUES.md
    expire_in: 1 week
  only:
    changes:
      - docs/**/*
      - "*.md"
```

## Memory Coordination

### Swarm Memory Keys

When using the swarm system, agents store results in these memory keys:

| Key | Agent | Content |
|-----|-------|---------|
| `swarm/link-validator/results` | link-validator | Broken links, orphans |
| `swarm/mermaid-checker/results` | mermaid-checker | Diagram validation |
| `swarm/ascii-detector/results` | ascii-detector | ASCII diagrams found |
| `swarm/archiver/results` | archiver | Working documents |
| `swarm/stub-scanner/results` | stub-scanner | TODOs and stubs |
| `swarm/readme-integrator/results` | readme-integrator | README issues |

### Accessing Memory

```bash
# Retrieve results from memory
npx claude-flow@alpha memory get swarm/link-validator/results

# List all swarm results
npx claude-flow@alpha memory list --prefix "swarm/"
```

## Custom Report Templates

### Creating Custom Templates

1. Create a template file in `resources/templates/`:

```markdown
# {{project_name}} Documentation Report

Generated: {{timestamp}}

## Overview
{{summary}}

## Issues
{{#each issues}}
- {{this.severity}}: {{this.message}} in {{this.file}}:{{this.line}}
{{/each}}
```

2. Use with generate_report.py:

```bash
python generate_report.py \
  --template resources/templates/custom.md.hbs \
  --output custom-report.md
```

## Performance Optimisation

### Large Codebase Settings

For codebases with 10,000+ files:

```bash
# Run with parallel processing
python docs_alignment.py \
  --project-root . \
  --parallel-workers 8 \
  --batch-size 100

# Or use swarm with more agents
npx claude-flow@alpha swarm init \
  --topology mesh \
  --agents 16 \
  --strategy adaptive
```

### Memory Management

For memory-constrained environments:

```bash
# Run scripts individually with streaming output
python validate_links.py --root . --streaming
python check_mermaid.py --root docs --streaming
```

## Troubleshooting

### Script Timeouts

If scripts timeout on large codebases:

```bash
# Increase timeout (in seconds)
python docs_alignment.py --timeout 600
```

### Memory Errors

For memory errors with large files:

```bash
# Process files in smaller batches
python validate_links.py --batch-size 50
```

### Encoding Issues

For files with non-UTF-8 encoding:

```bash
# Force encoding detection
python validate_links.py --detect-encoding
```
