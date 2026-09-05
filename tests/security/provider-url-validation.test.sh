#!/usr/bin/env bash
# ============================================================================
# provider-url-validation.test.sh — ADR-2007 acceptance test
# ----------------------------------------------------------------------------
# Proves that the harness wrappers validate the provider redirect by PARSING the
# URL (scheme + host + port) rather than substring-matching the expected host.
#
# Method mirrors VisionFlow/docs/estate-review/evidence/runtime-egress-probes.py:
# a temporary WORKSPACE holding a real profile tree, a stub `claude` first on
# PATH, and the ACTUAL wrapper executed end to end. A case is "accepted" iff the
# stub ran (the wrapper exec'd claude); "rejected" iff the wrapper exited 1 with
# the loud FATAL banner on stderr and the stub never ran.
#
# No network, no real credentials: the token is an invented fixture string.
#
# Usage:  bash tests/security/provider-url-validation.test.sh
# Exit:   0 = every case passed, 1 = at least one failed.
# ============================================================================
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/../.." && pwd)"
WRAPPER_DIR="${REPO}/config/harness-wrappers"
LIB="${WRAPPER_DIR}/_provider-url.sh"

BANNER='AGENTBOX HARNESS WRAPPER — FATAL'
FIXTURE_TOKEN='INVENTED_FIXTURE_NOT_A_SECRET'

PASS=0
FAIL=0

