'use strict';

/**
 * Hook registration contract for the ROOT session (config/entrypoint-unified.sh)
 * and the governed registry (config/registered-hooks.txt).
 *
 *   • every hook `timeout` the entrypoint writes is SECONDS (Claude Code's unit) —
 *     the historical bug wrote milliseconds, so `8000` was a 2.2-hour timeout;
 *   • skill-route's timeout is derived from the judge's millisecond budget;
 *   • every hook file the entrypoint registers has an `own` row in the registry,
 *     and every `own` row names a hook something actually registers;
 *   • trust-seed is a boot-time run only, never a SessionStart hook, and prints
 *     nothing on stdout (a hook's stdout lands in model context);
 *   • the auto-memory self-heal is gone (the registry prunes that hook);
 *   • ontology-monitor returns at once and does its review in a detached child.
 *
 * The Rust side (hooks-reconcile, stacks.rs profile timeouts) is covered by
 * `cargo test` in services/agentbox-manifest.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const ENTRY = fs.readFileSync(path.join(ROOT, 'config/entrypoint-unified.sh'), 'utf8');
const REGISTRY = fs.readFileSync(path.join(ROOT, 'config/registered-hooks.txt'), 'utf8');
const MAX_TIMEOUT_S = 600;

function registryRows() {
  return REGISTRY.split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, '').trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+/));
}

function scratch(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `hookreg-${name}-`));
}

describe('entrypoint hook timeouts are seconds', () => {
  test('every numeric `timeout:` in a hook registration is within 1..600 s', () => {
    const literals = [...ENTRY.matchAll(/\btimeout:\s*(\d+)\b/g)].map((m) => Number(m[1]));
    expect(literals.length).toBeGreaterThanOrEqual(9);
    for (const t of literals) {
      expect(t).toBeGreaterThanOrEqual(1);
      expect(t).toBeLessThanOrEqual(MAX_TIMEOUT_S);
    }
  });

  test('skill-route converts the judge budget (ms) to a hook timeout (s), minimum 8', () => {
    const m = ENTRY.match(/timeout:\s*(Math\.max\(8,[^\n]*?\)\)\s*)\}\]\s*\}\);/);
    expect(m).not.toBeNull();
    const expr = m[1].trim();
    // eslint-disable-next-line no-new-func
    const at = (ms) => new Function('process', `return ${expr};`)({ env: { SR_TIMEOUT: String(ms) } });
    expect(at(4000)).toBe(8);
    expect(at(1500)).toBe(8);
    expect(at(10000)).toBe(20);
    expect(at(12345)).toBe(25);
    expect(at('')).toBe(8);
  });
});

describe('the registry governs what the entrypoint registers', () => {
  const rows = registryRows();
  const own = rows.filter((r) => r[0] === 'own');

  test('rows are well formed and owned timeouts are seconds', () => {
    for (const r of rows) {
      expect(['own', 'keep', 'prune']).toContain(r[0]);
      if (r[0] === 'own') {
        expect(r).toHaveLength(4);
        if (r[3] !== '-') {
          expect(Number(r[3])).toBeGreaterThanOrEqual(1);
          expect(Number(r[3])).toBeLessThanOrEqual(MAX_TIMEOUT_S);
        }
      } else {
        expect(r).toHaveLength(2);
      }
    }
  });

  test('every owned hook is registered by the entrypoint, and vice versa', () => {
    for (const [, marker] of own) expect(ENTRY).toContain(marker);
    // Hook files the entrypoint pushes into settings.json.
    const registered = new Set(
      [...ENTRY.matchAll(/includes\('([\w.-]+\.(?:cjs|sh))'\)/g)].map((m) => m[1]),
    );
    const markers = new Set(own.map((r) => r[1]));
    for (const f of registered) expect(markers).toContain(f);
  });

  test('the audited vendor scaffolding and the trust-seed hook are pruned', () => {
    const pruned = rows.filter((r) => r[0] === 'prune').map((r) => r[1]);
    for (const m of ['helpers/hook-handler.cjs', 'auto-memory-hook.mjs', 'claude-flow-hook-adapter.cjs', 'trust-seed.cjs']) {
      expect(pruned).toContain(m);
    }
    expect(rows).toContainEqual(['keep', 'aoe-hooks']);
  });

  test('the reconciler runs after the last hook registration block', () => {
    const call = ENTRY.indexOf('agentbox-manifest hooks-reconcile');
    expect(call).toBeGreaterThan(0);
    for (const marker of ['<<\'SRJS\'', '<<\'RLJS\'', '<<\'CQJS\'', '<<\'TRAJJS\'', '<<\'MIRRORJS\'']) {
      expect(ENTRY.indexOf(marker)).toBeLessThan(call);
    }
  });
});

describe('retired registrations stay retired', () => {
  test('trust-seed is not registered on SessionStart', () => {
    expect(ENTRY).not.toMatch(/SessionStart[^\n]*trust-seed|trust-seed[^\n]*SessionStart\.push/);
    expect(ENTRY).not.toContain("<<'TRUSTJS'");
    // …but still runs once at boot.
    expect(ENTRY).toMatch(/node "\$_TRUST_HOOK"/);
  });

  test('the auto-memory-hook self-heal is gone', () => {
    expect(ENTRY).not.toContain("<<'AMHEAL'");
  });

  test('session defaults are seeded only when unset, with verified key names', () => {
    const block = ENTRY.slice(ENTRY.indexOf("<<'SEEDJS'"), ENTRY.indexOf('\nSEEDJS\n'));
    expect(block).toContain("autoMemoryEnabled: false");
    expect(block).toContain("subagentPromptCacheTtl: '1h'");
    expect(block).toContain('switchModelsOnFlag: false');
    expect(block).toMatch(/if \(!\(k in s\)\)/);
  });
});

describe('hook runtime behaviour', () => {
  test('trust-seed writes nothing to stdout', () => {
    const home = scratch('trust');
    fs.mkdirSync(path.join(home, 'workspace/repo/.git'), { recursive: true });
    const r = spawnSync('node', [path.join(ROOT, 'config/hooks/trust-seed.cjs')], {
      env: { PATH: process.env.PATH, HOME: home, WORKSPACE: path.join(home, 'workspace') },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/\[trust-seed\] \d+ path\(s\) checked, 2 newly trusted/);
    const cfg = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'));
    expect(cfg.projects[path.join(home, 'workspace/repo')].hasTrustDialogAccepted).toBe(true);
  });

  test('ontology-monitor returns at once and reviews in a detached child', () => {
    const state = scratch('onto');
    const t0 = Date.now();
    const r = spawnSync('node', [path.join(ROOT, 'config/hooks/ontology-monitor.cjs')], {
      input: JSON.stringify({ session_id: 't', cwd: path.join(state, 'absent') }),
      env: {
        PATH: process.env.PATH,
        AGENTBOX_STATE: state,
        AGENTBOX_ONTOLOGY_MONITOR: '1',
        ZAI_API_KEY: 'test-only',
        AGENTBOX_ZAI_BIN: '/bin/false',
      },
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(r.status).toBe(0);
    expect(Date.now() - t0).toBeLessThan(3000);
    const logFile = path.join(state, 'ontology-monitor.log');
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !(fs.existsSync(logFile) && fs.statSync(logFile).size > 0)) {
      spawnSync('sleep', ['0.1']);
    }
    expect(fs.readFileSync(logFile, 'utf8')).toMatch(/no work to review/);
  });

  test('ontology-monitor gated off exits without spawning anything', () => {
    const state = scratch('onto-off');
    const r = spawnSync('node', [path.join(ROOT, 'config/hooks/ontology-monitor.cjs')], {
      input: '{}',
      env: { PATH: process.env.PATH, AGENTBOX_STATE: state },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/no-op: master switch off/);
    expect(fs.existsSync(path.join(state, 'ontology-monitor.log'))).toBe(false);
  });
});
