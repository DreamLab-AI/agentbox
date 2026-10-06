const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Delivery, layerReport, main } = require('../../scripts/runtime-delivery.cjs');

const digest = `sha256:${'a'.repeat(64)}`;
const live = { Id: 'live-container', Image: digest, State: { StartedAt: 'unchanged' } };
test('public CLI recognises prepare, activate and rebuild help without Docker operations', () => {
  for (const command of ['prepare', 'activate', 'rebuild']) {
    const r = spawnSync('bash', [path.join(__dirname, '../../agentbox.sh'), command, '--help'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /Usage: agentbox.sh prepare/);
  }
});
test('rebuild --prepare-only never activates; plain rebuild prepares exactly once', () => {
  const calls = [];
  const flow = { prepare: mode => calls.push(['prepare', mode]), activate: () => calls.push(['activate']) };
  main(['rebuild', '--prepare-only'], flow);
  assert.deepEqual(calls, [['prepare', 'registry']]);
  calls.length = 0;
  main(['rebuild', '--no-cleanup'], flow);
  assert.deepEqual(calls, [['prepare', 'registry'], ['activate']]);
});
test('missing delivery value, unknown flags and build-only activation fail before any action', () => {
  const calls = [];
  const flow = { prepare: () => calls.push('prepare'), activate: () => calls.push('activate') };
  for (const args of [['prepare', '--delivery'], ['rebuild', '--prepare-ony'], ['rebuild', '--delivery', 'none']]) {
    assert.throws(() => main(args, flow));
  }
  assert.deepEqual(calls, []);
});
function fixture(t, failAt) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'agentbox-delivery-test-'));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repo, 'config'));
  fs.mkdirSync(path.join(repo, '.agentbox-build'));
  fs.writeFileSync(path.join(repo, 'agentbox.toml'), '[test]\n');
  fs.writeFileSync(path.join(repo, 'docker-compose.override.yml'), 'services: {}');
  fs.copyFileSync(path.join(__dirname, '../../config/build-registry.json'), path.join(repo, 'config/build-registry.json'));
  const imagePath = path.join(repo, 'hash-image-agentbox.json');
  fs.writeFileSync(imagePath, JSON.stringify({ layers: [{ size: 123, digest, diff_ids: digest, paths: [{ path: '/nix/store/example' }] }] }));
  const copier = path.join(repo, 'copier');
  fs.mkdirSync(path.join(copier, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(copier, 'bin/copy-to'), 'fixture');
  const calls = [];
  const state = { config: 'original', imageId: digest, current: live, registry: null };
  const runner = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (failAt?.(cmd, args)) throw new Error('injected failure');
    if (cmd === 'nix') return JSON.stringify([{ outputs: { out: imagePath } }, { outputs: { out: copier } }]);
    if (cmd.endsWith('/bin/copy-to') && args.includes('--digestfile')) {
      fs.writeFileSync(args[args.indexOf('--digestfile') + 1], digest);
    }
    if (cmd === 'docker') {
      if (args[0] === 'run' && args.includes('--name')) state.registry = { State: { Running: true } };
      if (args[0] === 'context') return 'unix:///var/run/docker.sock';
      if (args[0] === 'info') return 'linux';
      if (args[0] === 'container' && args[1] === 'inspect') {
        const value = args[2] === 'agentbox' ? state.current : state.registry;
        return value ? JSON.stringify([value]) : null;
      }
      if (args[0] === 'image') return JSON.stringify([{ Id: state.imageId, RootFS: { Layers: [digest] } }]);
      if (args.includes('config')) return JSON.stringify({ services: { agentbox: { image: opts.env.AGENTBOX_IMAGE_REF } }, marker: state.config });
    }
    return '';
  };
  return { flow: new Delivery(repo, runner), calls, state, repo };
}
function noDisruption(calls) {
  assert.ok(!calls.some(c => c.cmd === 'docker' && c.args.some(a => ['down', 'stop', 'restart', 'kill', 'prune'].includes(a))));
  assert.ok(!calls.some(c => c.args[0] === 'compose' && c.args.includes('up')));
}

