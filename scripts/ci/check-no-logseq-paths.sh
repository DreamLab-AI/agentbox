#!/bin/sh
# check-no-logseq-paths.sh — Invariant (ADR-2028 / VAULT-corpus-format Invariant 3):
# `[vault]` in agentbox.toml is the SINGLE path authority for the authored corpus.
# No consumer may hard-code a `workspace/logseq` path; every one of them reads
# VAULT_ROOT / VAULT_PAGES (or ONTOLOGY_PAGES_DIR, the override kept for one
# release). A hard-coded path is a silent-degradation point: the consumer keeps
# "working" against a stale tree after the vault moves.
#
# Exempt, because both are historical records that must keep quoting the paths
# they abolish:
#   docs/archive/  — the frozen pre-consolidation corpus (rationale, never authority)
#   docs/adr/      — the decision ledger; ADR-2028 itself cites the old literals
#                    as the Context it removes, and ADRs are immutable once written
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"

matches="$(cd "$ROOT" && grep -rn "workspace/logseq" \
  --include=*.js --include=*.mjs --include=*.sh --include=*.toml --include=*.md \
  . \
  --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null \
  | grep -v '^\./docs/archive/' \
  | grep -v '^\./docs/adr/' \
  | grep -v '^\./scripts/ci/check-no-logseq-paths\.sh:' || true)"

count="$(printf '%s' "$matches" | grep -c . || true)"
count="${count:-0}"

if [ "$count" -ne 0 ]; then
  echo "FAIL (check-no-logseq-paths): $count hard-coded corpus path(s) outside docs/archive and docs/adr." >&2
  printf '%s\n' "$matches" >&2
  echo "" >&2
  echo "  ADR-2028: read the corpus path from the manifest instead —" >&2
  echo "    shell/env : \"\$VAULT_PAGES\" (pages) or \"\$VAULT_ROOT\" (vault root)" >&2
  echo "    node      : process.env.VAULT_PAGES / process.env.VAULT_ROOT" >&2
  echo "    python    : os.environ['VAULT_PAGES']" >&2
  echo "    config    : \${VAULT_ROOT} / \${VAULT_PAGES} placeholders, expanded by the reader" >&2
  echo "  With no [vault] in agentbox.toml the consumer must disable itself loudly" >&2
  echo "  (one clear line), never fall back to a literal path." >&2
  exit 1
fi

echo "PASS (check-no-logseq-paths): no hard-coded corpus paths outside docs/archive and docs/adr"
