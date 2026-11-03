// node --test tests/config/visioncraft-deepsec.test.mjs
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
const GATE = join(HERE, '../../scripts/visioncraft-deepsec-gate.sh');

// The image bakes deepsec ([toolchains].deepsec), so the ambient PATH already
// resolves it. Every test decides availability through its own shim dir, so any
// inherited directory that provides `deepsec` must be stripped — otherwise the
// "missing deepsec binary" case silently shells out to the real CLI and passes.
const PATH_NO_DEEPSEC = (process.env.PATH || '')
  .split(':')
  .filter((d) => d && !existsSync(join(d, 'deepsec')))
  .join(':');

function makeRepo() {
  const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'deepsec-gate-'));
  const r = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  r(['init', '-q']); r(['config', 'user.email', 'gate@test']); r(['config', 'user.name', 'gate']);
  writeFileSync(join(root, '.gitignore'), 'bin/\nagentbox.toml\nfake.log\nselected-input.json\n.fixture-env.json\nrep/\nr1/\nr2/\nfiles.txt\n');
  writeFileSync(join(root, 'app.js'), 'export const x = 1;\n');
  r(['add', '.']); r(['commit', '-q', '-m', 'init']);
  writeFileSync(join(root, 'app.js'), 'export const x = 2;\n'); r(['add', 'app.js']);
  return root;
}

// A fake deepsec that records argv, honours FAKE_DEEPSEC_FINDINGS (JSON array of
// findings) and FAKE_DEEPSEC_RC (exit code for `process`).
function makeFakeCli(binDir, { withClaude = true } = {}) {
  mkdirSync(binDir, { recursive: true });
  const cli = `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const root = option('--root', path.dirname(process.cwd()));
const settings = JSON.parse(fs.readFileSync(path.join(root, '.fixture-env.json'), 'utf8'));
fs.appendFileSync(path.join(root, 'fake.log'), args.join(' ') + '\\n');
if (args[0] === '--version') { console.log('2.3.10'); process.exit(0); }
const project = option('--project-id', path.basename(root));
const data = path.join(process.cwd(), 'data', project);
const write = (name, value) => { fs.mkdirSync(path.dirname(name), {recursive:true}); fs.writeFileSync(name, JSON.stringify(value)); };
if (args[0] === 'scan') {
  for (let i = 1; i < args.length; i += 2) if (!['--project-id','--root','--matchers'].includes(args[i])) process.exit(1);
  write(path.join(data, 'files', 'app.js.json'), {filePath:'app.js',status:'pending',candidates:[{vulnSlug:'xss'},{vulnSlug:'sqli'}]});
  process.exit(0);
}
if (args[0] === 'process') {
  if (settings.FAKE_NO_EVIDENCE === '1') process.exit(0);
  const list = option('--files-from');
  const files = list ? fs.readFileSync(list, 'utf8').trim().split('\\n') : ['app.js'];
  write(path.join(root, 'selected-input.json'), files);
  const runId = crypto.randomUUID();
  write(path.join(data, 'runs', runId+'.json'), {runId,projectId:project,rootPath:root,type:'process',phase:'done',completedAt:'2026-11-03T00:00:00Z',stats:{filesProcessed:files.length}});
  for (const file of files) write(path.join(data, 'files', file+'.json'), {
    filePath:file,projectId:project,fileHash:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),status:'analyzed',
    analysisHistory:[{runId,model:'fixture-model',agentType:'fixture-agent',refusal:{refused:false},usage:{outputTokens:42}}],
  });
  if (settings.FAKE_DEEPSEC_FINDINGS && settings.FAKE_DEEPSEC_FINDINGS !== '[]') fs.writeFileSync(option('--comment-out'), 'fresh findings');
  process.exit(Number(settings.FAKE_DEEPSEC_RC || 0));
}
if (args[0] === 'export') {
  if (settings.FAKE_EXPORT_ERROR === '1') process.exit(1);
  fs.writeFileSync(option('--out'), settings.FAKE_DEEPSEC_FINDINGS || '[]'); process.exit(0);
}
process.exit(64);
`;
  writeFileSync(join(binDir, 'deepsec'), cli); chmodSync(join(binDir, 'deepsec'), 0o755);
  if (withClaude) { writeFileSync(join(binDir, 'claude'), '#!/usr/bin/env bash\nexit 0\n'); chmodSync(join(binDir, 'claude'), 0o755); }
}

function manifest(dir, body) {
  const p = join(dir, 'agentbox.toml');
  writeFileSync(p, body);
  return p;
}

function run(root, args, env = {}, input) {
  const log = join(root, 'fake.log');
  writeFileSync(join(root, '.fixture-env.json'), JSON.stringify(Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith('FAKE_')))));
  const res = spawnSync('bash', [GATE, ...args], {
    cwd: root, encoding: 'utf8', input,
    env: { ...process.env, FAKE_DEEPSEC_LOG: log, ...env },
  });
  return { ...res, log: existsSync(log) ? readFileSync(log, 'utf8') : '' };
}

