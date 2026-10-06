'use strict';

/**
 * zai-env — the complete environment for a Claude Code child that talks to Z.AI.
 *
 * Built from named inputs, never by copying the caller: an inherited CLAUDE_EFFORT
 * silently lowers GLM's effort, an inherited CLAUDE_CONFIG_DIR loads the caller's output
 * style and plugins, and an inherited ANTHROPIC_API_KEY would be sent to the Z.AI base
 * URL. Pass the result to spawn-cli (which adds PATH, TLS trust and proxies and inherits
 * nothing else). The child is normally the `zai` CLI (config/zai-wrapper.sh), which starts
 * claude from `env -i` and maps ZAI_EFFORT / ZAI_MAX_THINKING_TOKENS onto Claude Code's
 * own variables; the direct Claude Code variables are set too, so a bare `claude` or a
 * `claude-zai` binary given as AGENTBOX_ZAI_BIN behaves the same.
 *
 * Used by mcp/consultants/zai/server.js and config/hooks/ontology-monitor.cjs.
 */

const DEFAULT_ZAI_URL = 'https://api.z.ai/api/paas/v4';

/**
 * @param {object} [source=process.env]  where the Z.AI settings are read from (only ZAI_* keys are read)
 * @param {object} [opts]
 * @param {string} [opts.home]              HOME for the child; its .claude is the config the child reads
 * @param {string} [opts.agentId]           AGENTBOX_AGENT_ID for hook attribution
 * @param {number} [opts.maxThinkingTokens] extended-thinking budget; 0 or unset leaves the endpoint default
 * @param {string} [opts.effort]            Claude Code effort level for the child; unset leaves the default
 * @returns {Record<string,string>}
 */
function zaiChildEnv(source = process.env, opts = {}) {
  const key = source.ZAI_ANTHROPIC_API_KEY || source.ZAI_API_KEY || '';
  const url = source.ZAI_URL || DEFAULT_ZAI_URL;
  const env = {
    // Read by the `zai` CLI, which builds claude's environment from these alone.
    ZAI_URL: url,
    ZAI_API_KEY: key,
    // Read by claude directly when AGENTBOX_ZAI_BIN is a plain Claude Code binary.
    ANTHROPIC_BASE_URL: url,
    ANTHROPIC_AUTH_TOKEN: key,
    ANTHROPIC_API_KEY: '',
  };
  if (opts.home) env.HOME = opts.home;
  if (opts.agentId) env.AGENTBOX_AGENT_ID = opts.agentId;
  if (opts.maxThinkingTokens > 0) {
    env.ZAI_MAX_THINKING_TOKENS = String(opts.maxThinkingTokens);
    env.MAX_THINKING_TOKENS = String(opts.maxThinkingTokens);
  }
  if (opts.effort) {
    env.ZAI_EFFORT = opts.effort;
    env.CLAUDE_EFFORT = opts.effort;
  }
  return env;
}

module.exports = { zaiChildEnv, DEFAULT_ZAI_URL };
