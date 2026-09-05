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
# The contract under test (the three tiers documented at the resolver):
#   1. manifest vault           — highest; VAULT_PAGES comes from [vault]
#   2. explicit env override    — honoured only while the vault is ENABLED, or
#                                 under AGENTBOX_VAULT_LEGACY_PATHS=1
#   3. legacy ONTOLOGY_PAGES_DIR — cleared + warned about when the vault is
#                                 disabled and there is no opt-in
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
        'vault pages')  printf '%s' 'pages' ;;
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
    printf 'RESULT:%s|%s|%s|%s\n' \"\${AGENTBOX_VAULT_ENABLED:-}\" \"\${VAULT_ROOT:-}\" \"\${VAULT_PAGES:-}\" \"\${ONTOLOGY_PAGES_DIR:-}\"
  " 2>&1
}

_field() { printf '%s' "$1" | sed -n 's/^RESULT:\(.*\)$/\1/p' | tail -1 | cut -d'|' -f"$2"; }

echo "── part 1: _ab_vault_resolve precedence ──"

# case 1 — no vault, no override
OUT="$(_run_resolver '')"
if [ "$(_field "$OUT" 1)" = "0" ] && [ -z "$(_field "$OUT" 3)" ] && [ -z "$(_field "$OUT" 4)" ]; then
  _ok "no-vault + no-override → enabled=0, VAULT_PAGES empty, ONTOLOGY_PAGES_DIR empty"
else
  _bad "no-vault + no-override" "$OUT"
fi

# case 2 — no vault, legacy override present: cleared + warned
OUT="$(_run_resolver '' ONTOLOGY_PAGES_DIR=/fixture/old-pages)"
if [ "$(_field "$OUT" 1)" = "0" ] && [ -z "$(_field "$OUT" 4)" ] \
   && printf '%s' "$OUT" | grep -q 'WARNING: clearing deprecated ONTOLOGY_PAGES_DIR=/fixture/old-pages'; then
  _ok "no-vault + legacy override → CLEARED, one warning naming the path"
else
  _bad "no-vault + legacy override (must clear + warn)" "$OUT"
fi

# case 2b — the warning names the escape hatch (actionable, not just loud)
if printf '%s' "$OUT" | grep -q 'AGENTBOX_VAULT_LEGACY_PATHS=1'; then
  _ok "no-vault + legacy override → warning names the AGENTBOX_VAULT_LEGACY_PATHS=1 opt-in"
else
  _bad "warning names the opt-in" "$OUT"
fi

# case 3 — no vault, legacy override, explicit opt-in: retained
OUT="$(_run_resolver '' ONTOLOGY_PAGES_DIR=/fixture/old-pages AGENTBOX_VAULT_LEGACY_PATHS=1)"
if [ "$(_field "$OUT" 1)" = "0" ] && [ "$(_field "$OUT" 4)" = "/fixture/old-pages" ] \
   && printf '%s' "$OUT" | grep -q 'RETAINING deprecated ONTOLOGY_PAGES_DIR'; then
  _ok "no-vault + legacy override + LEGACY_PATHS=1 → RETAINED, and says so"
else
  _bad "no-vault + legacy override + opt-in (must retain)" "$OUT"
fi

# case 4 — vault present, env override also set: the MANIFEST wins for VAULT_PAGES
OUT="$(_run_resolver /fixture/vault ONTOLOGY_PAGES_DIR=/fixture/old-pages)"
if [ "$(_field "$OUT" 1)" = "1" ] \
   && [ "$(_field "$OUT" 2)" = "/fixture/vault" ] \
   && [ "$(_field "$OUT" 3)" = "/fixture/vault/pages" ]; then
  _ok "vault present + env override → manifest wins: VAULT_PAGES=/fixture/vault/pages"
else
  _bad "vault present: manifest must win for VAULT_PAGES" "$OUT"
fi

# case 4b — tier 2 unchanged while enabled: the explicit override is still honoured
#           by legacy consumers, and the resolver says so out loud.
if [ "$(_field "$OUT" 4)" = "/fixture/old-pages" ] \
   && printf '%s' "$OUT" | grep -q 'overrides the manifest pages dir'; then
  _ok "vault present + env override → ONTOLOGY_PAGES_DIR honoured (tier 2) with a note"
else
  _bad "vault present: tier-2 override must stay honoured + noted" "$OUT"
fi

# case 5 — vault present, no override: ONTOLOGY_PAGES_DIR derived from the manifest
OUT="$(_run_resolver /fixture/vault)"
if [ "$(_field "$OUT" 3)" = "/fixture/vault/pages" ] && [ "$(_field "$OUT" 4)" = "/fixture/vault/pages" ]; then
  _ok "vault present + no override → ONTOLOGY_PAGES_DIR derived from VAULT_PAGES"
else
  _bad "vault present + no override" "$OUT"
fi

# case 6 — relocation: one manifest edit moves every derived path
OUT="$(_run_resolver /fixture/relocated/visionGraph/knowledge)"
if [ "$(_field "$OUT" 2)" = "/fixture/relocated/visionGraph/knowledge" ] \
   && [ "$(_field "$OUT" 3)" = "/fixture/relocated/visionGraph/knowledge/pages" ] \
   && [ "$(_field "$OUT" 4)" = "/fixture/relocated/visionGraph/knowledge/pages" ]; then
  _ok "vault relocated → root, pages and the derived legacy var all follow the manifest"
else
  _bad "vault relocated" "$OUT"
fi

# case 7 — relocation with a stale env override still present: manifest still wins
OUT="$(_run_resolver /fixture/relocated/knowledge ONTOLOGY_PAGES_DIR=/fixture/stale-legacy-corpus/pages)"
if [ "$(_field "$OUT" 3)" = "/fixture/relocated/knowledge/pages" ]; then
  _ok "vault relocated + stale Logseq-era override → VAULT_PAGES still the manifest's"
else
  _bad "vault relocated + stale override" "$OUT"
fi

# ---------------------------------------------------------------------------
# Part 2 — the shell consumer refuses the legacy path when the vault is disabled
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

OUT="$(_run_refresh AGENTBOX_VAULT_ENABLED=0 ONTOLOGY_PAGES_DIR="$LEGACY_DIR")"
if printf '%s' "$OUT" | grep -q 'RC:2' && printf '%s' "$OUT" | grep -q 'REFUSING legacy corpus path'; then
  _ok "refresh.sh: vault disabled + legacy override → exit 2, refuses the path"
else
  _bad "refresh.sh must refuse the legacy path with exit 2" "$OUT"
fi

OUT="$(_run_refresh AGENTBOX_VAULT_ENABLED=0 ONTOLOGY_PAGES_DIR="$LEGACY_DIR" AGENTBOX_VAULT_LEGACY_PATHS=1)"
if ! printf '%s' "$OUT" | grep -q 'REFUSING legacy corpus path'; then
  _ok "refresh.sh: vault disabled + legacy override + opt-in → path honoured (no refusal)"
else
  _bad "refresh.sh must honour the legacy path under the opt-in" "$OUT"
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
