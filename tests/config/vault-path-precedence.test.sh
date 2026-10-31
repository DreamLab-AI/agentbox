#!/usr/bin/env bash
# ============================================================================
# vault-path-precedence.test.sh — ADR-2028 acceptance test
# ----------------------------------------------------------------------------
# Exercises the ACTUAL `_ab_vault_resolve` from config/entrypoint-unified.sh,
# extracted the same way VisionFlow/docs/estate-review/evidence/vault-path-probe.py
# extracts it (regex `^_ab_vault_resolve\(\) \{ … ^\}`), with a stub
# `_ab_toml_val` standing in for the manifest reader. Nothing on this machine's
# real manifest, vault or corpus is read or written.
#
# The contract under test (one path authority, ADR-2028):
#   - `[vault]` in the manifest is the only source: VAULT_PAGES and the
#     VAULT_WORKING_* paths come from it, whatever the inherited environment says.
#   - the retired ONTOLOGY_PAGES_DIR / AGENTBOX_VAULT_LEGACY_PATHS escape hatch
#     is gone: the resolver neither reads, retains, clears nor mentions it.
#
# Part 2 covers the shell consumer (scripts/ontology-condense-refresh.sh); the
# JS consumers are covered by tests/config/vault-consumer-fallback.test.mjs.
#
# Usage:  bash tests/config/vault-path-precedence.test.sh
# Exit:   0 = every case passed, 1 = at least one failed.
# ============================================================================
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/../.." && pwd)"
ENTRYPOINT="${REPO}/config/entrypoint-unified.sh"
REFRESH="${REPO}/scripts/ontology-condense-refresh.sh"

PASS=0
FAIL=0
_ok()  { PASS=$((PASS + 1)); printf 'PASS  %s\n' "$1"; }
_bad() { FAIL=$((FAIL + 1)); printf 'FAIL  %s\n' "$1"; [ -n "${2:-}" ] && printf '        %s\n' "$2"; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/vault-precedence.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# --- extract the resolver verbatim -----------------------------------------
FN="${TMP}/_ab_vault_resolve.sh"
awk '/^_ab_vault_resolve\(\) \{$/{f=1} f{print} f && /^\}$/{exit}' "$ENTRYPOINT" >"$FN"
if ! grep -q '^_ab_vault_resolve() {$' "$FN" || ! grep -q '^}$' "$FN"; then
  echo "FAIL  could not extract _ab_vault_resolve from ${ENTRYPOINT}" >&2
  exit 1
fi
_ok "extracted _ab_vault_resolve() from config/entrypoint-unified.sh ($(wc -l <"$FN") lines)"

# --- harness ---------------------------------------------------------------
# Runs the extracted resolver in a fresh bash with a stub manifest reader.
# $1 = manifest root ('' means "no [vault] in agentbox.toml"), rest = env pairs.
# VPAGES (test-local, default 'pages') is the manifest's [vault].pages value.
_run_resolver() { # _run_resolver <manifest-root> [ENV=VAL ...]
  local root="$1"; shift
  local stub
  if [ -z "$root" ]; then
    stub='_ab_toml_val() { :; }'
  else
    # Minimal manifest: root + pages + format + tui, everything else empty.
    stub="_ab_toml_val() {
      case \"\$1 \$2\" in
        'vault root')   printf '%s' '${root}' ;;
        'vault pages')  printf '%s' '${VPAGES:-pages}' ;;
        'vault format') printf '%s' 'obsidian' ;;
        'vault tui')    printf '%s' 'rune' ;;
        *) : ;;
      esac
    }"
  fi
  env -i PATH="$PATH" "$@" bash --noprofile --norc -c "
    set -u
    ${stub}
    $(cat "$FN")
    _ab_vault_resolve
    printf 'RESULT:%s|%s|%s|%s\n' \"\${AGENTBOX_VAULT_ENABLED:-}\" \"\${VAULT_ROOT:-}\" \"\${VAULT_PAGES:-}\" \"\${VAULT_WORKING_PAGES:-}\"
  " 2>&1
}

_field() { printf '%s' "$1" | sed -n 's/^RESULT:\(.*\)$/\1/p' | tail -1 | cut -d'|' -f"$2"; }

echo "── part 1: _ab_vault_resolve precedence ──"

# case 1 — no vault
OUT="$(_run_resolver '')"
if [ "$(_field "$OUT" 1)" = "0" ] && [ -z "$(_field "$OUT" 3)" ]; then
  _ok "no-vault → enabled=0, VAULT_PAGES empty"
else
  _bad "no-vault" "$OUT"
fi

# case 2 — no vault, a stale ONTOLOGY_PAGES_DIR and the old opt-in in the
#          environment: the resolver ignores both, silently (no warning, no
#          retention, no clearing — the variables are simply not its business).
OUT="$(_run_resolver '' ONTOLOGY_PAGES_DIR=/fixture/old-pages AGENTBOX_VAULT_LEGACY_PATHS=1)"
if [ "$(_field "$OUT" 1)" = "0" ] && [ -z "$(_field "$OUT" 3)" ] \
   && ! printf '%s' "$OUT" | grep -q 'ONTOLOGY_PAGES_DIR\|LEGACY_PATHS'; then
  _ok "no-vault + stale legacy variables → still disabled, resolver silent about them"
