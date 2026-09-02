# Ontology Enrich Skill

Layer 1 skill for in-place validation, enrichment, and maintenance of ontology files.

## Key Features

- **OWL2 Validation**: Pre-modification validation with automatic rollback
- **Perplexity API Integration**: Content enrichment with UK English focus
- **Link Validation**: Detect and fix broken wiki-link references
- **Full Field Preservation**: Uses ontology-core's OntologyBlock parser/writer for immutable modifications
- **Batch Processing**: Rate-limited bulk enrichment

## Quick Start

The Python implementation has been ported to a single Rust binary,
`services/ontology-tools` (crate `ontology-tools`), which covers both this
skill and `ontology-core`.

```bash
cd services/ontology-tools
cargo build --release

# Configure API key
export PERPLEXITY_API_KEY=...
# See ../../.env.example (repo root) for the full ONTOLOGY_ENRICH_* key set.

# Validate a file
cargo run -- validate "$VAULT_PAGES"/AI_Agent.md

# Enrich definition
cargo run -- enrich "$VAULT_PAGES"/AI_Agent.md --field definition

# Fix broken links
cargo run -- links "$VAULT_PAGES"/Machine_Learning.md --auto-fix
```

## Architecture

**Layer 1 Skill**: Uses `ontology-core`'s (Layer 0) parsing/modification code —
both skills are now implemented by the one `ontology-tools` crate.

```
services/ontology-tools/
├── src/
│   ├── enrichment.rs      # Main orchestration (this skill)
│   ├── perplexity.rs      # API integration (this skill)
│   ├── link_validator.rs  # Link validation (this skill)
│   ├── block.rs           # OntologyBlock (ontology-core)
│   ├── parser.rs          # Parsing (ontology-core)
│   ├── writer.rs          # Writing (ontology-core)
│   ├── modifier.rs        # Field-preserving edits (ontology-core)
│   └── validator.rs       # OWL2 axiom validation (ontology-core)
├── tests/                 # Ported round-trip / field-preservation tests
└── Cargo.toml
```

`skills/ontology-enrich/config/enrichment_config.yaml` documents the same
settings, expressed as `ONTOLOGY_ENRICH_*` environment variables (see below).

## Documentation

See [SKILL.md](SKILL.md) for the full usage guide and workflows.

## Integration with Ontology-Core

All parsing and modification delegates to `ontology-core`'s real API
(`OntologyParser`, `OntologyModifier`, `OWL2Validator` — the crate-internal
equivalent of a Rust `use`, since both skills share one crate):

```rust
use ontology_tools::{OntologyParser, OWL2Validator, write_ontology_block};

let parser = OntologyParser::new();
let block = parser.parse_ontology_block(&content, Some(&file_path)); // full field preservation

let validation = OWL2Validator::new().validate_file(&file_path.display().to_string(), Some(&content));

let modified = parser.update_field(&block, "definition", &new_content)?; // immutable update

let markdown = write_ontology_block(&modified);
```

## Environment Variables

Required:
- `PERPLEXITY_API_KEY`: Perplexity API key

Optional:
- `ONTOLOGY_ENRICH_UK_ENGLISH`: Use UK English (default: true)
- `ONTOLOGY_ENRICH_RATE_LIMIT`: API rate limit (default: 10/min)
- `ONTOLOGY_ENRICH_AUTO_ROLLBACK`: Auto-rollback on failure (default: true)

## License

Part of the agentbox skills ecosystem.