test('layer report detects cross-layer duplication and measures changed bytes', () => {
  const a = { digest: 'a', size: 10, paths: [{ path: '/a' }] };
  const b = { digest: 'b', size: 20, paths: [{ path: '/a' }] };
  const r = layerReport({ layers: [a, b] }, { layers: [a] });
  assert.equal(r.changedBytes, 20);
  assert.deepEqual(r.duplicatePaths, ['/a']);
});
test('root rewrite and original store path are different destinations', () => {
  const r = layerReport({ layers: [{ size: 1, paths: [{ path: '/a' }, { path: '/a', options: { rewrite: { repl: '' } } }] }] });
  assert.deepEqual(r.duplicatePaths, []);
});
for (const mode of ['daemon', 'registry', 'none']) {
  test(`prepare ${mode} builds once and never touches the live lifecycle`, t => {
    const f = fixture(t);
    const r = f.flow.prepare(mode);
    noDisruption(f.calls);
    assert.equal(f.calls.filter(c => c.cmd === 'nix').length, 1);
    assert.equal(r.preparedFrom, live.Id);
    assert.equal(fs.existsSync(path.join(f.flow.state, 'candidate.json')), mode !== 'none');
    const smoke = f.calls.find(c => c.cmd === 'docker' && c.args[0] === 'run' && c.args.includes('--rm'));
    if (mode !== 'none') {
      assert.ok(smoke.args.includes('none'));
      assert.ok(smoke.args.includes('--read-only'));
      assert.ok(!smoke.args.includes('-v') && !smoke.args.includes('--mount'));
      assert.ok(smoke.args.includes('--entrypoint'));
      assert.ok(!smoke.args.includes('--env-file'));
    }
    if (mode === 'registry') {
      const reg = f.calls.find(c => c.args.includes('--name'));
      assert.ok(reg.args.includes('REGISTRY_HTTP_ADDR=127.0.0.1:15000'));
      assert.ok(reg.args.includes('host'));
      assert.ok(r.imageRef.includes('@sha256:'));
    }
  });
}
for (const failure of ['build', 'delivery', 'smoke']) {
  test(`${failure} failure preserves previous candidate and live container`, t => {
    const f = fixture(t, (cmd, args) => failure === 'build' ? cmd === 'nix'
      : failure === 'delivery' ? cmd.endsWith('/bin/copy-to') : cmd === 'docker' && args.includes('--rm'));
    const file = path.join(f.flow.state, 'candidate.json');
    const prior = JSON.stringify({ imagePath: '/absent', retained: true });
    fs.writeFileSync(file, prior);
    assert.throws(() => f.flow.prepare('daemon'), /injected failure/);
    assert.equal(fs.readFileSync(file, 'utf8'), prior);
    noDisruption(f.calls);
  });
}
for (const drift of ['manifest', 'config', 'image', 'container', 'restart']) {
  test(`activation rejects ${drift} drift before any mutation`, t => {
    const f = fixture(t);
    f.flow.prepare('daemon');
    f.calls.length = 0;
    if (drift === 'manifest') fs.appendFileSync(path.join(f.repo, 'agentbox.toml'), '# drift');
    if (drift === 'config') f.state.config = 'changed';
    if (drift === 'image') f.state.imageId = 'different';
    if (drift === 'container') f.state.current = { ...live, Id: 'different' };
    if (drift === 'restart') f.state.current = { ...live, State: { StartedAt: 'different' } };
    assert.throws(() => f.flow.activate(), /changed/);
    noDisruption(f.calls);
    assert.ok(!f.calls.some(c => c.args[0] === 'tag'));
  });
}
test('activation merges override, tags recovery and scopes replacement to agentbox', t => {
  const f = fixture(t);
  f.flow.prepare('daemon');
  f.calls.length = 0;
  f.flow.activate();
  const up = f.calls.find(c => c.args[0] === 'compose' && c.args.includes('up'));
  assert.ok(up.args.includes(path.join(f.repo, 'docker-compose.override.yml')));
  assert.deepEqual(up.args.slice(-7), ['up', '-d', '--no-deps', '--force-recreate', '--pull', 'never', 'agentbox']);
  assert.equal(up.opts.env.AGENTBOX_IMAGE_HASH, digest);
  assert.ok(f.calls.some(c => c.args[0] === 'tag'));
  assert.ok(!f.calls.some(c => c.args.includes('down') || c.args.includes('prune')));
});
test('foreign registry with colliding name is never adopted/replaced', t => {
  const f = fixture(t);
  f.state.registry = { Config: { Labels: {} } };
  assert.throws(() => f.flow.registry(), /differs/);
  noDisruption(f.calls);
});
test('fast activation rejects a persistent-volume migration before touching the runtime', t => {
  const f = fixture(t);
  f.flow.prepare('daemon');
  f.calls.length = 0;
  f.state.current = { ...live, Mounts: [{ Type: 'volume', Name: 'crucial-data', Destination: '/data', RW: true }] };
  assert.throws(() => f.flow.activate(), /Persistent mounts would change/);
  noDisruption(f.calls);
});
test('candidate layer mismatch fails before smoke or receipt promotion', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.repo, 'hash-image-agentbox.json'), JSON.stringify({ layers: [] }));
  assert.throws(() => f.flow.prepare('daemon'), /layers differ/);
  assert.ok(!fs.existsSync(path.join(f.flow.state, 'candidate.json')));
  noDisruption(f.calls);
});
test('only old successful workflow-owned GC-root symlinks are released', t => {
  const f = fixture(t);
  for (const name of ['old', 'current', 'previous', 'active', 'failed']) {
    const dir = path.join(f.flow.state, `generation-${name}`);
    fs.mkdirSync(dir);
    if (name !== 'failed') fs.writeFileSync(path.join(dir, 'receipt.json'), '{}');
    fs.symlinkSync('/nix/store/example', path.join(dir, 'result'));
    fs.writeFileSync(path.join(dir, 'result-1'), 'not a symlink, never delete');
    fs.symlinkSync('/data/important', path.join(dir, 'result-2'));
  }
  f.flow.releaseOldRoots(new Set(['current', 'previous', 'active'].map(n => path.join(f.flow.state, `generation-${n}`))));
  assert.throws(() => fs.lstatSync(path.join(f.flow.state, 'generation-old/result')), /ENOENT/);
  for (const name of ['current', 'previous', 'active', 'failed']) {
    assert.ok(fs.lstatSync(path.join(f.flow.state, `generation-${name}/result`)).isSymbolicLink());
  }
  assert.ok(fs.existsSync(path.join(f.flow.state, 'generation-old/result-1')));
  assert.ok(fs.lstatSync(path.join(f.flow.state, 'generation-old/result-2')).isSymbolicLink());
});