const ENABLED = `[toolchains]\ndeepsec = true\n\n[security.deepsec]\nenabled = true\nagent = "claude"\nmodel_auth = "local"\nthinking_level = "high"\nfail_on = "HIGH"\nmax_duration = "5m"\nbatch_size = 3\nconcurrency = 1\n`;

test('disabled policy exits 78 and never invokes deepsec', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); makeFakeCli(bin);
  const m = manifest(root, ENABLED.replace('enabled = true', 'enabled = false'));
  const r = run(root, ['--diff-working'], { PATH: `${bin}:${PATH_NO_DEEPSEC}`, AGENTBOX_CONFIG: m });
  assert.equal(r.status, 78); assert.match(r.stderr, /disabled by policy/); assert.equal(r.log, '');
});

test('missing deepsec binary exits 78 with the rebuild hint', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); mkdirSync(bin);
  const m = manifest(root, ENABLED);
  // an empty shim dir first, then the real PATH (which has no deepsec)
  const r = run(root, ['--diff-working'], { PATH: `${bin}:${PATH_NO_DEEPSEC}`, AGENTBOX_CONFIG: m });
  assert.equal(r.status, 78, r.stderr); assert.match(r.stdout + r.stderr, /deepsec/i);
});

test('dry-run prints the resolved plan with the local route and manifest policy', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); makeFakeCli(bin);
  const m = manifest(root, ENABLED);
  const r = run(root, ['--diff', 'HEAD~0', '--dry-run'], { PATH: `${bin}:${PATH_NO_DEEPSEC}`, AGENTBOX_CONFIG: m });
  assert.equal(r.status, 0, r.stderr);
  const plan = JSON.parse(r.stdout);
  assert.equal(plan.policy.agent, 'claude'); assert.equal(plan.policy.model_auth, 'local'); assert.equal(plan.policy.batch_size, 3);
  assert.deepEqual(plan.route, { mode: 'local', provider: 'local' });
  assert.equal(plan.policy.policy_source, m);
  assert.equal(r.log, ''); // portable dry-run executes no subprocess
});

test('env overrides beat the manifest and are validated', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); makeFakeCli(bin);
  const m = manifest(root, ENABLED);
  const ok = run(root, ['--scan-only', '--dry-run'], { PATH: `${bin}:${PATH_NO_DEEPSEC}`, AGENTBOX_CONFIG: m, DEEPSEC_GATE_FAIL_ON: 'critical' });
  assert.equal(JSON.parse(ok.stdout).policy.fail_on, 'CRITICAL');
  const bad = run(root, ['--scan-only', '--dry-run'], { PATH: `${bin}:${PATH_NO_DEEPSEC}`, AGENTBOX_CONFIG: m, DEEPSEC_GATE_THINKING_LEVEL: 'max' });
  assert.equal(bad.status, 78); assert.match(bad.stderr, /thinking.level/);
});

test('direct route requires provider, key env name and a set credential; writes names only', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); makeFakeCli(bin);
  const m = manifest(root, ENABLED.replace('model_auth = "local"', 'model_auth = "direct"\nai_provider = "anthropic"\nai_api_key_env = "MY_TEST_KEY"'));
  const unset = run(root, ['--diff-working'], { PATH: `${bin}:${PATH_NO_DEEPSEC}`, AGENTBOX_CONFIG: m });
  assert.equal(unset.status, 78); assert.match(unset.stderr, /credential/);
  const set = run(root, ['--diff-working'], { PATH: `${bin}:${PATH_NO_DEEPSEC}`, AGENTBOX_CONFIG: m, MY_TEST_KEY: 'sk-secret-value' });
  assert.equal(set.status, 0, set.stderr);
  const cfg = readFileSync(join(root, '.deepsec-gate', 'deepsec.config.mjs'), 'utf8');
  assert.match(cfg, /"apiKeyEnv": "MY_TEST_KEY"/); assert.doesNotMatch(cfg, /sk-secret-value/);
});

test('PR mode: clean run passes, writes a PASS receipt and the generated config', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); makeFakeCli(bin);
  const m = manifest(root, ENABLED);
  const rep = join(root, 'rep');
  const r = run(root, ['--diff', 'HEAD', '--report-dir', rep], { PATH: `${bin}:${PATH_NO_DEEPSEC}`, AGENTBOX_CONFIG: m });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.log, /process .*--files-from/);
  assert.match(r.log, /--batch-size 3/);
  const receipt = JSON.parse(readFileSync(join(rep, 'receipt.json'), 'utf8'));
  assert.equal(receipt.result, 'PASS'); assert.equal(receipt.net_new_reported_by_deepsec, false);
  assert.match(readFileSync(join(root, '.deepsec-gate', 'deepsec.config.mjs'), 'utf8'), /"mode": "local"/);
  assert.equal(readFileSync(join(root, '.deepsec-gate', '.gitignore'), 'utf8'), '*\n');
});