_ok()   { PASS=$((PASS + 1)); printf 'PASS  %s\n' "$1"; }
_bad()  { FAIL=$((FAIL + 1)); printf 'FAIL  %s\n' "$1"; [ -n "${2:-}" ] && printf '        %s\n' "$2"; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/provider-url-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# --- stub claude: the only thing that proves a launch happened --------------
STUB_BIN="${TMP}/bin"
mkdir -p "$STUB_BIN"
cat >"${STUB_BIN}/claude" <<'STUB'
#!/bin/sh
printf 'STUB_PROVIDER_ONLY\n'
STUB
chmod 0755 "${STUB_BIN}/claude"

# ---------------------------------------------------------------------------
# Part 1 — the shared parser in isolation
# ---------------------------------------------------------------------------
# shellcheck source=../../config/harness-wrappers/_provider-url.sh
. "$LIB"

_unit() { # _unit <expect-accept|expect-reject> <url> <host> [label]
  local want="$1" url="$2" host="$3" label="${4:-$2}" rc
  provider_url_validate "$url" "$host" >/dev/null
  rc=$?
  if [ "$want" = accept ]; then
    if [ "$rc" -eq 0 ]; then
      _ok "lib accept   ${host} ← ${label} (host=${PROVIDER_URL_HOST} port=${PROVIDER_URL_PORT}/${PROVIDER_URL_PORT_SOURCE})"
    else
      _bad "lib accept   ${host} ← ${label}" "rejected: ${PROVIDER_URL_DIAG}"
    fi
  else
    if [ "$rc" -ne 0 ] && [ -n "$PROVIDER_URL_DIAG" ]; then
      _ok "lib reject   ${host} ← ${label} (${PROVIDER_URL_DIAG})"
    else
      _bad "lib reject   ${host} ← ${label}" "accepted with rc=${rc}"
    fi
  fi
}

echo "── part 1: provider_url_validate (unit) ──"
_unit accept 'https://openrouter.ai/api'            openrouter.ai
_unit accept 'https://openrouter.ai:443/api'        openrouter.ai
_unit accept 'https://sub.openrouter.ai/x'          openrouter.ai
_unit accept 'https://API.Z.AI/api/paas/v4'         z.ai            'uppercase host normalised'
_unit reject 'https://openrouter.ai.example.invalid/api' openrouter.ai
_unit reject 'https://openrouter.ai@evil.invalid/'  openrouter.ai
_unit reject 'https://evil.invalid/openrouter.ai'   openrouter.ai
_unit reject 'https://evil.invalid?x=openrouter.ai' openrouter.ai
_unit reject 'https://evil.invalid#openrouter.ai'   openrouter.ai
_unit reject 'http://openrouter.ai/api'             openrouter.ai
_unit reject 'file:///openrouter.ai'                openrouter.ai
_unit reject 'https://openrouter.ai:8443/api'       openrouter.ai
_unit reject 'https://openrouter.ai:0/api'          openrouter.ai
_unit reject 'https://openrouter.ai:99999/api'      openrouter.ai
_unit reject 'https://openrouter.ai:https/api'      openrouter.ai
_unit reject 'https://openrouter.ai:/api'           openrouter.ai
_unit reject 'openrouter.ai/api'                    openrouter.ai
_unit reject 'https://'                             openrouter.ai
_unit reject '://openrouter.ai'                     openrouter.ai
_unit reject ''                                     openrouter.ai   '(empty)'
_unit reject 'https://openrouter.ai./api'           openrouter.ai   'trailing dot'
_unit reject 'https://open router.ai/api'           openrouter.ai   'whitespace'
_unit reject "$(printf 'https://openrouter.ai/a\tb')" openrouter.ai 'tab (control char)'
_unit reject 'https://[2001:db8::1]/api'            openrouter.ai   'IPv6 literal'
_unit reject 'https://example.invalid'              openrouter.ai   'unrelated host'
_unit reject 'https://notopenrouter.ai/api'         openrouter.ai   'no dot boundary'

# ---------------------------------------------------------------------------
# Part 2 — the actual wrappers, end to end
# ---------------------------------------------------------------------------
# A temporary WORKSPACE per case: profiles/<slug>/.claude/settings.local.json is
# the runtime source of truth the wrapper reads.
_wrapper_case() { # _wrapper_case <slug> <accept|reject> <url> [label]
  local slug="$1" want="$2" url="$3" label="${4:-$3}"
  local ws="${TMP}/ws-$(printf '%s' "${slug}${label}" | md5sum | cut -c1-12)"
  local settings="${ws}/profiles/${slug}/.claude/settings.local.json"
  mkdir -p "$(dirname "$settings")"
  # Written with printf, not a JSON library, so the fixture stays dependency-free.
  printf '{"env":{"ANTHROPIC_BASE_URL":"%s","ANTHROPIC_AUTH_TOKEN":"%s"}}\n' \
    "$url" "$FIXTURE_TOKEN" >"$settings"

  local out err rc
  out="${ws}/stdout"; err="${ws}/stderr"
  env -i \
    PATH="${STUB_BIN}:${PATH}" \
    HOME="$ws" \
    WORKSPACE="$ws" \
    bash "${WRAPPER_DIR}/${slug}.sh" >"$out" 2>"$err"
  rc=$?

  local launched=0 bannered=0 leaked=0
  grep -qF 'STUB_PROVIDER_ONLY' "$out" && launched=1
  grep -qF "$BANNER" "$err" && bannered=1
  grep -qF "$FIXTURE_TOKEN" "$out" "$err" && leaked=1

  local tag="${slug} ${want}  ${label}"
  if [ "$leaked" = 1 ]; then
    _bad "$tag" "the auth token appeared in wrapper output"
    return
  fi
  if [ "$want" = accept ]; then
    if [ "$launched" = 1 ] && [ "$rc" -eq 0 ]; then
      _ok "$tag → launched (rc=0), banner absent=$([ "$bannered" = 0 ] && echo yes || echo NO)"
    else
      _bad "$tag" "rc=${rc} launched=${launched}; stderr: $(head -c 300 "$err" | tr '\n' ' ')"
    fi
  else
    if [ "$launched" = 0 ] && [ "$rc" -eq 1 ] && [ "$bannered" = 1 ]; then
      _ok "$tag → refused (rc=1, banner on stderr, stub never ran)"
    else
      _bad "$tag" "rc=${rc} launched=${launched} banner=${bannered}"
    fi
  fi
}

echo
echo "── part 2: config/harness-wrappers/openrouter.sh (end to end) ──"
_wrapper_case openrouter accept 'https://openrouter.ai/api'
_wrapper_case openrouter accept 'https://sub.openrouter.ai/x'
_wrapper_case openrouter accept 'https://openrouter.ai:443/api'                'explicit-443'
_wrapper_case openrouter reject 'https://openrouter.ai.example.invalid/api'    'suffix-host'
_wrapper_case openrouter reject 'https://openrouter.ai@evil.invalid/'          'user-info'
_wrapper_case openrouter reject 'https://evil.invalid/openrouter.ai'           'path-only'
_wrapper_case openrouter reject 'http://openrouter.ai/api'                     'http-scheme'
_wrapper_case openrouter reject 'https://openrouter.ai:8443/api'               'wrong-port'
_wrapper_case openrouter reject 'openrouter.ai/api'                            'no-scheme'
_wrapper_case openrouter reject 'https://'                                     'scheme-only'
_wrapper_case openrouter reject ''                                             'empty'
_wrapper_case openrouter reject 'https://example.invalid'                      'unrelated-host'

echo
echo "── part 2: config/harness-wrappers/zai.sh (end to end) ──"
_wrapper_case zai accept 'https://api.z.ai/api/paas/v4'
_wrapper_case zai accept 'https://z.ai/api'
_wrapper_case zai accept 'https://sub.z.ai/x'
_wrapper_case zai accept 'https://api.z.ai:443/api/paas/v4'                    'explicit-443'
_wrapper_case zai reject 'https://api.z.ai.example.invalid/api'                'suffix-host'
_wrapper_case zai reject 'https://api.z.ai@evil.invalid/'                      'user-info'
_wrapper_case zai reject 'https://evil.invalid/api.z.ai'                       'path-only'
_wrapper_case zai reject 'http://api.z.ai/api'                                 'http-scheme'
_wrapper_case zai reject 'https://api.z.ai:8443/api'                           'wrong-port'
_wrapper_case zai reject 'api.z.ai/api'                                        'no-scheme'
_wrapper_case zai reject 'https://'                                            'scheme-only'
_wrapper_case zai reject ''                                                    'empty'
_wrapper_case zai reject 'https://example.invalid'                             'unrelated-host'

echo
echo "── part 3: the wrapper never prints the auth token ──"
# Explicit, separate assertion: the accepted-case banner must carry host/scheme/
# port and nothing credential-shaped.
ACC_WS="${TMP}/ws-banner"
mkdir -p "${ACC_WS}/profiles/openrouter/.claude"
printf '{"env":{"ANTHROPIC_BASE_URL":"https://openrouter.ai/api","ANTHROPIC_AUTH_TOKEN":"%s"}}\n' \
  "$FIXTURE_TOKEN" >"${ACC_WS}/profiles/openrouter/.claude/settings.local.json"
BANNER_OUT="$(env -i PATH="${STUB_BIN}:${PATH}" HOME="$ACC_WS" WORKSPACE="$ACC_WS" \
  bash "${WRAPPER_DIR}/openrouter.sh" 2>&1)"
if printf '%s' "$BANNER_OUT" | grep -qF "$FIXTURE_TOKEN"; then
  _bad "launch banner is credential-free" "token found in output"
elif printf '%s' "$BANNER_OUT" | grep -qF 'https://openrouter.ai:443'; then
  _ok "launch banner is credential-free and reports scheme://host:port"
else
  _bad "launch banner reports scheme://host:port" "got: ${BANNER_OUT}"
fi

echo
echo "=================================================="
printf 'provider-url-validation: %d passed, %d failed\n' "$PASS" "$FAIL"
echo "=================================================="
[ "$FAIL" -eq 0 ] || exit 1
exit 0
