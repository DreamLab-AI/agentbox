// node --test skills/build-with-quality/scripts/deepsec-gate.test.mjs
// Exercises deepsec-gate.sh against a fake `deepsec` CLI: policy resolution,
// availability exits, PR-mode exit mapping, threshold gating and receipts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, 'deepsec-gate.sh');

function makeRepo() {
  const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'deepsec-gate-'));
  const r = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  r(['init', '-q']); r(['config', 'user.email', 'gate@test']); r(['config', 'user.name', 'gate']);
  writeFileSync(join(root, 'app.js'), 'export const x = 1;\n');
  r(['add', '.']); r(['commit', '-q', '-m', 'init']);
  return root;
}

// A fake deepsec that records argv, honours FAKE_DEEPSEC_FINDINGS (JSON array of
// findings) and FAKE_DEEPSEC_RC (exit code for `process`).
function makeFakeCli(binDir, { withClaude = true } = {}) {
  mkdirSync(binDir, { recursive: true });
  const cli = `#!/usr/bin/env bash
set -e
echo "$@" >> "$FAKE_DEEPSEC_LOG"
case "$1" in
  --version) echo "2.3.9"; exit 0 ;;
  scan) mkdir -p "data/\${3}/files"; printf '{"filePath":"app.js","candidates":[{"vulnSlug":"xss"},{"vulnSlug":"sqli"}]}' > "data/\${3}/files/app.js.json"; exit 0 ;;
  process)
    if [ -n "\${FAKE_DEEPSEC_FINDINGS:-}" ] && [ "\${FAKE_DEEPSEC_FINDINGS}" != "[]" ]; then
      for ((i=1;i<=$#;i++)); do [ "\${!i}" = "--comment-out" ] && { j=$((i+1)); echo "findings" > "\${!j}"; }; done
    fi
    exit "\${FAKE_DEEPSEC_RC:-0}" ;;
  export)
    for ((i=1;i<=$#;i++)); do [ "\${!i}" = "--out" ] && { j=$((i+1)); printf '%s' "\${FAKE_DEEPSEC_FINDINGS:-[]}" > "\${!j}"; }; done
    exit 0 ;;
  *) echo "fake deepsec: unknown command $1" >&2; exit 64 ;;
esac
`;
  writeFileSync(join(binDir, 'deepsec'), cli); chmodSync(join(binDir, 'deepsec'), 0o755);
  if (withClaude) { writeFileSync(join(binDir, 'claude'), '#!/usr/bin/env bash\nexit 0\n'); chmodSync(join(binDir, 'claude'), 0o755); }
}

function manifest(dir, body) {
  const p = join(dir, 'agentbox.toml');
  writeFileSync(p, body);
  return p;
}

function run(root, args, env = {}) {
  const log = join(root, 'fake.log');
  const res = spawnSync('bash', [GATE, ...args], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, FAKE_DEEPSEC_LOG: log, ...env },
  });
  return { ...res, log: existsSync(log) ? readFileSync(log, 'utf8') : '' };
}

const ENABLED = `[toolchains]\ndeepsec = true\n\n[security.deepsec]\nenabled = true\nagent = "claude"\nmodel_auth = "local"\nthinking_level = "high"\nfail_on = "HIGH"\nmax_duration = "5m"\nbatch_size = 3\nconcurrency = 1\n`;

test('disabled policy exits 78 and never invokes deepsec', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); makeFakeCli(bin);
  const m = manifest(root, ENABLED.replace('enabled = true', 'enabled = false'));
  const r = run(root, ['--diff-working'], { PATH: `${bin}:${process.env.PATH}`, AGENTBOX_CONFIG: m });
  assert.equal(r.status, 78); assert.match(r.stderr, /disabled by policy/); assert.equal(r.log, '');
});

test('missing deepsec binary exits 78 with the rebuild hint', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); mkdirSync(bin);
  const m = manifest(root, ENABLED);
  // an empty shim dir first, then the real PATH (which has no deepsec)
  const r = run(root, ['--diff-working'], { PATH: `${bin}:${process.env.PATH}`, AGENTBOX_CONFIG: m });
  assert.equal(r.status, 78, r.stderr); assert.match(r.stderr, /toolchains\]\.deepsec=true/);
});

test('dry-run prints the resolved plan with the local route and manifest policy', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); makeFakeCli(bin);
  const m = manifest(root, ENABLED);
  const r = run(root, ['--diff', 'HEAD~0', '--dry-run'], { PATH: `${bin}:${process.env.PATH}`, AGENTBOX_CONFIG: m });
  assert.equal(r.status, 0, r.stderr);
  const plan = JSON.parse(r.stdout);
  assert.equal(plan.agent, 'claude'); assert.equal(plan.model_auth, 'local'); assert.equal(plan.batch_size, '3');
  assert.deepEqual(plan.route, { mode: 'local', provider: 'local' });
  assert.equal(plan.policy_source, m);
  assert.equal(r.log, '--version\n'); // dry-run only asks deepsec for its version
});

test('env overrides beat the manifest and are validated', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); makeFakeCli(bin);
  const m = manifest(root, ENABLED);
  const ok = run(root, ['--scan-only', '--dry-run'], { PATH: `${bin}:${process.env.PATH}`, AGENTBOX_CONFIG: m, DEEPSEC_GATE_FAIL_ON: 'critical' });
  assert.equal(JSON.parse(ok.stdout).fail_on, 'CRITICAL');
  const bad = run(root, ['--scan-only', '--dry-run'], { PATH: `${bin}:${process.env.PATH}`, AGENTBOX_CONFIG: m, DEEPSEC_GATE_THINKING_LEVEL: 'max' });
  assert.equal(bad.status, 78); assert.match(bad.stderr, /thinking_level/);
});

