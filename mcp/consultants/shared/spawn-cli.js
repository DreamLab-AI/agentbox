'use strict';

/**
 * spawn-cli — small subprocess helper used by the CLI-spawning consultants
 * (codex, antigravity, zai). Captures stdout + stderr, enforces a timeout,
 * scrubs the environment so user-isolated CLIs see only the env vars they
 * need (no leakage of devuser secrets into a sibling user's process).
 *
 * Returns { stdout, stderr, code, signal, killed } and never throws —
 * the consultant decides whether non-zero exit is a hard failure.
 */

const { spawn } = require('child_process');

const DEFAULT_TIMEOUT_MS = 120_000;

/** Non-secret env vars always forwarded to spawned CLIs (TLS trust, proxies). */
const PASSTHROUGH_ENV = Object.freeze([
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NIX_SSL_CERT_FILE', 'CURL_CA_BUNDLE',
  'REQUESTS_CA_BUNDLE', 'NODE_EXTRA_CA_CERTS',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'TERM', 'LANG', 'LC_ALL', 'TMPDIR',
]);

/**
 * @param {object}             opts
 * @param {string}             opts.cmd            absolute path or command on PATH
 * @param {string[]}           [opts.args=[]]
 * @param {string}             [opts.cwd]          working directory; default /tmp
 * @param {object}             [opts.env]          env vars to set; nothing else inherits unless inherit=true
 * @param {boolean}            [opts.inherit_env=false]  pass through process.env (rare; CLI consultants want a clean slate)
 * @param {string}             [opts.stdin]        feed this string to stdin then close
 * @param {number}             [opts.timeout_ms=120000]
 * @returns {Promise<{stdout, stderr, code, signal, killed}>}
 */
function spawnCli(opts) {
  return new Promise((resolve) => {
    const env = opts.inherit_env ? { ...process.env, ...(opts.env || {}) } : (opts.env || {});
    // Always include PATH; without it most CLIs blow up resolving node/python.
    if (!env.PATH) env.PATH = process.env.PATH || '';
    if (!env.HOME) env.HOME = process.env.HOME || '/tmp';
    // TLS trust + proxy plumbing are not secrets and every HTTPS-speaking CLI
    // needs them. Nix-built binaries (codex, agy) locate the CA bundle ONLY via
    // SSL_CERT_FILE / NIX_SSL_CERT_FILE; scrubbing them yields
    // "invalid peer certificate: UnknownIssuer" and an endless reconnect loop
    // that runs into the timeout (observed 2026-09-04, codex 0.153.0).
    for (const k of PASSTHROUGH_ENV) {
      if (env[k] === undefined && process.env[k] !== undefined) env[k] = process.env[k];
    }

    const child = spawn(opts.cmd, opts.args || [], {
      cwd: opts.cwd || '/tmp',
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, opts.timeout_ms || DEFAULT_TIMEOUT_MS);

    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

    if (typeof opts.stdin === 'string') {
      child.stdin.write(opts.stdin);
    }
    child.stdin.end();

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + `\n[spawn-cli] ${err.message}`, code: -1, signal: null, killed });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code != null ? code : -1, signal, killed });
    });
  });
}

module.exports = { spawnCli };
