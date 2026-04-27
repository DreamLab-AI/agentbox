#!/bin/bash
# Z.AI wrapper — runs Claude Code against the Z.AI API endpoint.
# Usage: zai [claude-code-args...]
#
# Env vars (set in .env or shell):
#   ZAI_URL     — Z.AI API base URL (default: https://api.z.ai/api/anthropic)
#   ZAI_API_KEY — Z.AI API key (required)
exec env \
  ANTHROPIC_BASE_URL="${ZAI_URL:-https://api.z.ai/api/anthropic}" \
  ANTHROPIC_AUTH_TOKEN="${ZAI_API_KEY}" \
  claude "$@"
