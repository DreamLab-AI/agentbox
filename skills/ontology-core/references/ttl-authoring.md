# TTL Authoring & OntologyBlock Reference

Detailed authoring rules, TTL-generation code, and error catalog for the
`ontology-core` skill. Load this when actually writing OntologyBlock entries,
generating `ontology.ttl`, or debugging a Turtle parse error.

## OntologyBlock Format (gold standard)

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

## Valid domain prefixes

Only these 6 `source-domain` values are valid. Anything else must be fixed in
source before export — the parser and WebVOWL both reject unbound prefixes.

| Prefix | Full Name | Namespace URI |
|--------|-----------|---------------|
| `ai` | Artificial Intelligence | `http://narrativegoldmine.com/ai#` |
| `bc` | Blockchain | `http://narrativegoldmine.com/blockchain#` |
| `mv` | Metaverse | `http://narrativegoldmine.com/metaverse#` |
| `rb` | Robotics | `http://narrativegoldmine.com/robotics#` |
| `tc` | Telecollaboration | `http://narrativegoldmine.com/telecollaboration#` |
| `ngm` | Core Ontology | `http://narrativegoldmine.com/ontology#` |

Common invalid values (rewrite in source):
- `blockchain` → `bc`
- `metaverse` → `mv`
- `telecollaboration` → `tc`

## TTL generation rules

### 1. `@prefix` must come first

WebVOWL format detection requires `@prefix` declarations at line 1:

```turtle
@prefix ai: <http://narrativegoldmine.com/ai#> .
@prefix bc: <http://narrativegoldmine.com/blockchain#> .
...

# Comments and metadata come AFTER prefixes
```

### 2. Local name sanitization

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

### 3. Literal sanitization

`rdfs:comment` and `rdfs:label` must be clean:

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

## Output files

- **Single file**: `output/ontology.ttl` (git provides versioning)
- **No versioned filenames** like `ontology-v14.ttl` — they leave stale `data:`
  prefixes bound and break re-parsing.

## Common errors and fixes

| Error | Root Cause | Fix |
|-------|-----------|-----|
| `Prefix "data:" not bound` | Old versioned TTL files | Use single `ontology.ttl` |
| `Prefix "blockchain:" not bound` | `source-domain:: blockchain` | Change to `bc` |
| `Prefix ":" not bound` | Bare colon in property decls | Use `ngm:` prefix |
| `Bad syntax (']' expected)` | `&` in local name | Use `sanitize_local_name()` |
| `unexpected token '#'` | Comments before @prefix | @prefix MUST come first |

## Cross-cutting domains

Use `belongsToDomain` for cross-cutting classification:

```markdown
- belongsToDomain:: [[AIApplicationsDomain]], [[DisruptiveTechDomain]]
```

This lets a page keep a primary domain (via `source-domain`) while also being
tagged for cross-cutting queries.

## Converter & library locations

- Converter: `Ontology-Tools/tools/converters/convert-to-turtle.py`
- Parser: `Ontology-Tools/tools/lib/ontology_block_parser.py`
- Loader: `Ontology-Tools/tools/lib/ontology_loader.py`

The skill also ships runnable Python in `../src/`:
- `ontology_parser.py` — parse OntologyBlock structures
- `ontology_modifier.py` — field-preserving edits
- `owl2_validator.py` — OWL2 DL validation