else
  _bad "no-vault + stale legacy variables must be ignored" "$OUT"
fi

# case 2b — the resolver source carries no trace of the retired escape hatch
if ! grep -q 'ONTOLOGY_PAGES_DIR\|AGENTBOX_VAULT_LEGACY_PATHS' "$FN"; then
  _ok "resolver source has no ONTOLOGY_PAGES_DIR / AGENTBOX_VAULT_LEGACY_PATHS tier"
else
  _bad "resolver source must not mention the retired escape hatch" "$(grep -n 'ONTOLOGY_PAGES_DIR\|AGENTBOX_VAULT_LEGACY_PATHS' "$FN")"
fi

# case 3 — vault present, stale env override also set: the MANIFEST wins and
#          the override is not mentioned
OUT="$(_run_resolver /fixture/vault ONTOLOGY_PAGES_DIR=/fixture/old-pages)"
if [ "$(_field "$OUT" 1)" = "1" ] \
   && [ "$(_field "$OUT" 2)" = "/fixture/vault" ] \
   && [ "$(_field "$OUT" 3)" = "/fixture/vault/pages" ] \
   && ! printf '%s' "$OUT" | grep -q 'ONTOLOGY_PAGES_DIR'; then
  _ok "vault present + stale override → manifest wins: VAULT_PAGES=/fixture/vault/pages, no note"
else
  _bad "vault present: manifest must win for VAULT_PAGES" "$OUT"
fi

# case 4 — relocation: one manifest edit moves every derived path
OUT="$(_run_resolver /fixture/relocated/visionGraph/knowledge)"
if [ "$(_field "$OUT" 2)" = "/fixture/relocated/visionGraph/knowledge" ] \
   && [ "$(_field "$OUT" 3)" = "/fixture/relocated/visionGraph/knowledge/pages" ]; then
  _ok "vault relocated → root and pages follow the manifest"
else
  _bad "vault relocated" "$OUT"
fi

# case 5 — flat vault: pages = "." (the schema default since the 2026-10-16 flatten) means the root itself
OUT="$(VPAGES=. _run_resolver /fixture/flat/knowledge)"
if [ "$(_field "$OUT" 3)" = "/fixture/flat/knowledge" ]; then
  _ok "pages=\".\" → VAULT_PAGES is the vault root"
else
  _bad "pages=\".\" should resolve to the vault root" "$OUT"
fi

# ---------------------------------------------------------------------------
# Part 2 — the shell consumer derives its path from VAULT_PAGES alone
# ---------------------------------------------------------------------------
echo
echo "── part 2: scripts/ontology-condense-refresh.sh consumer guard ──"

LEGACY_DIR="${TMP}/legacy-pages"
mkdir -p "$LEGACY_DIR"
printf -- '- a stale page\n' >"${LEGACY_DIR}/Stale.md"
DATA_DIR="${TMP}/data"

_run_refresh() { # _run_refresh [ENV=VAL ...]
  env -i PATH="$PATH" HOME="$TMP" \
    ONTOLOGY_CONDENSE_ENABLED=true \
    ONTOLOGY_ALIASES="${DATA_DIR}/aliases.json" \
    ONTOLOGY_CONDENSED_OUT="${DATA_DIR}/condensed.json" \
    ONTOLOGY_CONDENSE_LOCK="${TMP}/refresh-$RANDOM.lock" \
    "$@" bash "$REFRESH" 2>&1
  printf 'RC:%s\n' "$?"
}

OUT="$(_run_refresh AGENTBOX_VAULT_ENABLED=0 ONTOLOGY_PAGES_DIR="$LEGACY_DIR" AGENTBOX_VAULT_LEGACY_PATHS=1)"
if printf '%s' "$OUT" | grep -q 'RC:0' && printf '%s' "$OUT" | grep -q 'disabled — no corpus path' \
   && ! printf '%s' "$OUT" | grep -q 'index-build'; then
  _ok "refresh.sh: vault disabled + stale legacy variables → ignored: benign exit 0, nothing run"
else
  _bad "refresh.sh must ignore the retired legacy variables" "$OUT"
fi

OUT="$(_run_refresh AGENTBOX_VAULT_ENABLED=1 VAULT_PAGES="${TMP}/no-such-corpus" ONTOLOGY_PAGES_DIR="$LEGACY_DIR")"
if printf '%s' "$OUT" | grep -q "corpus path does not exist: ${TMP}/no-such-corpus"; then
  _ok "refresh.sh: vault enabled + stray ONTOLOGY_PAGES_DIR → VAULT_PAGES is the only source"
else
  _bad "refresh.sh must read VAULT_PAGES, not ONTOLOGY_PAGES_DIR" "$OUT"
fi

OUT="$(_run_refresh AGENTBOX_VAULT_ENABLED=0)"
if printf '%s' "$OUT" | grep -q 'RC:0' && printf '%s' "$OUT" | grep -q 'disabled — no corpus path'; then
  _ok "refresh.sh: vault disabled + no path at all → benign exit 0 (nothing to do)"
else
  _bad "refresh.sh: no path at all must stay a benign no-op" "$OUT"
fi

echo
echo "=================================================="
printf 'vault-path-precedence: %d passed, %d failed\n' "$PASS" "$FAIL"
echo "=================================================="
[ "$FAIL" -eq 0 ] || exit 1
exit 0
