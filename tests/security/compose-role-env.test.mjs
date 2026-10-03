// Custody X-1 W10 fix 1: no compose file passes a ROLE-class variable through
// `environment:`. Under [security].role_isolation the ROLE secrets reach the
// container by env_file (.env) and the entrypoint moves them into per-role
// files before PID 1 execs (_ab_role_env_capture). An `environment:` entry is a
// second, explicit route into PID 1 that the review of a compose diff can miss,
// so the rule is checked by name against config/custody/env-classes.json.
// node --test tests/security/compose-role-env.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const classes = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/custody/env-classes.json'), 'utf8')).classes;
const ROLE = new Set(Object.keys(classes.ROLE));

// Every variable NAME declared under an `environment:` key, list or map form.
// Line-based on purpose: compose files here are plain block YAML, and a
// dependency-free scanner keeps the gate runnable on a bare Node in CI.
export function environmentNames(text) {
  const out = [];
  let envIndent = -1;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').replace(/^\s*#.*$/, '');
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    if (envIndent >= 0 && indent <= envIndent) envIndent = -1;
    const key = line.match(/^(\s*)environment:\s*(.*)$/);
    if (key) {
      const inline = key[2].trim();
      if (inline.startsWith('[')) {
        for (const item of inline.replace(/^\[|\]$/g, '').split(',')) {
          const n = item.trim().replace(/^["']/, '').match(/^([A-Za-z_][A-Za-z0-9_]*)/);
          if (n) out.push(n[1]);
        }
      } else if (!inline) envIndent = indent;
      continue;
    }
    if (envIndent < 0) continue;
    const t = line.trim();
    const m = t.startsWith('-')
      ? t.replace(/^-\s*/, '').replace(/^["']/, '').match(/^([A-Za-z_][A-Za-z0-9_]*)/)
      : t.match(/^["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:/);
    if (m) out.push(m[1]);
  }
  return out;
}

const composeFiles = fs.readdirSync(ROOT).filter((f) => /^docker-compose[^/]*\.ya?ml$/.test(f)).sort();

test('the scanner reads list, map and flow forms and ignores comments and other keys', () => {
  const y = [
    'services:',
    '  a:',
    '    env_file:',
    '      - .env',
    '    environment:',
    '      # - AGENTBOX_NSEC=${AGENTBOX_NSEC:-}',
    '      - FOO=1',
    '      - "BAR=${BAR:-}"',
    '      - BAZ',
    '    volumes:',
    '      - QUX=not-env',
    '  b:',
    '    environment:',
    '      ONE: 1',
    '      "TWO": x',
    '  c:',
    '    environment: [THREE=3, "FOUR"]',
  ].join('\n');
  assert.deepEqual(environmentNames(y), ['FOO', 'BAR', 'BAZ', 'ONE', 'TWO', 'THREE', 'FOUR']);
});

test('the ROLE set is the one the brief named, and non-empty', () => {
  for (const n of ['AGENTBOX_NSEC', 'AGENTBOX_PRIVKEY_HEX', 'TAILSCALE_AUTHKEY']) assert.ok(ROLE.has(n), n);
  assert.ok(composeFiles.includes('docker-compose.override.yml'));
});

for (const f of composeFiles) {
  test(`${f}: no ROLE-class variable under environment:`, () => {
    const names = environmentNames(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    const bad = names.filter((n) => ROLE.has(n));
    assert.deepEqual(bad, [], `${f} passes ROLE-class ${bad.join(', ')} through environment:; ` +
      'let env_file carry it so the entrypoint can move it out of PID 1 (config/custody/env-classes.json)');
  });
}
