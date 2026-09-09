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
or substitute your vault's `pages/` directory. `source-domain::` and friends are
the legacy Logseq property spelling, still matched on read during the bounded
transition window; in vault pages these are frontmatter keys (`source-domain:`).

## Key Workflows

### 1. Validate source-domain Values

**CRITICAL**: Only 6 valid prefixes exist:

```bash
# Find invalid source-domain values
grep -rhn "source-domain::" "$VAULT_PAGES"/*.md | \
  sed 's/.*source-domain::\s*//' | sort | uniq -c | sort -rn

# Valid: ai, bc, mv, rb, tc, ngm
# INVALID: blockchain, metaverse, telecollaboration, data, etc.
```

**Fix invalid values** — use `ontology-tools modify`, not raw `sed`: it is the
same field-preserving, OWL2-validated, auto-backed-up path `ontology-core`
documents for editing this exact field, so both skills route source-domain
edits through one safe mechanism instead of two (one safe, one blind):

```bash
# blockchain -> bc
grep -rln "source-domain:: blockchain" "$VAULT_PAGES"/*.md | \
  xargs -I {} ontology-tools modify {} --set source-domain=bc

# metaverse -> mv
grep -rln "source-domain:: metaverse" "$VAULT_PAGES"/*.md | \
  xargs -I {} ontology-tools modify {} --set source-domain=mv

# telecollaboration -> tc
grep -rln "source-domain:: telecollaboration" "$VAULT_PAGES"/*.md | \
  xargs -I {} ontology-tools modify {} --set source-domain=tc
```

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
