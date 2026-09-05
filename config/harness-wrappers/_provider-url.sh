#!/usr/bin/env bash
# ============================================================================
# _provider-url.sh — shared provider-endpoint URL validator for the harness
# wrappers (ADR-2007, closeout 2026-09-05).
# ----------------------------------------------------------------------------
# WHY: the wrappers used to accept the provider redirect on a shell-glob
# substring match (`case "$BASE_URL" in *"$EXPECT_HOST"*)`). That accepts
#
#     https://openrouter.ai.example.invalid/api      (suffix-domain spoof)
#     https://evil.invalid/openrouter.ai             (expected host in the path)
#     https://openrouter.ai@evil.invalid/            (expected host in user-info)
#     http://openrouter.ai/api                       (plaintext egress)
#
# i.e. an attacker-chosen endpoint receives the provider auth token — a
# credential-egress and mis-billing hole, which is precisely the failure the
# ADR-2007 assertion exists to stop.
#
# WHAT: `provider_url_validate <url> <expected-host> [allowed-ports]` parses the
# URL properly (pure bash — no jq/python/node dependency, so it works in every
# boot context) and enforces:
#
#   * scheme      — MUST be https (http, file, anything else is rejected);
#   * host        — the AUTHORITY host, taken after stripping user-info, IPv6
#                   brackets and the port, must equal <expected-host> exactly or
#                   be a dot-suffixed subdomain of it (`*.openrouter.ai`).
#                   Suffix domains (`openrouter.ai.example.invalid`) are NOT
#                   subdomains and are rejected;
#   * user-info   — rejected outright: a provider endpoint never carries
#                   credentials in the authority, and it is the classic
#                   host-spoof vector;
#   * port        — absent means the https default 443; when present it must be
#                   numeric, in range, and a member of the explicit
#                   PROVIDER_URL_ALLOWED_PORTS allow-list;
#   * shape       — no whitespace, no control characters, a real scheme, a
#                   non-empty host, no empty/IP-literal/dot-edge host labels.
#
# CONTRACT: returns 0 on acceptance, non-zero on rejection. On rejection it
# echoes ONE diagnostic line to stdout and also leaves it in
# $PROVIDER_URL_DIAG. On acceptance it sets:
#
#     PROVIDER_URL_SCHEME       always "https"
#     PROVIDER_URL_HOST         normalised (lower-case) authority host
#     PROVIDER_URL_PORT         effective port (443 when implicit)
#     PROVIDER_URL_PORT_SOURCE  "explicit" | "implicit"
#
# Callers must NOT run it in a command substitution (that would lose the parse
# results to the subshell); call it directly and redirect stdout if the
# diagnostic is not wanted on stdout:
#
#     if ! provider_url_validate "$URL" "$HOST" >/dev/null; then
#       _die "..." "  ${PROVIDER_URL_DIAG}"
#     fi
#
# The parse results are deliberately credential-free: nothing in this file ever
# reads or prints an auth token.
# ============================================================================

# Explicit allow-list of ports a provider endpoint may use. https only, so 443
# only. Kept as a named constant (rather than an inline literal) so widening it
# is a visible, reviewable edit. Overridable per call via argument 3.
: "${PROVIDER_URL_ALLOWED_PORTS:=443}"

# Internal: record + emit a rejection diagnostic. Always returns 0 so callers
# can pair it with an explicit `return 1` under `set -e`.
_provider_url_fail() {
  PROVIDER_URL_DIAG="$1"
  printf '%s\n' "$1"
  return 0
}