test('direct route requires provider, key env name and a set credential; writes names only', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); makeFakeCli(bin);
  const m = manifest(root, ENABLED.replace('model_auth = "local"', 'model_auth = "direct"\nai_provider = "anthropic"\nai_api_key_env = "MY_TEST_KEY"'));
  const unset = run(root, ['--diff-working'], { PATH: `${bin}:${process.env.PATH}`, AGENTBOX_CONFIG: m });
  assert.equal(unset.status, 78); assert.match(unset.stderr, /MY_TEST_KEY/);
  const set = run(root, ['--diff-working'], { PATH: `${bin}:${process.env.PATH}`, AGENTBOX_CONFIG: m, MY_TEST_KEY: 'sk-secret-value' });
  assert.equal(set.status, 0, set.stderr);
  const cfg = readFileSync(join(root, '.deepsec-gate', 'deepsec.config.mjs'), 'utf8');
  assert.match(cfg, /"apiKeyEnv": "MY_TEST_KEY"/); assert.doesNotMatch(cfg, /sk-secret-value/);
});

test('PR mode: clean run passes, writes a PASS receipt and the generated config', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); makeFakeCli(bin);
  const m = manifest(root, ENABLED);
  const rep = join(root, 'rep');
  const r = run(root, ['--diff', 'HEAD', '--report-dir', rep], { PATH: `${bin}:${process.env.PATH}`, AGENTBOX_CONFIG: m });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.log, /process --diff HEAD --project-id \S+ --root \S+ --no-tui --agent claude --thinking-level high --batch-size 3 --concurrency 1 --comment-out/);
  const receipt = JSON.parse(readFileSync(join(rep, 'receipt.json'), 'utf8'));
  assert.equal(receipt.result, 'PASS'); assert.equal(receipt.net_new_reported_by_deepsec, false);
  assert.match(readFileSync(join(root, '.deepsec-gate', 'deepsec.config.mjs'), 'utf8'), /"mode": "local"/);
  assert.equal(readFileSync(join(root, '.deepsec-gate', '.gitignore'), 'utf8'), '*\n');
});

test('PR mode: a HIGH finding blocks under fail_on=HIGH, a MEDIUM one does not', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); makeFakeCli(bin);
  const m = manifest(root, ENABLED);
  const high = JSON.stringify([{ severity: 'HIGH', filePath: 'app.js', title: 'SQLi', lineNumbers: [3] }]);
  const r1 = run(root, ['--diff', 'HEAD', '--report-dir', join(root, 'r1')], { PATH: `${bin}:${process.env.PATH}`, AGENTBOX_CONFIG: m, FAKE_DEEPSEC_FINDINGS: high, FAKE_DEEPSEC_RC: '1' });
  assert.equal(r1.status, 1, r1.stderr);
  const rc1 = JSON.parse(readFileSync(join(root, 'r1', 'receipt.json'), 'utf8'));
  assert.equal(rc1.result, 'BLOCK'); assert.equal(rc1.blocking.length, 1); assert.equal(rc1.blocking[0].severity, 'HIGH');
  assert.equal(rc1.net_new_reported_by_deepsec, true);
  const medium = JSON.stringify([{ severity: 'MEDIUM', filePath: 'app.js', title: 'weak', lineNumbers: [1] }]);
  const r2 = run(root, ['--diff', 'HEAD', '--report-dir', join(root, 'r2')], { PATH: `${bin}:${process.env.PATH}`, AGENTBOX_CONFIG: m, FAKE_DEEPSEC_FINDINGS: medium, FAKE_DEEPSEC_RC: '1' });
  assert.equal(r2.status, 0, r2.stderr);
  const rc2 = JSON.parse(readFileSync(join(root, 'r2', 'receipt.json'), 'utf8'));
  assert.equal(rc2.result, 'PASS'); assert.equal(rc2.findings_by_severity.MEDIUM, 1);
});

test('PR mode: an unexpected deepsec exit is a runtime error (70), not a pass', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); makeFakeCli(bin);
  const m = manifest(root, ENABLED);
  const r = run(root, ['--diff-staged'], { PATH: `${bin}:${process.env.PATH}`, AGENTBOX_CONFIG: m, FAKE_DEEPSEC_RC: '3' });
  assert.equal(r.status, 70); assert.match(r.stderr, /runtime error/);
});

test('scan-only never blocks and counts candidates without needing a model login', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); makeFakeCli(bin, { withClaude: false });
  const m = manifest(root, ENABLED);
  const rep = join(root, 'rep');
  const r = run(root, ['--scan-only', '--report-dir', rep], { PATH: `${bin}:${process.env.PATH}`, AGENTBOX_CONFIG: m });
  assert.equal(r.status, 0, r.stderr);
  const receipt = JSON.parse(readFileSync(join(rep, 'receipt.json'), 'utf8'));
  assert.equal(receipt.result, 'SCANNED'); assert.equal(receipt.candidates, 2);
});

test('no manifest at all falls back to defaults (PR-mode still works in CI)', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); makeFakeCli(bin);
  const r = run(root, ['--diff', 'HEAD', '--dry-run'], { PATH: `${bin}:${process.env.PATH}`, AGENTBOX_CONFIG: join(root, 'absent.toml') });
  assert.equal(r.status, 0, r.stderr);
  const plan = JSON.parse(r.stdout);
  assert.equal(plan.policy_source, 'defaults'); assert.equal(plan.fail_on, 'HIGH'); assert.equal(plan.max_duration, '45m');
});
