'use strict';

/**
 * child-env — the environment the claude-zai sidecar gives each `claude --print` worker.
 *
 * An allowlist, not a copy of process.env. The worker may run Bash, so anything in its
 * environment is readable by the prompt: copying process.env handed it the sidecar's
 * bearer secret (ZAI_WRAPPER_TOKEN / MANAGEMENT_API_KEY). Inherited Claude Code steering
 * (CLAUDE_EFFORT, MAX_THINKING_TOKENS, ANTHROPIC_MODEL, CLAUDE_CODE_*) would change how
 * GLM is driven without anyone asking for it. CLAUDE_CONFIG_DIR is set from the
 * sidecar's own configuration, never inherited.
 */

/** Non-secret plumbing a CLI needs: binaries, locale, temp space, TLS trust, proxies. */
const PASSTHROUGH = Object.freeze([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TMPDIR',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NIX_SSL_CERT_FILE', 'CURL_CA_BUNDLE', 'REQUESTS_CA_BUNDLE', 'NODE_EXTRA_CA_CERTS',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
]);

/**
 * @param {object} source                  the sidecar's process.env
 * @param {object} cfg
 * @param {string} cfg.configDir           CLAUDE_CONFIG_DIR for the worker
 * @param {string} cfg.apiKey              Z.AI key, sent as the bearer token
 * @param {string} cfg.baseUrl             Z.AI Anthropic-compatible base URL
 * @param {string} [cfg.effort]            Claude Code effort level (ZAI_EFFORT); unset leaves the default
 * @returns {Record<string,string>}
 */
function claudeChildEnv(source, { configDir, apiKey, baseUrl, effort } = {}) {
  const env = {};
  for (const k of PASSTHROUGH) if (source[k] !== undefined) env[k] = source[k];
  env.CLAUDE_CONFIG_DIR = configDir;
  env.ANTHROPIC_BASE_URL = baseUrl;
  env.ANTHROPIC_AUTH_TOKEN = apiKey || '';
  env.ANTHROPIC_API_KEY = '';
  if (effort) env.CLAUDE_EFFORT = effort;
  return env;
}

module.exports = { claudeChildEnv, PASSTHROUGH };
