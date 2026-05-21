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
