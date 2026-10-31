#!/bin/sh
# check-no-logseq-paths.sh — Invariant (ADR-2028 / VAULT-corpus-format Invariant 3):
# `[vault]` in agentbox.toml is the SINGLE path authority for the authored corpus.
# No consumer may hard-code a retired corpus path; every one of them reads
# VAULT_ROOT / VAULT_PAGES. A hard-coded path is a silent-degradation point: the
# consumer keeps "working" against a stale tree after the vault moves.
#
# Retired path literals this gate rejects in live code, config and skills:
#   workspace/logseq   — the Logseq-era graph location (ADR-2028)
#   mainKnowledgeGraph — the Logseq-era graph name
#   knowledge/pages/   — the pre-flatten knowledge layout (ADR-OM-007, 2026-10-16)
#   working/pages/     — the pre-flatten working layout (journals are working/journals/)
# The corpus is flat: pages sit at the vault root as knowledge/<Title>.md and
# working/<Title>.md.
#
# Exempt, because both are historical records that must keep quoting the paths
# they abolish:
#   docs/archive/  — the frozen pre-consolidation corpus (rationale, never authority)
#   docs/adr/      — the decision ledger; ADR-2028 itself cites the old literals
#                    as the Context it removes, and ADRs are immutable once written
# Also skipped: .claude/worktrees/ — gitignored ephemeral agent worktrees, i.e.
# copies of this tree, not repository content. CI never has them; a developer box
# does, and their hits are echoes of the same files the gate already scanned.
# Tracked .claude/ files are still scanned.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"

matches="$(cd "$ROOT" && grep -rnE "workspace/logseq|mainKnowledgeGraph|knowledge/pages/|working/pages/" \
  --include=*.js --include=*.mjs --include=*.cjs --include=*.sh --include=*.toml --include=*.md \
  --include=*.yaml --include=*.yml --include=*.nix \
  . \
  --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null \
  | grep -v '^\./docs/archive/' \
  | grep -v '^\./docs/adr/' \
  | grep -v '^\./scripts/ci/check-no-logseq-paths\.sh:' \
  | grep -v '^\./\.claude/worktrees/' || true)"

count="$(printf '%s' "$matches" | grep -c . || true)"
count="${count:-0}"

if [ "$count" -ne 0 ]; then
  echo "FAIL (check-no-logseq-paths): $count retired corpus path(s) outside docs/archive and docs/adr." >&2
  printf '%s\n' "$matches" >&2
  echo "" >&2
  echo "  The corpus is flat (knowledge/<Title>.md, working/<Title>.md); there is no pages/ folder." >&2
  echo "  ADR-2028: read the corpus path from the manifest instead —" >&2
  echo "    shell/env : \"\$VAULT_PAGES\" (pages) or \"\$VAULT_ROOT\" (vault root)" >&2
  echo "    node      : process.env.VAULT_PAGES / process.env.VAULT_ROOT" >&2
  echo "    python    : os.environ['VAULT_PAGES']" >&2
  echo "    config    : \${VAULT_ROOT} / \${VAULT_PAGES} placeholders, expanded by the reader" >&2
  echo "  With no [vault] in agentbox.toml the consumer must disable itself loudly" >&2
  echo "  (one clear line), never fall back to a literal path." >&2
  exit 1
fi

echo "PASS (check-no-logseq-paths): no retired corpus paths outside docs/archive and docs/adr"
