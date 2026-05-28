#!/usr/bin/env node
/**
 * Agentbox Claude Code → claude-flow self-learning hook adapter.
 *
 * Claude Code delivers hook payloads as JSON on stdin; the baked
 * `claude-flow hooks <cmd>` subcommands instead take typed flags
 * (`--task`, `--file`, `--command`) and ignore stdin. Wiring Claude Code
 * hooks straight at the CLI therefore no-ops every turn
 * (`[ERROR] Required option missing: --task`). This adapter is the thin
 * translation layer: read the stdin payload, extract the relevant field,
 * and invoke the corresponding claude-flow hook with the right flag.
 *
 * Intelligence (routing, edit/command outcome learning, session state,
 * SONA/HNSW recall) lives entirely in the baked claude-flow CLI, which
 * persists through the mandated ruvector-postgres memory backend
 * (ADR-015). This adapter holds no learning state of its own — it must
 * stay thin so it never competes with that backend.
 *
 * Usage: node claude-flow-hook-adapter.cjs <action>
 *   route | pre-edit | post-edit | pre-command | post-command
 *   | session-restore | session-end
 *
 * Contract: hooks must never break the session. Every path exits 0, even
 * on missing binary, malformed stdin, timeout, or subcommand failure.
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');

const FLOW_BIN = process.env.AGENTBOX_FLOW_BIN || 'claude-flow';
// The embedding model (@xenova/transformers, used by route/intelligence
// for HNSW recall) caches into TRANSFORMERS_CACHE. Unset, it resolves to a
// path inside the read-only Nix store and crashes with ENOENT. Point it at
// the writable per-user cache tmpfs (mounted at /home/devuser/.cache).
const HF_CACHE = process.env.TRANSFORMERS_CACHE
  || process.env.HF_HOME
  || '/home/devuser/.cache/huggingface';

// Hook stdout for UserPromptSubmit/SessionStart is injected into the model's
// context every turn, so forward only the high-signal lines. claude-flow's
// `route` also prints a latency/alternatives/metrics dump and (on a degraded
// backend) a WASM-fallback banner plus embedder stack traces — all noise the
// model should never see. Each forwarded action keeps a focused allowlist.
const ROUTE_SIGNAL = /^\[(INFO|INTELLIGENCE)\]|^\|\s*(Agent|Confidence|Reason):|Matched Pattern/;
const RESTORE_SIGNAL = /^\[(INFO|INTELLIGENCE)\]|Session restored|Restored|patterns/i;

function readStdin() {
  try {
    if (process.stdin.isTTY) return '';
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function parsePayload(raw) {
  if (!raw || !raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function run(args, { signal = null, timeout = 6000 } = {}) {
  const res = spawnSync(FLOW_BIN, ['hooks', ...args], {
    timeout,
    encoding: 'utf8',
    env: { ...process.env, TRANSFORMERS_CACHE: HF_CACHE, HF_HOME: HF_CACHE },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (signal && res && typeof res.stdout === 'string') {
    const clean = res.stdout
      .split('\n')
      .filter((line) => signal.test(line))
      .join('\n')
      .trim();
    if (clean) process.stdout.write(clean + '\n');
  }
}

function main() {
  const action = process.argv[2] || '';
  const payload = parsePayload(readStdin());
  const toolInput = payload.tool_input || payload.toolInput || {};

  const prompt = (payload.prompt || payload.command || '').toString().trim();
  const file = (toolInput.file_path || toolInput.filePath || '').toString().trim();
  const command = (toolInput.command || '').toString().trim();

  switch (action) {
    case 'route':
      if (prompt) run(['route', '--task', prompt], { signal: ROUTE_SIGNAL, timeout: 12000 });
      break;
    case 'pre-edit':
      if (file) run(['pre-edit', '--file', file], { timeout: 5000 });
      break;
    case 'post-edit':
      if (file) run(['post-edit', '--file', file], { timeout: 10000 });
      break;
    case 'pre-command':
      if (command) run(['pre-command', '--command', command], { timeout: 5000 });
      break;
    case 'post-command':
      if (command) run(['post-command', '--command', command], { timeout: 5000 });
      break;
    case 'session-restore':
      run(['session-restore'], { signal: RESTORE_SIGNAL, timeout: 15000 });
      break;
    case 'session-end':
      run(['session-end'], { timeout: 10000 });
      break;
    default:
      // Unknown action: no-op. Never signal an error to Claude Code.
      break;
  }
}

try {
  main();
} catch {
  // Hooks must never break the session.
}
process.exit(0);
