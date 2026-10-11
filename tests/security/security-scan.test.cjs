const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.resolve(__dirname, '../../scripts/security-scan.sh');
const digest = `sha256:${'a'.repeat(64)}`;
const image = `ghcr.io/dreamlab-ai/agentbox@${digest}`;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentbox-security-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tools = path.join(root, 'tools');
  const evidence = path.join(root, 'evidence');
  const payload = path.join(root, 'actual-payload');
  const report = path.join(root, 'report');
  const output = path.join(root, 'output');
  const log = path.join(root, 'calls.jsonl');
  fs.mkdirSync(path.join(tools, 'bin'), { recursive: true });
  fs.mkdirSync(evidence);
  fs.mkdirSync(payload);
  fs.mkdirSync(report);
  fs.writeFileSync(path.join(report, 'bundle.json'), JSON.stringify({ subject: digest }));
  fs.symlinkSync(payload, path.join(evidence, 'payload'));
  fs.writeFileSync(path.join(evidence, 'metadata.json'), '{}');
  fs.writeFileSync(path.join(evidence, 'image.json'), '{}');
  const driver = path.join(tools, 'driver.cjs');
  fs.writeFileSync(driver, `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const name = path.basename(process.argv[1]), args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_CALL_LOG, JSON.stringify({name, args, grype_env: name === 'grype' ? Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('GRYPE_'))) : undefined})+'\\n');
const value = flag => args[args.indexOf(flag)+1];
if (name === 'sbomnix') for (const flag of ['--cdx','--spdx','--csv']) fs.writeFileSync(value(flag), '{}');
if (name === 'agentbox-vex') {
  if (args[0] === process.env.TEST_FAIL_COMMAND) process.exit(1);
  if (args[0] === 'report' || args[0] === 'bind') {
    const out = value('--output'); fs.mkdirSync(out,{recursive:true});
    for(const file of ['sbom.nix.cyclonedx.json','vex.openvex.json']) fs.writeFileSync(path.join(out,file),'{}');
    fs.writeFileSync(path.join(out,'bundle.json'),JSON.stringify({subject:${JSON.stringify(digest)}}));
  }
}
if(name === 'skopeo') process.stdout.write('{}');
if(name === 'syft') process.stdout.write('{"artifacts":[{"purl":"pkg:nix/openssh@10.3p1"}],"source":{"type":"image"}}');
if(name === 'grype') { process.stdout.write('{"matches":[]}'); if(args.includes('--fail-on')) process.exit(Number(process.env.TEST_GATE_EXIT || 0)); }
if(name === 'nix') process.stdout.write(JSON.stringify([{outputs:{out:process.env.TEST_TOOLS}},{outputs:{out:process.env.TEST_EVIDENCE}}]));
`, { mode: 0o755 });
  for (const name of ['agentbox-vex', 'sbomnix', 'syft', 'grype', 'skopeo', 'nix']) fs.symlinkSync(driver, path.join(tools, 'bin', name));
  const jq = spawnSync('bash', ['-c', 'command -v jq'], { encoding: 'utf8' }).stdout.trim();
  fs.symlinkSync(jq, path.join(tools, 'bin', 'jq'));
  const run = (args, extra = {}) => spawnSync('bash', [script, ...args], {
    encoding: 'utf8', env: { ...process.env, PATH: `${tools}/bin:${process.env.PATH}`, TEST_CALL_LOG: log, TEST_TOOLS: tools, TEST_EVIDENCE: evidence, ...extra },
  });
  const calls = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [];
  return { root, tools, evidence, payload, report, output, run, calls };
}
test('report scans only the real shipped payload and retains all SBOM formats', t => {
  const f = fixture(t);
  const r = f.run(['report', '--tools', f.tools, '--evidence', f.evidence, '--output', f.output, '--subject', digest]);
  assert.equal(r.status, 0, r.stderr);
  const calls = f.calls();
  assert.deepEqual(calls.map(c => c.name), ['sbomnix', 'agentbox-vex']);
  assert.equal(calls[0].args[0], f.payload);
  assert.ok(calls[0].args.includes('--exclude-meta'));
  assert.ok(calls[0].args.includes('--exclude-cpe-matching'));
  assert.deepEqual(calls[1].args.slice(-2), ['--subject', digest]);
  for (const file of ['sbom.nix.spdx.json', 'sbom.nix.csv', 'sbom.nix.cyclonedx.json', 'vex.openvex.json', 'bundle.json']) assert.ok(fs.existsSync(path.join(f.output, file)), file);
});
test('scan verifies input, image bytes/config, binding and subject before applying VEX', t => {
  const f = fixture(t);
  const r = f.run(['scan', '--tools', f.tools, '--report', f.report, '--image', image, '--output', f.output]);
  assert.equal(r.status, 0, r.stderr);
  const calls = f.calls();
  assert.deepEqual(calls.map(c => c.name === 'agentbox-vex' ? c.args[0] : c.name), ['verify', 'skopeo', 'skopeo', 'check-image', 'bind', 'verify', 'syft', 'grype', 'grype']);
  const configRead = calls.find(c => c.name === 'skopeo' && c.args.includes('--config'));
  assert.ok(configRead.args.includes('--raw'), 'config must preserve its manifest-addressed blob bytes');
  const grype = calls.filter(c => c.name === 'grype');
  assert.equal(grype[0].args[0], `sbom:${f.output}/sbom.nix.syft.json`);
  const converted = JSON.parse(fs.readFileSync(path.join(f.output, 'sbom.nix.syft.json')));
  assert.deepEqual(converted.source, {id: digest, name: 'agentbox', version: digest, type: 'directory', metadata: {path: 'agentbox'}});
  assert.equal(converted.artifacts[0].purl, 'pkg:nix/openssh@10.3p1');
  assert.ok(!grype[0].args.includes('--vex'));
  assert.deepEqual(grype[1].args.slice(-2), ['--fail-on', 'high']);
  assert.ok(grype[1].args.includes('--vex'));
  assert.ok(!grype.some(c => c.args.includes('--only-fixed')));
  assert.equal(fs.readFileSync(path.join(f.output, 'grype.config.yaml'), 'utf8'), '{}\n');
});
test('severity gate exit 2 preserves raw and filtered findings and binding evidence', t => {
  const f = fixture(t);
  const r = f.run(['scan', '--tools', f.tools, '--report', f.report, '--image', image, '--output', f.output], { TEST_GATE_EXIT: '2' });
  assert.equal(r.status, 2, r.stderr);
  for (const file of ['grype.raw.json', 'grype.filtered.json', 'grype.filtered.txt', 'image.manifest.json', 'image.config.json', 'evidence/vex.openvex.json']) assert.ok(fs.existsSync(path.join(f.output, file)), file);
  assert.equal(fs.readFileSync(path.join(f.output, 'grype.exit-code.txt'), 'utf8'), '2\n');
});
test('ambient scanner filters cannot hide raw findings or override VEX scope', t => {
  const f = fixture(t);
  const r = f.run(['scan', '--tools', f.tools, '--report', f.report, '--image', image, '--output', f.output], {
    GRYPE_IGNORE_STATES: 'not-fixed', GRYPE_VEX_DOCUMENTS: 'unrelated.json', GRYPE_FAIL_ON_SEVERITY: 'none',
    GRYPE_DB_CACHE_DIR: '/fixture/cache',
  });
  assert.equal(r.status, 0, r.stderr);
  for (const call of f.calls().filter(c => c.name === 'grype')) {
    assert.deepEqual(call.grype_env, {GRYPE_DB_CACHE_DIR: '/fixture/cache', GRYPE_CHECK_FOR_APP_UPDATE: 'false'});
  }
});
test('unmatched registry image fails before binding or scanning', t => {
  const f = fixture(t);
  const r = f.run(['scan', '--tools', f.tools, '--report', f.report, '--image', image, '--output', f.output], { TEST_FAIL_COMMAND: 'check-image' });
  assert.equal(r.status, 1);
  assert.ok(!f.calls().some(c => c.name === 'grype' || c.args[0] === 'bind'));
});
test('tampered input report fails before registry access', t => {
  const f = fixture(t);
  const r = f.run(['scan', '--tools', f.tools, '--report', f.report, '--image', image, '--output', f.output], { TEST_FAIL_COMMAND: 'verify' });
  assert.equal(r.status, 1);
  assert.deepEqual(f.calls().map(c => c.name), ['agentbox-vex']);
});
test('scan without a supplied report builds evidence once and scans its verified binding', t => {
  const f = fixture(t);
  const r = f.run(['scan', '--image', image, '--output', f.output, '--fail-on', 'none']);
  assert.equal(r.status, 0, r.stderr);
  const calls = f.calls();
  assert.equal(calls.filter(c => c.name === 'nix').length, 1);
  assert.ok(calls[0].args.includes('.#runtime.securityEvidence'));
  assert.ok(calls[0].args.includes('.#security-tools'));
  assert.ok(!calls.filter(c => c.name === 'grype').some(c => c.args.includes('--fail-on')));
});
test('bad references, unknown options and missing values fail before running tools', t => {
  const f = fixture(t);
  for (const args of [['scan', '--image', 'repo:latest'], ['scan', '--image'], ['report', '--vraiants', 'runtime'], ['report', '--variant', '../../escape'], ['report', '--subject', 'sha256:bad']]) {
    const r = f.run([...args, '--output', f.output]);
    assert.notEqual(r.status, 0, args.join(' '));
  }
  assert.deepEqual(f.calls(), []);
});
test('workflow contracts keep VEX evidence attached to exact runs and architectures', () => {
  const read = name => fs.readFileSync(path.resolve(__dirname, `../../.github/workflows/${name}.yml`), 'utf8');
  const build = read('build-multi-arch'), scan = read('image-scan'), release = read('release');
  assert.match(build, /nix build \.#runtime \.#runtime\.securityEvidence \.#security-tools/);
  assert.match(build, /security-build-\$\{\{ github.sha \}\}-\$\{\{ matrix.arch \}\}/);
  assert.match(scan, /ref: \$\{\{ steps.build.outputs.sha \}\}/);
  assert.match(scan, /run-id: \$\{\{ steps.build.outputs.run_id \}\}/);
  assert.match(scan, /arch: \[amd64, arm64\]/);
  assert.match(scan, /--report security-build/);
  assert.match(release, /run-id: \$\{\{ steps.scan.outputs.run_id \}\}/);
  assert.match(release, /merge-multiple: false/);
  assert.match(release, /\.image_ref == \$ref/);
  assert.match(release, /\.subject == \$digest/);
  assert.doesNotMatch(release, /continue-on-error: true/);
});
