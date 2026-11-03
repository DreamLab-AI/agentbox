// Execute the actual boot projection blocks with fake AQE, never a model call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync, chmodSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const boot = readFileSync(join(root, 'config/entrypoint-unified.sh'), 'utf8');
const claude = boot.slice(boot.indexOf('# ── Agentic-QE MCP:'), boot.indexOf('# ── ADR-2080:'));
const codexStart = boot.indexOf('# Direct AQE tools');
const codex = boot.slice(codexStart, boot.indexOf('if command -v ruflo', codexStart));
const prefix = '_ab_toml_bool() { echo 0; }\n_ab_toml_val() { echo claude-code; }\n';

for (const mode of ['enabled', 'disabled', 'unavailable']) test(`boot AQE ${mode} reaches both harnesses`, () => {
  const scratch = mkdtempSync(join(tmpdir(), 'visioncraft-aqe-'));
  try {
    const bin = join(scratch, 'bin'); mkdirSync(bin);
    const locate = spawnSync('bash', ['-c', 'command -v agentbox-manifest'], { encoding: 'utf8' });
    assert.equal(locate.status, 0, 'install/build agentbox-manifest before this integration suite');
    symlinkSync(locate.stdout.trim(), join(bin, 'agentbox-manifest'));
    const path = (process.env.PATH || '').split(':').filter(dir => dir && !existsSync(join(dir, 'aqe'))).join(':');
    if (mode !== 'unavailable') {
      writeFileSync(join(bin, 'aqe'), '#!/bin/sh\nexit 99\n'); chmodSync(join(bin, 'aqe'), 0o755);
    }
    const json = join(scratch, 'mcp.json'); const toml = join(scratch, 'config.toml');
    writeFileSync(json, JSON.stringify({ mcpServers: { 'agentic-qe': { command: 'stale' }, other: { command: 'retain' } } }));
    writeFileSync(toml, 'model = "retain"\n[mcp_servers.agentic-qe]\ncommand = "stale"\n');
    const output = spawnSync('bash', ['-c', prefix + claude + '\n' + codex], {
      encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${path}`, ENABLE_AGENTIC_QE: String(mode !== 'disabled'), ENABLE_CODEX: 'true', _MCP_JSON: json, _CODEX_CONFIG: toml },
    });
    assert.equal(output.status, 0, output.stderr);
    const result = JSON.parse(readFileSync(json, 'utf8'));
    const text = readFileSync(toml, 'utf8');
    assert.equal(result.mcpServers.other.command, 'retain');
    assert.match(text, /model = "retain"/);
    if (mode === 'enabled') {
      assert.equal(result.mcpServers['agentic-qe'].command, 'aqe');
      assert.equal(result.mcpServers['agentic-qe'].env.AQE_MEMORY_BACKEND, 'memory');
      assert.match(text, /\[mcp_servers\.agentic-qe\]/);
      assert.match(text, /command = "aqe"/);
    } else {
      assert.equal(result.mcpServers['agentic-qe'], undefined);
      assert.doesNotMatch(text, /\[mcp_servers\.agentic-qe\]/);
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
