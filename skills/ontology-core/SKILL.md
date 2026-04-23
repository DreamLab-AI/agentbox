---
name: ontology-core
description: Foundation library for Logseq ontology manipulation with OWL2 DL TTL export
version: 2.0.0
author: Claude Code
tags: [ontology, owl2, logseq, ttl, webvowl, validation]
---

# Ontology Core Library

**Foundation for Logseq ontology manipulation with OWL2 DL TTL export.**

## When Not To Use

- For enriching or validating existing ontology data -- use ontology-enrich instead
- For general knowledge graph work unrelated to Logseq/OWL2 -- use standard RDF tools
- For VisionFlow graph rendering -- this is the data layer, not the display layer

## Overview

Production-quality ontology parsing, validation, and TTL generation for the mainKnowledgeGraph corpus targeting VisionFlow/WebVOWL compatibility.

## Valid Domain Prefixes

**CRITICAL**: Only these 6 source-domain values are valid:

| Prefix | Full Name | Namespace URI |
|--------|-----------|---------------|
| `ai` | Artificial Intelligence | `http://narrativegoldmine.com/ai#` |
| `bc` | Blockchain | `http://narrativegoldmine.com/blockchain#` |
| `mv` | Metaverse | `http://narrativegoldmine.com/metaverse#` |
| `rb` | Robotics | `http://narrativegoldmine.com/robotics#` |
| `tc` | Telecollaboration | `http://narrativegoldmine.com/telecollaboration#` |
| `ngm` | Core Ontology | `http://narrativegoldmine.com/ontology#` |

**INVALID values** (must be fixed in source):
- `blockchain` → use `bc`
- `metaverse` → use `mv`
- `telecollaboration` → use `tc`

## OntologyBlock Format (Gold Standard)

```markdown
- ### OntologyBlock
  id:: [kebab-case-slug]-ontology
  collapsed:: true
	- ontology:: true
	- term-id:: [DOMAIN]-[NNNN]
	- preferred-term:: [Title Case Term Name]
	- source-domain:: [ai|bc|mv|rb|tc|ngm]
	- status:: [draft|active|deprecated|stub]
	- public-access:: true
	- definition:: [Complete definition - NO WikiLinks, NO source:: refs]
	- maturity:: [draft|mature|stable]
	- owl:class:: [domain]:[PascalCaseClassName]
	- owl:physicality:: [ConceptualEntity|VirtualEntity|PhysicalEntity]
	- owl:role:: [Concept|Process|Agent|Artifact]
	- belongsToDomain:: [[DomainName]], [[DisruptiveTechDomain]]
	- #### Relationships
	  id:: [slug]-relationships
	  collapsed:: true
		- is-subclass-of:: [[ParentConcept]]
		- enables:: [[RelatedConcept]]
		- requires:: [[Dependency]]
```

## TTL Generation Rules

### 1. @prefix MUST come FIRST

WebVOWL format detection requires `@prefix` declarations at line 1:

```turtle
@prefix ai: <http://narrativegoldmine.com/ai#> .
@prefix bc: <http://narrativegoldmine.com/blockchain#> .
...

# Comments and metadata come AFTER prefixes
```

### 2. Local Name Sanitization

IRI fragments cannot contain special characters:

```python
def sanitize_local_name(value: str) -> str:
    """Sanitize for Turtle local name."""
    value = value.replace(' ', '')
    value = value.replace('-', '')
    value = value.replace('&', 'And')  # Analytics&Reporting -> AnalyticsAndReporting
    value = value.replace('/', '')
    value = value.replace('(', '')
    value = value.replace(')', '')
    return value
```

### 3. Literal Sanitization

rdfs:comment and rdfs:label must be clean:

```python
def sanitize_literal(value: str) -> str:
    """Escape for Turtle literal."""
    # Strip WikiLinks: [[Term]] -> Term
    value = re.sub(r'\[\[([^\]]+)\]\]', r'\1', value)
    # Remove leaked source:: refs
    value = re.sub(r'\s*-?\s*source::\s*.*$', '', value)
    # Escape Turtle special chars
    value = value.replace('\\', '\\\\')
    value = value.replace('"', '\\"')
    value = value.replace('\n', '\\n')
    return value.strip()
```

## Output Files

- **Single file**: `output/ontology.ttl` (git provides versioning)
- **No versioned filenames** like ontology-v14.ttl

## Converter Location

```
Ontology-Tools/tools/converters/convert-to-turtle.py
```

## Common Errors and Fixes

| Error | Root Cause | Fix |
|-------|-----------|-----|
| `Prefix "data:" not bound` | Old versioned TTL files | Use single `ontology.ttl` |
| `Prefix "blockchain:" not bound` | `source-domain:: blockchain` | Change to `bc` |
| `Prefix ":" not bound` | Bare colon in property decls | Use `ngm:` prefix |
| `Bad syntax (']' expected)` | `&` in local name | Use `sanitize_local_name()` |
| `unexpected token '#'` | Comments before @prefix | @prefix MUST come first |

## Cross-Cutting Domains

Use `belongsToDomain` for cross-cutting classification:

```markdown
- belongsToDomain:: [[AIApplicationsDomain]], [[DisruptiveTechDomain]]
```

This allows pages to have a primary domain (via `source-domain`) while also being tagged for cross-cutting queries.

## References

- Converter: `Ontology-Tools/tools/converters/convert-to-turtle.py`
- Parser: `Ontology-Tools/tools/lib/ontology_block_parser.py`
- Loader: `Ontology-Tools/tools/lib/ontology_loader.py`