test('PR mode: a HIGH finding blocks under fail_on=HIGH, a MEDIUM one does not', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); makeFakeCli(bin);
  const m = manifest(root, ENABLED);
  const high = JSON.stringify([{ severity: 'HIGH', filePath: 'app.js', title: 'SQLi', lineNumbers: [3] }]);
  const r1 = run(root, ['--diff', 'HEAD', '--report-dir', join(root, 'r1')], { PATH: `${bin}:${PATH_NO_DEEPSEC}`, AGENTBOX_CONFIG: m, FAKE_DEEPSEC_FINDINGS: high, FAKE_DEEPSEC_RC: '1' });
  assert.equal(r1.status, 1, r1.stderr);
  const rc1 = JSON.parse(readFileSync(join(root, 'r1', 'receipt.json'), 'utf8'));
  assert.equal(rc1.result, 'BLOCK'); assert.equal(rc1.blocking.length, 1); assert.equal(rc1.blocking[0].severity, 'HIGH');
  assert.equal(rc1.net_new_reported_by_deepsec, true);
  const medium = JSON.stringify([{ severity: 'MEDIUM', filePath: 'app.js', title: 'weak', lineNumbers: [1] }]);
  const r2 = run(root, ['--diff', 'HEAD', '--report-dir', join(root, 'r2')], { PATH: `${bin}:${PATH_NO_DEEPSEC}`, AGENTBOX_CONFIG: m, FAKE_DEEPSEC_FINDINGS: medium, FAKE_DEEPSEC_RC: '1' });
  assert.equal(r2.status, 0, r2.stderr);
  const rc2 = JSON.parse(readFileSync(join(root, 'r2', 'receipt.json'), 'utf8'));
  assert.equal(rc2.result, 'PASS'); assert.equal(rc2.findings_by_severity.MEDIUM, 1);
});

test('PR mode: an unexpected deepsec exit is a runtime error (70), not a pass', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); makeFakeCli(bin);
  const m = manifest(root, ENABLED);
  const r = run(root, ['--diff-staged'], { PATH: `${bin}:${PATH_NO_DEEPSEC}`, AGENTBOX_CONFIG: m, FAKE_DEEPSEC_RC: '3' });
  assert.equal(r.status, 70); assert.match(r.stdout + r.stderr, /process|runtime|exit/i);
});

test('scan-only reports SCANNED without pretending to complete a model review', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); makeFakeCli(bin, { withClaude: false });
  const m = manifest(root, ENABLED);
  const rep = join(root, 'rep');
  const r = run(root, ['--scan-only', '--report-dir', rep], { PATH: `${bin}:${PATH_NO_DEEPSEC}`, AGENTBOX_CONFIG: m });
  assert.equal(r.status, 0, r.stderr);
  const receipt = JSON.parse(readFileSync(join(rep, 'receipt.json'), 'utf8'));
  assert.equal(receipt.result, 'SCANNED'); assert.match(receipt.boundary, /not a completed model review/);
});

test('explicit missing manifest refuses paid defaults', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); makeFakeCli(bin);
  const r = run(root, ['--diff', 'HEAD', '--dry-run'], { PATH: `${bin}:${PATH_NO_DEEPSEC}`, AGENTBOX_CONFIG: join(root, 'absent.toml') });
  assert.equal(r.status, 78, r.stderr);
  assert.equal(r.log, '');
});


test('relative file manifest is resolved before changing to the review workspace', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); makeFakeCli(bin);
  const m = manifest(root, ENABLED);
  writeFileSync(join(root, 'files.txt'), 'app.js\n');
  const r = run(root, ['--files-from', 'files.txt'], { PATH: `${bin}:${PATH_NO_DEEPSEC}`, AGENTBOX_CONFIG: m });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.log, /--files-from \//);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'selected-input.json'), 'utf8')), ['app.js']);
});

test('missing manifest fails before invoking the reviewer', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); makeFakeCli(bin);
  const r = run(root, ['--files-from', 'absent.txt'], { PATH: `${bin}:${PATH_NO_DEEPSEC}`, AGENTBOX_CONFIG: manifest(root, ENABLED) });
  assert.equal(r.status, 78, r.stderr);
  assert.equal(r.log, '');
});

