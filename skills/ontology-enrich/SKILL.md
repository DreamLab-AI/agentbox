---
name: ontology-enrich
description: Validation, enrichment, and TTL generation for Logseq ontology with VisionFlow/WebVOWL compatibility
version: 2.0.0
category: ontology
layer: 1
dependencies:
  - ontology-core
tags:
  - ontology
  - validation
  - enrichment
  - owl2
  - ttl
  - webvowl
  - perplexity
---

# Ontology Enrich Skill

## When Not To Use

- For creating new ontology schemas from scratch -- use ontology-core instead
- For general data validation unrelated to Logseq ontology -- use standard validation tools
- For VisionFlow graph rendering -- this handles data, not display

## Purpose

Validated enrichment and TTL generation for mainKnowledgeGraph corpus with VisionFlow/WebVOWL compatibility.

## Key Workflows

### 1. Validate source-domain Values

**CRITICAL**: Only 6 valid prefixes exist:

```bash
# Find invalid source-domain values
grep -rhn "source-domain::" mainKnowledgeGraph/pages/*.md | \
  sed 's/.*source-domain::\s*//' | sort | uniq -c | sort -rn

# Valid: ai, bc, mv, rb, tc, ngm
# INVALID: blockchain, metaverse, telecollaboration, data, etc.
```

**Fix invalid values**:
```bash
# blockchain -> bc
grep -rln "source-domain:: blockchain" mainKnowledgeGraph/pages/*.md | \
  xargs -I {} sed -i 's/source-domain:: blockchain/source-domain:: bc/g' {}

# metaverse -> mv
grep -rln "source-domain:: metaverse" mainKnowledgeGraph/pages/*.md | \
  xargs -I {} sed -i 's/source-domain:: metaverse/source-domain:: mv/g' {}

# telecollaboration -> tc
grep -rln "source-domain:: telecollaboration" mainKnowledgeGraph/pages/*.md | \
  xargs -I {} sed -i 's/source-domain:: telecollaboration/source-domain:: tc/g' {}
```

### 2. Generate TTL

```bash
python3 Ontology-Tools/tools/converters/convert-to-turtle.py \
  mainKnowledgeGraph/pages/ \
  output/ontology.ttl
```

**Output**: Single `output/ontology.ttl` (git provides versioning)

### 3. Validate TTL for WebVOWL

```bash
# Check @prefix comes first (REQUIRED for format detection)
head -5 output/ontology.ttl | grep "@prefix"

# Check for unbound prefixes
grep -n "blockchain:\|metaverse:\|telecollaboration:\|data:" output/ontology.ttl

# Check for illegal characters in local names
grep -n "&\|(\|)" output/ontology.ttl | grep -v "rdfs:comment\|rdfs:label"
```

### 4. Enrich with Perplexity (Optional)

```bash
# Use perplexity-research skill for stub pages
# Query format for UK English context:
python -c "
from perplexity_client import query
result = query('''
Context: UK-based AI/Blockchain ontology documentation.
Task: Define {TERM} with technical accuracy.
Include: key components, relationships, UK context.
Output: 2-3 sentence definition suitable for ontology.
''')
"
```

## Common Issues and Fixes

### WebVOWL Parser Errors

| Error | Root Cause | Fix |
|-------|-----------|-----|
| `Prefix "X:" not bound` | Invalid source-domain value | Use valid 2-letter prefix |
| `Prefix ":" not bound` | Bare colon in property decls | Use `ngm:` prefix for properties |
| `Bad syntax (']' expected)` | `&` in WikiLink target | sanitize_local_name() |
| `unexpected token '#'` | Comments before @prefix | @prefix MUST be line 1 |
| `Encountered '['` | WikiLinks in definition | sanitize_literal() |

### Fixing Malformed Pages

```bash
# Find pages with all fields on one line
grep -l "ontology:: true.*term-id::" mainKnowledgeGraph/pages/*.md

# Find pages with & in relationships
grep -rn "enables.*&\|requires.*&\|has-part.*&" mainKnowledgeGraph/pages/*.md
```

## Relationship Best Practices

### is-subclass-of targets must exist

```bash
# Check for orphan relationships
grep -rn "is-subclass-of::" mainKnowledgeGraph/pages/*.md | \
  sed 's/.*\[\[\([^]]*\)\]\].*/\1/' | sort | uniq | \
  while read term; do
    if ! ls "mainKnowledgeGraph/pages/$term.md" 2>/dev/null; then
      echo "ORPHAN: $term"
    fi
  done
```

### Cross-cutting with belongsToDomain

```markdown
- belongsToDomain:: [[AIApplicationsDomain]], [[DisruptiveTechDomain]]
```

Use for cross-domain classification without changing `source-domain`.

## Deployment Workflow

```yaml
# .github/workflows/publish.yml
- name: Generate ontology files
  run: |
    if [ -f "output/ontology.ttl" ]; then
      cp output/ontology.ttl /tmp/narrativegoldmine-ontology.ttl
      echo "Using output/ontology.ttl"
    else
      echo "ERROR: output/ontology.ttl not found"
      exit 1
    fi
```

## Integration with VisionFlow

VisionFlow's `github_sync_service.rs` expects:

| Field | Required | Format |
|-------|----------|--------|
| `### OntologyBlock` | Yes | Markdown heading |
| `term-id::` | Yes | `DOMAIN-NNNN` |
| `owl:class::` | Yes | `domain:ClassName` |
| `source-domain::` | Yes | 2-letter code |
| `public-access::` | Yes | `true` or `false` |
| `definition::` | Yes | Clean text (no WikiLinks) |

## Quick Validation Script

```bash
#!/bin/bash
# validate-ontology.sh

echo "=== Checking source-domain values ==="
grep -rhn "source-domain::" mainKnowledgeGraph/pages/*.md | \
  sed 's/.*source-domain::\s*//' | sort | uniq -c | sort -rn

echo "=== Regenerating TTL ==="
python3 Ontology-Tools/tools/converters/convert-to-turtle.py \
  mainKnowledgeGraph/pages/ output/ontology.ttl

echo "=== Checking for unbound prefixes ==="
grep -c "blockchain:\|metaverse:\|data:" output/ontology.ttl && \
  echo "ERROR: Unbound prefixes found" || echo "OK: No unbound prefixes"

echo "=== Verifying @prefix first ==="
head -1 output/ontology.ttl | grep -q "@prefix" && \
  echo "OK: @prefix is first" || echo "ERROR: @prefix not first"
```

## References

- Converter: `Ontology-Tools/tools/converters/convert-to-turtle.py`
- Workflow: `.github/workflows/publish.yml`
- TTL Output: `output/ontology.ttl`
- Domain pages: `mainKnowledgeGraph/pages/*Domain.md`
