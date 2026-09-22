---
name: ontology-enrich
description: "Validate and enrich the vault knowledge-graph ontology. Use when fixing source-domain prefixes (ai/bc/mv/rb/tc/ngm), checking orphan is-subclass-of targets, or making pages meet VisionClaw github_sync field requirements. Note: WebVOWL TTL generation/regeneration (output/ontology.ttl) is not yet ported to the Rust ontology-tools crate — see SKILL.md before promising a TTL export from this skill."
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
- For general data validation unrelated to the vault ontology -- use standard validation tools
- For VisionClaw graph rendering -- this handles data, not display

## Purpose

Validated enrichment and TTL generation for the authored vault corpus with
VisionClaw/WebVOWL compatibility. The shell examples below use `$VAULT_PAGES` —
the `[vault]` path authority resolved from `agentbox.toml` (ADR-2028); export it
or substitute your vault's `pages/` directory (`visionGraph/knowledge/pages`).
`source-domain::` and friends are the legacy `key::` spelling, matched on read
as a migration affordance only; in vault pages these are frontmatter keys
(`source-domain:`), and `vault validate` fails on any `key::` line that
survives (ADR-2107).

## Key Workflows

### 1. Validate domain values

Vault pages carry the domain in YAML frontmatter (`domain:`, OWL
`vc:sourceDomain`), not as an outliner `source-domain::` line. The six
taxonomic roots are `artificial-intelligence`, `spatial-computing`,
`blockchain`, `infrastructure`, `distributed-collaboration` and `robotics`
(`visionGraph/ontology/vocabulary.yaml`); the field is free text and the
corpus also uses non-root values.

```bash
# Distribution of domain values across the vault
grep -h "^domain:" "$VAULT_PAGES"/*.md | sort | uniq -c | sort -rn

# Conformance, vocabulary agreement and link integrity in one pass
vault validate
```

**Fix a value** with the vault's guarded mutation, never raw `sed` and never
`ontology-tools modify` (it writes the retired outliner `OntologyBlock`
format and refuses frontmatter pages):

```bash
vault edit <page-id> --set domain=blockchain --expect docs=1 --dry-run   # inspect
vault edit <page-id> --set domain=blockchain --expect docs=1
```

Normalising a value across many pages (for example `ai` onto
`artificial-intelligence`) is a content decision: submit it as one grouped
proposal with `vault propose`, not as a loop of edits.

### 2. Generate TTL — currently blocked

The Python converter this step used to invoke,
`Ontology-Tools/tools/converters/convert-to-turtle.py`, does not exist
anywhere in this checkout (verified 2026-09-09). The Rust `ontology-tools`
crate that replaced the retired Python tooling (`services/ontology-tools`,
on `PATH`) never gained an export subcommand — its full surface is `parse |
validate | roundtrip | modify | links | enrich | batch-enrich`. No other
TTL/Turtle exporter was found under `services/` or `scripts/`.

Until a real exporter lands (the natural home is an `ontology-tools
export-ttl` subcommand in that same crate, since it already parses and
validates this data), `output/ontology.ttl` generation is not available from
this skill.

### 3. Validate TTL for WebVOWL

These checks assume an `output/ontology.ttl` already exists from some prior
run; they cannot be exercised until TTL export (above) is unblocked.

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
# Requires PERPLEXITY_API_KEY in the environment (see repo-root .env.example
# for the full ONTOLOGY_ENRICH_* key set). UK English context is on by
# default (ONTOLOGY_ENRICH_UK_ENGLISH).
cd services/ontology-tools
cargo run -- enrich "$VAULT_PAGES"/SmartContract.md --field definition

# Batch, rate-limited (ONTOLOGY_ENRICH_RATE_LIMIT, default 10/min):
cargo run -- batch-enrich "$VAULT_PAGES"/StubPage1.md "$VAULT_PAGES"/StubPage2.md --field definition
```

## Common Issues and Fixes

WebVOWL parser error table, malformed-page fixes: [references/common-issues-and-validation.md](references/common-issues-and-validation.md).

## Relationship Best Practices

### is-subclass-of targets must exist

```bash
# Check for orphan relationships
grep -rn "is-subclass-of::" "$VAULT_PAGES"/*.md | \
  sed 's/.*\[\[\([^]]*\)\]\].*/\1/' | sort | uniq | \
  while read term; do
    if ! ls "$VAULT_PAGES/$term.md" 2>/dev/null; then
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

## Integration with VisionClaw

VisionClaw's `github_sync_service.rs` expects:

| Field | Required | Format |
|-------|----------|--------|
| `### OntologyBlock` | Yes | Markdown heading |
| `term-id::` | Yes | `DOMAIN-NNNN` |
| `owl:class::` | Yes | `domain:ClassName` |
| `source-domain::` | Yes | 2-letter code |
| `public-access::` | Yes | `true` or `false` |
| `definition::` | Yes | Clean text (no WikiLinks) |

## Quick Validation Script

Full runnable script (source-domain check plus the TTL-dependent checks,
which currently skip cleanly since export is blocked): [references/common-issues-and-validation.md](references/common-issues-and-validation.md).

## References

- Enrichment/validation/link-check binary: `services/ontology-tools` (Rust crate; `ontology-tools --help`, or `cd services/ontology-tools && cargo run -- --help`)
- TTL/Turtle export: not yet ported (no Python converter exists in this checkout; the Rust crate above has no export subcommand) — see "Generate TTL" above
- Common issues, malformed-page fixes, validation script: [references/common-issues-and-validation.md](references/common-issues-and-validation.md)
- Workflow: `.github/workflows/publish.yml`
- TTL Output: `output/ontology.ttl` (once export exists)
- Domain pages: `$VAULT_PAGES/*Domain.md`
