#!/usr/bin/env bash
# Z.AI wrapper — runs Claude Code against the Z.AI API endpoint.
# Usage: zai [claude-code-args...]
#
# Claude starts from `env -i`: the caller's environment does not reach it. Claude Code
# reads its own steering from the environment, so an inherited CLAUDE_EFFORT silently
# changed GLM's effort, an inherited CLAUDE_CONFIG_DIR loaded the caller's output style
# and plugins, and an inherited ANTHROPIC_API_KEY would have been sent to Z.AI. Only
# the plumbing below and the Z.AI redirect are passed; HOME is kept, so the caller
# chooses which $HOME/.claude the child reads. Test: tests/security/zai-launch-env.test.cjs.
#
# Env vars read (set in .env or the calling shell):
#   ZAI_API_KEY / ZAI_ANTHROPIC_API_KEY — Z.AI key (required; either name)
#   ZAI_URL                 — Z.AI Anthropic-compatible base URL (default https://api.z.ai/api/paas/v4)
#   ZAI_EFFORT              — Claude Code effort level for this call (passed as CLAUDE_EFFORT)
#   ZAI_MAX_THINKING_TOKENS — thinking budget for this call (passed as MAX_THINKING_TOKENS)
set -euo pipefail

token="${ZAI_ANTHROPIC_API_KEY:-${ZAI_API_KEY:-}}"
if [ -z "$token" ]; then
  # Without a token claude would fall back to whatever credential $HOME/.claude holds
  # and send it to the Z.AI base URL.
  echo "zai: set ZAI_API_KEY (or ZAI_ANTHROPIC_API_KEY); refusing to start without a Z.AI key" >&2
  exit 1
fi

# Non-secret plumbing: binaries, identity, terminal, locale, temp space, TLS trust, proxies.
keep=(
  PATH HOME USER LOGNAME SHELL TERM COLORTERM TERM_PROGRAM LANG LC_ALL LC_CTYPE TZ TMPDIR
  SSL_CERT_FILE SSL_CERT_DIR NIX_SSL_CERT_FILE CURL_CA_BUNDLE REQUESTS_CA_BUNDLE NODE_EXTRA_CA_CERTS
  HTTP_PROXY HTTPS_PROXY NO_PROXY http_proxy https_proxy no_proxy
  AGENTBOX_AGENT_ID
)
args=()
for k in "${keep[@]}"; do
  [ -n "${!k+set}" ] && args+=("${k}=${!k}")
done
args+=(
  "ANTHROPIC_BASE_URL=${ZAI_URL:-https://api.z.ai/api/paas/v4}"
  "ANTHROPIC_AUTH_TOKEN=${token}"
  "ANTHROPIC_API_KEY="
)
[ -n "${ZAI_EFFORT:-}" ] && args+=("CLAUDE_EFFORT=${ZAI_EFFORT}")
[ -n "${ZAI_MAX_THINKING_TOKENS:-}" ] && args+=("MAX_THINKING_TOKENS=${ZAI_MAX_THINKING_TOKENS}")

exec env -i "${args[@]}" claude "$@"