test('exit 1 without a new findings comment is an error even if export would succeed', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); makeFakeCli(bin);
  const rep = join(root, 'rep');
  const r = run(root, ['--diff', 'HEAD', '--report-dir', rep], {
    PATH: `${bin}:${PATH_NO_DEEPSEC}`, AGENTBOX_CONFIG: manifest(root, ENABLED), FAKE_DEEPSEC_RC: '1',
  });
  assert.equal(r.status, 70, r.stderr);
  assert.doesNotMatch(r.stdout, /PASS/);
});

test('export failure and malformed export cannot produce a PASS receipt', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); makeFakeCli(bin);
  const m = manifest(root, ENABLED);
  for (const env of [{ FAKE_EXPORT_ERROR: '1' }, { FAKE_DEEPSEC_FINDINGS: '{}' }, { FAKE_DEEPSEC_FINDINGS: '{' }]) {
    const rep = join(root, `rep-${Object.values(env)[0].length}-${Object.keys(env)[0]}`);
    const r = run(root, ['--diff', 'HEAD', '--report-dir', rep], { PATH: `${bin}:${PATH_NO_DEEPSEC}`, AGENTBOX_CONFIG: m, ...env });
    assert.equal(r.status, 70, r.stderr);
    assert.doesNotMatch(r.stdout, /PASS/);
  }
});

test('reused report directory cannot lend stale success evidence to another invocation', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); makeFakeCli(bin);
  const rep = join(root, 'rep'); mkdirSync(rep); writeFileSync(join(rep, 'comment.md'), 'old findings');
  const r = run(root, ['--diff', 'HEAD', '--report-dir', rep], {
    PATH: `${bin}:${PATH_NO_DEEPSEC}`, AGENTBOX_CONFIG: manifest(root, ENABLED), FAKE_DEEPSEC_RC: '1',
  });
  assert.equal(r.status, 78, r.stderr);
  assert.doesNotMatch(r.log, /process/);
  assert.equal(readFileSync(join(rep, 'comment.md'), 'utf8'), 'old findings');
});


test('malformed finding rows and unknown severities fail closed', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); makeFakeCli(bin);
  const m = manifest(root, ENABLED);
  const invalid = [[null], [42], [{}], [{severity: 'SUPERHIGH'}], [{severity: null}], [{findings: [null]}], [{findings: [{}]}]];
  for (const [i, data] of invalid.entries()) {
    const r = run(root, ['--diff', 'HEAD', '--report-dir', join(root, `invalid-${i}`)], {
      PATH: `${bin}:${PATH_NO_DEEPSEC}`, AGENTBOX_CONFIG: m, FAKE_DEEPSEC_FINDINGS: JSON.stringify(data), FAKE_DEEPSEC_RC: '1',
    });
    assert.equal(r.status, 70, `${JSON.stringify(data)}: ${r.stdout} ${r.stderr}`);
    assert.doesNotMatch(r.stdout, /PASS/);
  }
  const r = run(root, ['--diff', 'HEAD', '--report-dir', join(root, 'nested-valid')], {
    PATH: `${bin}:${PATH_NO_DEEPSEC}`, AGENTBOX_CONFIG: m,
    FAKE_DEEPSEC_FINDINGS: JSON.stringify([{filePath: 'app.js', findings: [{severity: 'HIGH', title: 'nested'}]}]), FAKE_DEEPSEC_RC: '1',
  });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /BLOCK/);
});

test('zero exit and empty export without fresh review evidence cannot pass through the host', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); makeFakeCli(bin);
  const rep = join(root, 'rep');
  const r = run(root, ['--diff', 'HEAD', '--report-dir', rep], {
    PATH: `${bin}:${PATH_NO_DEEPSEC}`, AGENTBOX_CONFIG: manifest(root, ENABLED), FAKE_NO_EVIDENCE: '1',
  });
  assert.equal(r.status, 70, r.stderr);
  assert.equal(JSON.parse(readFileSync(join(rep, 'receipt.json'), 'utf8')).result, 'ERROR');
});

test('stdin file lists survive host policy projection and explicit flags override it', () => {
  const root = makeRepo(); const bin = join(root, 'bin'); makeFakeCli(bin);
  const rep = join(root, 'rep');
  const r = run(root, ['--files-from', '-', '--fail-on', 'LOW', '--report-dir', rep], {
    PATH: `${bin}:${PATH_NO_DEEPSEC}`, AGENTBOX_CONFIG: manifest(root, ENABLED),
    FAKE_DEEPSEC_FINDINGS: JSON.stringify([{severity: 'MEDIUM', title: 'fixture'}]), FAKE_DEEPSEC_RC: '1',
  }, 'app.js\n');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const receipt = JSON.parse(readFileSync(join(rep, 'receipt.json'), 'utf8'));
  assert.equal(receipt.fail_on, 'LOW');
  assert.equal(receipt.result, 'BLOCK');
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'selected-input.json'), 'utf8')), ['app.js']);
});
