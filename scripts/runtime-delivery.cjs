#!/usr/bin/env node
'use strict';
// Host tooling, not a runtime service. No production mounts or secrets are
// passed to the build registry or offline candidate smoke-test container.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function atomicJSON(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    cwd: options.cwd, env: { ...process.env, ...options.env },
    stdio: options.capture ? ['ignore', 'pipe', command === 'nix' ? 'inherit' : 'pipe'] : ['ignore', 'inherit', 'inherit'],
    timeout: options.timeout,
  });
  if (result.error || result.status !== 0) {
    if (options.allowFailure) return null;
    // Captured compose output can contain secrets: do not print it on failure.
    throw new Error(`${path.basename(command)} ${args[0] || ''} failed (${result.error?.code || result.status})`);
  }
  return (result.stdout || '').trim();
}
function layerReport(image, previous = null) {
  const seen = new Set(), duplicates = new Set();
  const old = new Set(previous?.layers.map(l => l.digest) || []);
  const layers = image.layers.map((layer, index) => {
    for (const entry of layer.paths) {
      const key = `${entry.path}:${JSON.stringify(entry.options?.rewrite || null)}`;
      if (seen.has(key)) duplicates.add(entry.path);
      seen.add(key);
    }
    return { index, bytes: layer.size, digest: layer.digest,
      group: layer.History?.created_by || 'application', changed: !old.has(layer.digest) };
  });
  return { bytes: layers.reduce((n, l) => n + l.bytes, 0),
    changedBytes: layers.filter(l => l.changed).reduce((n, l) => n + l.bytes, 0),
    duplicatePaths: [...duplicates], layers };
}
function persistentMounts(mounts = []) {
  return mounts.filter(m => ['volume', 'bind'].includes(m.Type)).map(m => ({
    type: m.Type, source: m.Type === 'volume' ? m.Name : m.Source,
    target: m.Destination, readOnly: !m.RW,
  })).sort((a, b) => a.target.localeCompare(b.target));
}
class Delivery {
  constructor(repo, runner = run) {
    this.repo = repo;
    this.state = path.join(repo, '.agentbox-build');
    this.run = (cmd, args, opts = {}) => runner(cmd, args, { cwd: repo, ...opts });
    this.capture = (cmd, args, opts = {}) => this.run(cmd, args, { capture: true, ...opts });
  }
  inspect(kind, name) {
    const output = this.capture('docker', [kind, 'inspect', name], { allowFailure: true });
    return output === null ? null : JSON.parse(output)[0];
  }
  composeArgs() {
    const args = ['compose', '--project-name', 'agentbox', '-f', path.join(this.repo, 'docker-compose.yml')];
    const override = path.join(this.repo, 'docker-compose.override.yml');
    if (fs.existsSync(override)) args.push('-f', override);
    return args;
  }
  env(r) {
    return { AGENTBOX_IMAGE_REF: r.imageRef, AGENTBOX_IMAGE_HASH: r.imageId || '',
      AGENTBOX_MANIFEST_CHECKSUM: r.manifestChecksum };
  }
  configuration(r) {
    const config = this.capture('docker', [...this.composeArgs(), 'config', '--format', 'json'], { env: this.env(r) });
    const parsed = JSON.parse(config);
    if (parsed.services?.agentbox?.image !== r.imageRef) {
      throw new Error('Compose override replaces the candidate image');
    }
    const mounts = (parsed.services.agentbox.volumes || []).filter(m => ['volume', 'bind'].includes(m.type)).map(m => {
      const source = m.type === 'volume' ? parsed.volumes?.[m.source]?.name : m.source;
      if (!source) throw new Error('Candidate persistent mount has no resolved source');
      return { type: m.type, source, target: m.target, readOnly: !!m.read_only };
    }).sort((a, b) => a.target.localeCompare(b.target));
    return { hash: sha(config), mounts };
  }
  manifestChecksum() { return `sha256:${sha(fs.readFileSync(path.join(this.repo, 'agentbox.toml')))}`; }
  registry() {
    const c = readJSON(path.join(this.repo, 'config/build-registry.json'));
    if (!/^127\.0\.0\.1:\d+$/.test(c.address) || !/@sha256:[a-f0-9]{64}$/.test(c.image)) {
      throw new Error('Build registry must be loopback-only and digest-pinned');
    }
    // Host network + explicit loopback listen: no bridge-reachable anonymous
    // listener. A remote Docker daemon would have a different loopback cache.
    const endpoint = this.capture('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
    const effective = process.env.DOCKER_CONTEXT ? endpoint : (process.env.DOCKER_HOST || endpoint);
    if (!effective.startsWith('unix://') || this.capture('docker', ['info', '--format', '{{.OSType}}']) !== 'linux') {
      throw new Error('Registry delivery needs a local Linux Docker socket; use --delivery daemon elsewhere');
    }
    const existing = this.inspect('container', c.container);
    if (existing) {
      if (existing.Config.Labels?.['org.agentbox.build-cache'] !== 'registry-v1'
          || existing.Config.Image !== c.image || existing.HostConfig.NetworkMode !== 'host'
          || !(existing.Config.Env || []).includes(`REGISTRY_HTTP_ADDR=${c.address}`)
          || existing.Mounts.length !== 1
          || !existing.Mounts.some(m => m.Type === 'volume' && m.Name === c.volume && m.Destination === '/var/lib/registry')) {
        throw new Error('Existing registry differs from pinned contract; not replacing it');
      }
      if (!existing.State.Running) this.run('docker', ['start', c.container]);
    } else {
      this.run('docker', ['run', '-d', '--name', c.container, '--network', 'host',
        '--restart', 'unless-stopped', '--read-only', '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges:true', '--memory', '512m', '--cpus', '2',
        '--label', 'org.agentbox.build-cache=registry-v1',
        '-e', `REGISTRY_HTTP_ADDR=${c.address}`, '-e', 'REGISTRY_STORAGE_DELETE_ENABLED=false',
        '-e', 'OTEL_TRACES_EXPORTER=none', '-e', 'REGISTRY_LOG_LEVEL=warn',
        '-v', `${c.volume}:/var/lib/registry`, c.image]);
    }
    this.run('curl', ['--fail', '--silent', '--show-error', '--retry', '15', '--retry-connrefused',
      '--retry-delay', '1', '--max-time', '3', `http://${c.address}/v2/`]);
    if (!this.inspect('container', c.container)?.State.Running) throw new Error('Build registry did not stay running');
    return c;
  }
  smoke(imageRef) {
    // Override entrypoint: no bootstrap, producer, credential sync or timer.
    this.run('docker', ['run', '--rm', '--network', 'none', '--read-only',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
      '--memory', '1g', '--cpus', '2', '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m',
      '--entrypoint', '/bin/sh', imageRef, '-ec',
      'test -r /etc/agentbox.toml; test -x /opt/agentbox/config/entrypoint-unified.sh; ' +
      'agentbox-manifest --help >/dev/null; ' +
      'for tool in codex claude sealmap; do if command -v "$tool" >/dev/null; then "$tool" --version; fi; done']);
  }
  releaseOldRoots(keep) {
    // Bound only OUR successful generation roots, never Docker data, caches,
    // images or store contents. Receipts/logs remain. Failed builds stay rooted
    // for diagnosis until the operator chooses to release them.
    for (const name of fs.readdirSync(this.state)) {
      if (!/^generation-[a-zA-Z0-9]+$/.test(name)) continue;
      const dir = path.join(this.state, name);
      if (keep.has(dir) || !fs.existsSync(path.join(dir, 'receipt.json'))) continue;
      for (const link of fs.readdirSync(dir)) {
        if (!/^result(?:-\d+)?$/.test(link)) continue;
        const target = path.join(dir, link);
        if (fs.lstatSync(target).isSymbolicLink() && fs.readlinkSync(target).startsWith('/nix/store/')) fs.unlinkSync(target);
      }
    }
  }
  prepare(delivery = 'registry') {
    if (!['registry', 'daemon', 'none'].includes(delivery)) throw new Error('Unknown delivery mode');
    fs.mkdirSync(this.state, { recursive: true });
    const started = Date.now();
    const generation = fs.mkdtempSync(path.join(this.state, 'generation-'));
    const candidateFile = path.join(this.state, 'candidate.json');
    const previous = fs.existsSync(candidateFile) ? readJSON(candidateFile) : null;
    const original = this.inspect('container', 'agentbox');
    const manifestChecksum = this.manifestChecksum();
    this.run('bash', ['scripts/refresh-compose.sh']);
    const outputs = JSON.parse(this.capture('nix', ['build', '.#runtime', '.#runtime.copyTo',
      '--out-link', path.join(generation, 'result'), '--json', '--max-jobs', '2', '--cores', '4']));
    const paths = outputs.map(o => o.outputs.out);
    const imagePath = paths.find(p => p.endsWith('-image-agentbox.json'));
    const copier = paths.find(p => fs.existsSync(path.join(p, 'bin/copy-to')));
    if (!imagePath || !copier) throw new Error('Nix did not return image and delivery helper');
    const image = readJSON(imagePath);
    const report = layerReport(image, previous && fs.existsSync(previous.imagePath) ? readJSON(previous.imagePath) : null);
    if (report.duplicatePaths.length) throw new Error(`Image repeats ${report.duplicatePaths.length} store paths`);
    const builtAt = Date.now();
    let registryReadyAt = builtAt, pushedAt = builtAt, pulledAt = builtAt;
    const tag = `candidate-${path.basename(imagePath).split('-')[0]}`;
    let imageRef = `agentbox:${tag}`;
    if (delivery === 'registry') {
      const registry = this.registry();
      registryReadyAt = Date.now();
      const repository = `${registry.address}/agentbox`;
      const digestFile = path.join(generation, 'registry-digest');
      this.run(path.join(copier, 'bin/copy-to'), [`docker://${repository}:${tag}`,
        '--dest-tls-verify=false', '--digestfile', digestFile]);
      pushedAt = Date.now();
      const digest = fs.readFileSync(digestFile, 'utf8').trim();
      if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid registry manifest digest');
      imageRef = `${repository}@${digest}`;
      this.run('docker', ['pull', imageRef]);
      pulledAt = Date.now();
    } else if (delivery === 'daemon') {
      this.run(path.join(copier, 'bin/copy-to'), [`docker-daemon:${imageRef}`]);
      pushedAt = pulledAt = Date.now();
    }
    let imageId = null;
    if (delivery !== 'none') {
      const loaded = this.inspect('image', imageRef);
      if (!loaded || JSON.stringify(loaded.RootFS.Layers) !== JSON.stringify(image.layers.map(l => l.diff_ids))) {
        throw new Error('Loaded candidate layers differ from the Nix image');
      }
      imageId = loaded.Id;
      this.smoke(imageRef);
    }
    const current = this.inspect('container', 'agentbox');
    if (original?.Id !== current?.Id || original?.State.StartedAt !== current?.State.StartedAt) {
      throw new Error('Agentbox changed during preparation; candidate not promoted');
    }
    if (manifestChecksum !== this.manifestChecksum()) throw new Error('Manifest changed during preparation; prepare again');
    const receipt = { version: 1, createdAt: new Date().toISOString(), generation,
      imagePath, imageRef, imageId, delivery, manifestChecksum,
      preparedFrom: original?.Id || null, preparedStartedAt: original?.State.StartedAt || null, report,
      seconds: { build: (builtAt - started) / 1000,
        registrySetup: (registryReadyAt - builtAt) / 1000,
        pushOrStream: (pushedAt - registryReadyAt) / 1000,
        pull: (pulledAt - pushedAt) / 1000,
        smokeAndVerify: (Date.now() - pulledAt) / 1000,
        deliveryAndSmoke: (Date.now() - builtAt) / 1000 } };
    const config = this.configuration(receipt);
    receipt.configurationHash = config.hash;
    receipt.mounts = config.mounts;
    atomicJSON(path.join(generation, 'receipt.json'), receipt);
    if (delivery !== 'none') {
      atomicJSON(candidateFile, receipt);
      if (previous) atomicJSON(path.join(this.state, 'previous.json'), previous);
      const activeFile = path.join(this.state, 'active.json');
      const active = fs.existsSync(activeFile) ? readJSON(activeFile) : null;
      this.releaseOldRoots(new Set([generation, previous?.generation, active?.generation].filter(Boolean)));
    }
    console.log(JSON.stringify({ prepared: imagePath, imageRef, activatable: !!imageId,
      bytes: report.bytes, layers: report.layers.length, seconds: receipt.seconds }, null, 2));
    console.log('Running Agentbox untouched. Activation is a separate, disruptive operator action.');
    return receipt;
  }
  validate() {
    const receipt = readJSON(path.join(this.state, 'candidate.json'));
    if (receipt.version !== 1 || !/^sha256:[a-f0-9]{64}$/.test(receipt.imageId || '')) throw new Error('No loaded candidate');
    if (receipt.manifestChecksum !== this.manifestChecksum() || receipt.configurationHash !== this.configuration(receipt).hash) {
      throw new Error('Deployment configuration changed since preparation; prepare again');
    }
    if (this.inspect('image', receipt.imageRef)?.Id !== receipt.imageId) throw new Error('Candidate image identity changed');
    const current = this.inspect('container', 'agentbox');
    if ((current?.Id || null) !== receipt.preparedFrom || (current?.State.StartedAt || null) !== receipt.preparedStartedAt) {
      throw new Error('Running container changed since preparation; prepare again');
    }
    if (!Array.isArray(receipt.mounts) || (current && JSON.stringify(persistentMounts(current.Mounts)) !== JSON.stringify(receipt.mounts))) {
      throw new Error('Persistent mounts would change; use a separately reviewed migration, not fast activation');
    }
    return { receipt, current };
  }
  activate() {
    const { receipt, current } = this.validate();
    if (current) this.run('docker', ['tag', current.Image, `agentbox:recovery-${current.Id.slice(0, 12)}`]);
    this.run('docker', [...this.composeArgs(), 'up', '-d', '--no-deps', '--force-recreate', '--pull', 'never', 'agentbox'], { env: this.env(receipt) });
    const after = this.inspect('container', 'agentbox');
    if (after?.Image !== receipt.imageId) throw new Error('Activated image differs from candidate');
    if (JSON.stringify(persistentMounts(after.Mounts)) !== JSON.stringify(receipt.mounts)) throw new Error('Activated persistent mounts differ from candidate');
    this.run('curl', ['--fail', '--silent', '--show-error', '--retry', '60', '--retry-all-errors',
      '--retry-delay', '2', '--max-time', '3', 'http://127.0.0.1:9090/ready']);
    atomicJSON(path.join(this.state, 'active.json'), { ...receipt, activatedAt: new Date().toISOString() });
    console.log('Agentbox activated. No sidecars or volumes recreated; no cleanup performed.');
  }
}
function main(args, injectedFlow = null) {
  const [command, ...options] = args;
  if (options.includes('--help') || options.includes('-h') || !command) {
    console.log('Usage: agentbox.sh prepare [--delivery registry|daemon|none] | activate | rebuild [--prepare-only] [--delivery ...]');
    return;
  }
  let delivery = 'registry', prepareOnly = false;
  for (let i = 0; i < options.length; i++) {
    if (options[i] === '--delivery') {
      delivery = options[++i];
      if (!['registry', 'daemon', 'none'].includes(delivery)) throw new Error('--delivery requires registry, daemon or none');
    }
    else if (options[i] === '--prepare-only') prepareOnly = true;
    else if (options[i] !== '--no-cleanup') throw new Error(`Unknown option: ${options[i]}`);
  }
  if (command === 'activate' && options.length) throw new Error('activate takes no options');
  const flow = injectedFlow || new Delivery(path.resolve(__dirname, '..'));
  if (command === 'prepare') flow.prepare(delivery);
  else if (command === 'activate') flow.activate();
  else if (command === 'rebuild') {
    if (delivery === 'none' && !prepareOnly) throw new Error('--delivery none requires --prepare-only');
    flow.prepare(delivery);
    if (!prepareOnly) flow.activate();
  } else throw new Error(`Unknown runtime delivery command: ${command}`);
}
module.exports = { Delivery, layerReport, persistentMounts, sha, main };
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`ERROR: ${error.message}`); process.exitCode = 1; }
}
