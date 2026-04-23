# Ontology Enrich Skill

Layer 1 skill for in-place validation, enrichment, and maintenance of ontology files.

## Key Features

- **OWL2 Validation**: Pre-modification validation with automatic rollback
- **Perplexity API Integration**: Content enrichment with UK English focus
- **Link Validation**: Detect and fix broken wiki-link references
- **Full Field Preservation**: Imports ontology-core for immutable modifications
- **Batch Processing**: Rate-limited bulk enrichment

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Configure API key
cp .env.example .env
# Edit .env and add your PERPLEXITY_API_KEY

# Validate a file
python -m ontology_enrich.validate --file mainKnowledgeGraph/pages/AI_Agent.md

# Enrich definition
python -m ontology_enrich.enrich \
  --file mainKnowledgeGraph/pages/AI_Agent.md \
  --field definition

# Fix broken links
python -m ontology_enrich.fix_links \
  --file mainKnowledgeGraph/pages/Machine_Learning.md \
  --auto-fix
```

## Architecture

**Layer 1 Skill**: Imports ontology-core (Layer 0) for all parsing/modification operations.

```
ontology-enrich/
├── src/
│   ├── enrichment_workflow.py  # Main orchestration
│   ├── perplexity_client.py    # API integration
│   └── link_validator.py       # Link validation
├── config/
│   └── enrichment_config.yaml  # Configuration
├── skill.md                    # Full documentation
└── requirements.txt            # Dependencies
```

## Documentation

See `skill.md` for complete usage guide, API reference, and examples.

## Integration with Ontology-Core

All parsing and modification delegates to ontology-core:

```python
from ontology_core.src.ontology_parser import parse_ontology_block, write_ontology_block
from ontology_core.src.ontology_modifier import modify_field, validate_modification
from ontology_core.src.owl2_validator import validate_ontology

# Parse with full field preservation
ontology = parse_ontology_block(file_path)

# Validate OWL2 compliance
validation = validate_ontology(ontology)

# Immutable modification
modified = modify_field(ontology, 'definition', new_content)

# Write back
write_ontology_block(file_path, modified)
```

## Environment Variables

Required:
- `PERPLEXITY_API_KEY`: Perplexity API key

Optional:
- `ONTOLOGY_ENRICH_UK_ENGLISH`: Use UK English (default: true)
- `ONTOLOGY_ENRICH_RATE_LIMIT`: API rate limit (default: 10/min)
- `ONTOLOGY_ENRICH_AUTO_ROLLBACK`: Auto-rollback on failure (default: true)

## License

Part of multi-agent-docker project.