# provider_url_validate <url> <expected-host> [allowed-ports]
provider_url_validate() {
  local url="${1-}" expect="${2-}" allowed="${3-}"
  [ -n "$allowed" ] || allowed="$PROVIDER_URL_ALLOWED_PORTS"

  PROVIDER_URL_SCHEME=''
  PROVIDER_URL_HOST=''
  PROVIDER_URL_PORT=''
  PROVIDER_URL_PORT_SOURCE=''
  PROVIDER_URL_DIAG=''

  if [ -z "$expect" ]; then
    _provider_url_fail "internal error: provider_url_validate called with no expected host"
    return 1
  fi
  # Normalise the expectation the same way the parsed host is normalised.
  expect="${expect,,}"

  if [ -z "$url" ]; then
    _provider_url_fail "the URL is empty"
    return 1
  fi

  # --- shape: no whitespace, no control characters ------------------------
  case "$url" in
    *[[:space:]]*)
      _provider_url_fail "the URL contains whitespace"
      return 1 ;;
    *[[:cntrl:]]*)
      _provider_url_fail "the URL contains control characters"
      return 1 ;;
  esac

  # --- scheme --------------------------------------------------------------
  case "$url" in
    *"://"*) : ;;
    *)
      _provider_url_fail "the URL has no scheme (expected https://…): ${url}"
      return 1 ;;
  esac
  local scheme="${url%%://*}" rest="${url#*://}"
  scheme="${scheme,,}"
  case "$scheme" in
    ''|[!a-z]*|*[!a-z0-9+.-]*)
      _provider_url_fail "the URL scheme is malformed: '${scheme}' in ${url}"
      return 1 ;;
  esac
  if [ "$scheme" != "https" ]; then
    _provider_url_fail "the URL scheme must be https, got '${scheme}': ${url}"
    return 1
  fi

  # --- authority (everything before the first / ? or #) --------------------
  local authority="${rest%%/*}"
  authority="${authority%%\?*}"
  authority="${authority%%#*}"
  if [ -z "$authority" ]; then
    _provider_url_fail "the URL has an empty host: ${url}"
    return 1
  fi

  # --- user-info: strip it, then refuse it --------------------------------
  # Stripping first means the diagnostic can name the REAL host, which is what
  # makes the spoof obvious (https://openrouter.ai@evil.invalid/ → evil.invalid).
  local hostport="$authority" userinfo=''
  case "$authority" in
    *@*)
      userinfo="${authority%@*}"
      hostport="${authority##*@}"
      ;;
  esac

  # --- host / port split (IPv6 literals are bracketed) ---------------------
  local host='' port=''
  case "$hostport" in
    '['*)
      case "$hostport" in
        *']'*) : ;;
        *)
          _provider_url_fail "the URL host is a malformed IPv6 literal (no closing bracket): ${url}"
          return 1 ;;
      esac
      host="${hostport%%]*}"
      host="${host#"["}"
      local after="${hostport#*]}"
      case "$after" in
        '')  port='' ;;
        :*)  port="${after#:}" ;;
        *)
          _provider_url_fail "the URL has trailing junk after the IPv6 literal: ${url}"
          return 1 ;;
      esac
      # An IP literal can never be the provider's DNS name.
      _provider_url_fail "the URL host is an IP literal ([${host}]), not ${expect}: ${url}"
      return 1
      ;;
    *:*)
      host="${hostport%%:*}"
      port="${hostport#*:}"
      if [ -z "$port" ]; then
        _provider_url_fail "the URL has a ':' with no port: ${url}"
        return 1
      fi
      ;;
    *)
      host="$hostport"
      port=''
      ;;
  esac

  # --- host normalisation + charset ---------------------------------------
  host="${host,,}"
  if [ -z "$host" ]; then
    _provider_url_fail "the URL has an empty host: ${url}"
    return 1
  fi
  case "$host" in
    *[!a-z0-9.-]*)
      _provider_url_fail "the URL host contains characters that are not valid in a hostname: '${host}'"
      return 1 ;;
    .*|*.)
      _provider_url_fail "the URL host has a leading or trailing dot: '${host}'"
      return 1 ;;
    *..*)
      _provider_url_fail "the URL host has an empty label: '${host}'"
      return 1 ;;
    -*|*-)
      _provider_url_fail "the URL host starts or ends with a hyphen: '${host}'"
      return 1 ;;
  esac

  if [ -n "$userinfo" ]; then
    _provider_url_fail "the URL carries user-info before the host — the real host is '${host}', not '${expect}': ${url}"
    return 1
  fi

  # --- host authority match -----------------------------------------------
  # Exact host, or a dot-suffixed subdomain. `openrouter.ai.example.invalid`
  # ends with `.invalid`, not with `.openrouter.ai`, so it is rejected.
  local suffix=".$expect" matched=0
  if [ "$host" = "$expect" ]; then
    matched=1
  else
    case "$host" in
      *"$suffix") matched=1 ;;
    esac
  fi
  if [ "$matched" != "1" ]; then
    _provider_url_fail "the URL host is '${host}', which is neither ${expect} nor a subdomain of it: ${url}"
    return 1
  fi

  # --- port ----------------------------------------------------------------
  local effective_port='443' port_source='implicit'
  if [ -n "$port" ]; then
    case "$port" in
      *[!0-9]*)
        _provider_url_fail "the URL port is not numeric: '${port}' in ${url}"
        return 1 ;;
    esac
    local p=$((10#$port))
    if [ "$p" -lt 1 ] || [ "$p" -gt 65535 ]; then
      _provider_url_fail "the URL port ${p} is out of range (1-65535): ${url}"
      return 1
    fi
    local ok=0 a
    for a in $allowed; do
      if [ "$p" = "$a" ]; then ok=1; fi
    done
    if [ "$ok" != "1" ]; then
      _provider_url_fail "the URL port ${p} is not in the allowed set (${allowed}): ${url}"
      return 1
    fi
    effective_port="$p"
    port_source='explicit'
  fi

  PROVIDER_URL_SCHEME="$scheme"
  PROVIDER_URL_HOST="$host"
  PROVIDER_URL_PORT="$effective_port"
  PROVIDER_URL_PORT_SOURCE="$port_source"
  return 0
}
