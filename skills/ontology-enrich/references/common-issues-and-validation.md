# Common issues, fixes, and the validation script

Depth reference for `ontology-enrich`. Load this when actually debugging a
WebVOWL parse error or running a full validation pass.

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
grep -l "ontology:: true.*term-id::" "$VAULT_PAGES"/*.md

# Find pages with & in relationships
grep -rn "enables.*&\|requires.*&\|has-part.*&" "$VAULT_PAGES"/*.md
```

## Quick Validation Script

TTL regeneration is currently **blocked** — see `SKILL.md` "Generate TTL" for
why (no converter exists in this checkout, and the Rust `ontology-tools`
crate has no export subcommand). The script below covers what is actually
runnable today; the TTL-dependent checks are marked and will no-op (nothing
to check) until export is unblocked.

```bash
#!/bin/bash
# validate-ontology.sh

echo "=== Checking source-domain values ==="
grep -rhn "source-domain::" "$VAULT_PAGES"/*.md | \
  sed 's/.*source-domain::\s*//' | sort | uniq -c | sort -rn

echo "=== TTL-dependent checks (skip until export is unblocked; see SKILL.md) ==="
if [ -f output/ontology.ttl ]; then
  echo "=== Checking for unbound prefixes ==="
  grep -c "blockchain:\|metaverse:\|data:" output/ontology.ttl && \
    echo "ERROR: Unbound prefixes found" || echo "OK: No unbound prefixes"

  echo "=== Verifying @prefix first ==="
  head -1 output/ontology.ttl | grep -q "@prefix" && \
    echo "OK: @prefix is first" || echo "ERROR: @prefix not first"
else
  echo "output/ontology.ttl does not exist (TTL export not yet ported) — skipping"
fi
```
