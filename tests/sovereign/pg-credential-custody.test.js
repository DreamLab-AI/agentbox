'use strict';

/**
 * The RuVector Postgres password lives in exactly one 0600 file
 * ($RUVECTOR_PG_PASSWORD_FILE). No hook command, MCP/Codex config, runtime-env
 * file or exported environment carries the password or a conninfo string, and
 * every database client builds its connection from the host/port/db/user parts
 * plus that file through one helper (management-api/lib/pg-config.js).
 *
 * The entrypoint pieces are run for real: bash functions and heredocs are cut
 * out of config/entrypoint-unified.sh and executed with a sentinel password,
 * the same method as task-trajectory-env.test.js.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const ENTRY = read('config/entrypoint-unified.sh');
const SECRET = 'sentinel-pg-secret-91c2d7';
const NO_LEAK = (text) => {
  expect(text).not.toContain(SECRET);
  expect(text).not.toMatch(/password=/i);
  expect(text).not.toMatch(/postgres(ql)?:\/\/[^\s"']*:[^\s"'@]+@/);
};

function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

/** The shell source of a heredoc whose body contains `needle` (marker found by walking back to `<<`). */
function heredocBody(needle, from = 0) {
  const at = ENTRY.indexOf(needle, from);
  if (at < 0) throw new Error(`entrypoint has no heredoc containing: ${needle}`);
  const head = ENTRY.lastIndexOf('<<', at);
  const lineEnd = ENTRY.indexOf('\n', head);
  const m = ENTRY.slice(head, lineEnd).match(/^<<-?\s*'?"?([A-Za-z_]+)'?"?/);
  if (!m) throw new Error(`no heredoc marker before: ${needle}`);
  const bodyStart = lineEnd + 1;
  const end = ENTRY.indexOf(`\n${m[1]}\n`, bodyStart);
  return { marker: m[1], quoted: /<<-?\s*['"]/.test(ENTRY.slice(head, lineEnd)), body: ENTRY.slice(bodyStart, end), start: head, end };
}

/** Render a heredoc the way bash does at boot (variable expansion for unquoted markers). */
function renderHeredoc(needle, env) {
  const h = heredocBody(needle);
  if (h.quoted) return h.body;
  const r = spawnSync('bash', ['-c', `cat <<${h.marker}\n${h.body}\n${h.marker}\n`], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  expect(r.status).toBe(0);
  return r.stdout;
}

function runNodeHeredoc(needle, env) {
  const h = heredocBody(needle);
  return spawnSync('node', ['-e', h.body], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
}

const BASE_ENV = {
  RUVECTOR_PG_PASSWORD: SECRET,
  RUVECTOR_PG_CONNINFO: `host=ruvector-postgres port=5432 dbname=ruvector user=ruvector password=${SECRET}`,
  XINFERENCE_ENDPOINT: 'http://xinference:9997',
  EMBEDDING_MODEL: 'bge-small-en-v1.5',
  _PG_NODE_PATH: '/np',
  _RUVECTOR_MCP: '/opt/agentbox/mcp/servers/ruvector-mcp.cjs',
  _PG_PREFIX: '/pg',
};

describe('1. the shared helper builds a pool config from the parts plus the password file', () => {
  const pg = () => require('../../management-api/lib/pg-config');

  test('host, port, db and user come from the parts; the password only from the file', () => {
    const dir = tmp('pgc-'); const f = path.join(dir, 'password');
    fs.writeFileSync(f, `${SECRET}\n`, { mode: 0o600 });
    const cfg = pg().pgPoolConfig({
      RUVECTOR_PG_HOST: 'db.internal', RUVECTOR_PG_PORT: '6543', RUVECTOR_PG_DATABASE: 'mem', RUVECTOR_PG_USER: 'svc',
      RUVECTOR_PG_PASSWORD_FILE: f,
      // Neither of these may be consulted any more.
      RUVECTOR_PG_PASSWORD: 'from-env-must-be-ignored', RUVECTOR_PG_CONNINFO: 'host=evil password=nope',
    });
    expect(cfg).toEqual({ host: 'db.internal', port: 6543, database: 'mem', user: 'svc', password: SECRET });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a recording fake pool receives exactly that config', () => {
    const dir = tmp('pgc-'); const f = path.join(dir, 'password');
    fs.writeFileSync(f, SECRET, { mode: 0o600 });
    const seen = [];
    class FakePool { constructor(cfg) { seen.push(cfg); } }
    const cfg = pg().pgPoolConfig({ RUVECTOR_PG_PASSWORD_FILE: f });
    new FakePool({ ...cfg, max: 5 });
    expect(seen).toEqual([{ host: 'ruvector-postgres', port: 5432, database: 'ruvector', user: 'ruvector', password: SECRET, max: 5 }]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a missing, empty or non-regular secret file fails closed, naming the path and never a value', () => {
    const dir = tmp('pgc-');
    const missing = path.join(dir, 'absent');
    expect(() => pg().pgPoolConfig({ RUVECTOR_PG_PASSWORD_FILE: missing, RUVECTOR_PG_PASSWORD: SECRET }))
      .toThrow(new RegExp(missing.replace(/[/.]/g, '\\$&')));
    try { pg().pgPoolConfig({ RUVECTOR_PG_PASSWORD_FILE: missing, RUVECTOR_PG_PASSWORD: SECRET }); } catch (e) { expect(e.message).not.toContain(SECRET); }
    const empty = path.join(dir, 'empty'); fs.writeFileSync(empty, '\n');
    expect(() => pg().pgPoolConfig({ RUVECTOR_PG_PASSWORD_FILE: empty })).toThrow(/empty/);
    expect(() => pg().pgPoolConfig({ RUVECTOR_PG_PASSWORD_FILE: dir })).toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('with no file variable it falls back to the one default path, never to a default password', () => {
    expect(pg().DEFAULT_PASSWORD_FILE).toBe('/run/secrets/ruvector-pg/password');
    const fsImpl = { openSync() { const e = new Error('nope'); e.code = 'ENOENT'; throw e; } };
    expect(() => pg().pgPoolConfig({}, { fsImpl })).toThrow(/\/run\/secrets\/ruvector-pg\/password/);
  });

  test('the manifest conninfo URL yields parts only; a real password in it is refused', () => {
    const dir = tmp('pgc-'); const f = path.join(dir, 'password'); fs.writeFileSync(f, SECRET);
    const env = { RUVECTOR_PG_PASSWORD_FILE: f };
    for (const ok of ['postgresql://ruvector@ruvector-postgres:5432/ruvector', 'postgresql://ruvector:@@RUVECTOR_PG_PASSWORD@@@ruvector-postgres:5432/ruvector']) {
      expect(pg().pgPoolConfigFromManifestConninfo(ok, env)).toEqual({ host: 'ruvector-postgres', port: 5432, database: 'ruvector', user: 'ruvector', password: SECRET });
    }
    expect(() => pg().pgPoolConfigFromManifestConninfo('postgresql://ruvector:hunter2@ruvector-postgres:5432/ruvector', env)).toThrow(/must not carry a password/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('the management-api memory slot builds its pool from the helper, not from the manifest string', () => {
    const { slotConfig: __slotConfigForTest } = require('../../management-api/adapters');
    const dir = tmp('pgc-'); const f = path.join(dir, 'password'); fs.writeFileSync(f, SECRET);
    const prev = process.env.RUVECTOR_PG_PASSWORD_FILE;
    process.env.RUVECTOR_PG_PASSWORD_FILE = f;
    try {
      const cfg = __slotConfigForTest('memory', 'external-pg', { integrations: { ruvector_external: { conninfo: 'postgresql://ruvector:@@RUVECTOR_PG_PASSWORD@@@ruvector-postgres:5432/ruvector' } } });
      expect(typeof cfg.conninfo).toBe('object');
      expect(cfg.conninfo.password).toBe(SECRET);
      expect(cfg.conninfo.host).toBe('ruvector-postgres');
    } finally {
      if (prev === undefined) delete process.env.RUVECTOR_PG_PASSWORD_FILE; else process.env.RUVECTOR_PG_PASSWORD_FILE = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('2. the entrypoint converts the password to one file and removes it from the environment', () => {
  function fn() {
    const m = ENTRY.match(/^_ab_pg_credential_prepare\(\) \{[\s\S]*?^\}/m);
    expect(m).not.toBeNull();
    return m[0];
  }
  function run(env, root) {
    return spawnSync('bash', ['-c', `${fn()}\n_ab_pg_credential_prepare "$1" "$(id -u):$(id -g)"\nrc=$?\nenv\nexit $rc`, '_', root], {
      encoding: 'utf8', env: { PATH: process.env.PATH, ...env },
    });
  }

  test('writes a 0600 file, exports only the path and the parts, unsets the password and the conninfo', () => {
    const root = tmp('pgs-');
    const r = run({ RUVECTOR_PG_PASSWORD: SECRET, RUVECTOR_PG_CONNINFO: `host=x password=${SECRET}` }, root);
    expect(r.status).toBe(0);
    const f = path.join(root, 'ruvector-pg', 'password');
    expect(fs.readFileSync(f, 'utf8')).toBe(SECRET);
    expect(fs.statSync(f).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(f)).mode & 0o777).toBe(0o700);
    expect(r.stdout).toContain(`RUVECTOR_PG_PASSWORD_FILE=${f}`);
    expect(r.stdout).toMatch(/^RUVECTOR_PG_HOST=ruvector-postgres$/m);
    expect(r.stdout).not.toContain(SECRET);
    expect(r.stdout).not.toMatch(/^RUVECTOR_PG_PASSWORD=/m);
    expect(r.stdout).not.toMatch(/^RUVECTOR_PG_CONNINFO=/m);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('no password and no existing file: fails closed with the path, writes nothing, invents no default', () => {
    const root = tmp('pgs-');
    const r = run({}, root);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(path.join(root, 'ruvector-pg', 'password'));
    expect(fs.existsSync(path.join(root, 'ruvector-pg', 'password'))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('a delivered file already in place is kept and no value is needed in the environment', () => {
    const root = tmp('pgs-'); fs.mkdirSync(path.join(root, 'ruvector-pg'));
    fs.writeFileSync(path.join(root, 'ruvector-pg', 'password'), SECRET, { mode: 0o600 });
    const r = run({}, root);
    expect(r.status).toBe(0);
    expect(fs.readFileSync(path.join(root, 'ruvector-pg', 'password'), 'utf8')).toBe(SECRET);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('3. nothing the entrypoint projects carries the password or a conninfo', () => {
  test('the runtime-env export names the file and parts, never the password', () => {
    const dir = tmp('pgr-'); const file = path.join(dir, 'rt.sh');
    const a = ENTRY.indexOf('cat > "$RUNTIME_ENV_FILE" <<EOF');
    const end = ENTRY.indexOf('\nEOF\n', a);
    const body = ENTRY.slice(a, end + 5);
    const r = spawnSync('bash', ['-c', `RUNTIME_ENV_FILE="${file}"\nWORKSPACE=/w\nRUVECTOR_DATA_DIR=/d\nRUVECTOR_PORT=1\n${body}`], {
      encoding: 'utf8', env: { PATH: process.env.PATH, ...BASE_ENV },
    });
    expect(r.status).toBe(0);
    const text = fs.readFileSync(file, 'utf8');
    NO_LEAK(text);
    expect(text).not.toMatch(/RUVECTOR_PG_CONNINFO|RUVECTOR_PG_PASSWORD(?!_FILE)/);
    expect(text).toMatch(/export RUVECTOR_PG_PASSWORD_FILE=/);
    expect(text).toMatch(/export RUVECTOR_PG_HOST=/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test.each([
    ['claude-flow .mcp.json first write', '"NODE_PATH": "$_PG_NODE_PATH",'],
    ['colloquy MCP registration', '"COLLOQUY_RUVECTOR_SERVER"'],
    ['ruvnet-brain MCP registration', '"RUVNET_BRAIN_NAMESPACE": "$_RB_NS"'],
    ['Codex agentbox-memory config', '[mcp_servers.agentbox-memory.env]'],
  ])('%s', (_name, needle) => {
    const out = renderHeredoc(needle, { ...BASE_ENV, _RB_NS: 'ruvnet-kb', _COLLOQUY_BIN: '/c', _MCP_SERVERS_NODE_PATH: '/n', _RB_MCP_DIR: '/rb', _COLLOQUY_PRINCIPAL: 'p', _COLLOQUY_TIER: 't', _COLLOQUY_NS: 'n', _COLLOQUY_STORE: '/s' });
    NO_LEAK(out);
    expect(out).not.toMatch(/CONNINFO/);
    expect(out).toContain('RUVECTOR_PG_PASSWORD_FILE');
  });

  test('the credential scrub rewrites stale persisted files: .mcp.json, Codex config.toml, claude-flow config', () => {
    const h = heredocBody('PGSCRUB_MARKER');
    const dir = tmp('pgx-');
    const mcp = path.join(dir, '.mcp.json');
    const codex = path.join(dir, 'config.toml');
    const cf = path.join(dir, 'cf.json');
    fs.writeFileSync(mcp, JSON.stringify({ mcpServers: {
      'claude-flow': { command: 'node', env: { RUVECTOR_PG_CONNINFO: `host=h port=5432 dbname=ruvector user=ruvector password=${SECRET}`, NODE_PATH: '/np' } },
      colloquy: { command: 'c', env: { RUVECTOR_PG_CONNINFO: `host=h password=${SECRET}` } },
      other: { command: 'o', env: { FOO: 'bar' } },
    } }));
    fs.writeFileSync(codex, `[mcp_servers.agentbox-memory]\ncommand = "node"\n\n[mcp_servers.agentbox-memory.env]\nRUVECTOR_PG_CONNINFO = "host=h port=5432 dbname=ruvector user=ruvector password=${SECRET}"\nNODE_PATH = "/np"\n`);
    fs.writeFileSync(cf, JSON.stringify({ memory: { backend: 'external-pg', host: 'h', password: SECRET, enableHNSW: true } }));
    // Claude Code's per-user state caches the resolved MCP config, top-level and per project.
    const state = path.join(dir, '.claude.json');
    fs.writeFileSync(state, JSON.stringify({
      numStartups: 3,
      mcpServers: { 'claude-flow': { command: 'node', env: { RUVECTOR_PG_CONNINFO: `host=h password=${SECRET}`, NODE_PATH: '/np' } } },
      projects: { '/w': { mcpServers: { colloquy: { command: 'c', env: { RUVECTOR_PG_CONNINFO: `host=h password=${SECRET}` } } }, allowedTools: [] } },
    }), { mode: 0o644 });
    const r = spawnSync('node', ['-e', h.body], { encoding: 'utf8', env: { PATH: process.env.PATH, PGS_MCP_JSON: mcp, PGS_CODEX: codex, PGS_CF: cf, PGS_CLAUDE_JSON: `${state}:${path.join(dir, 'absent.json')}`, PGS_FILE: '/run/secrets/ruvector-pg/password' } });
    expect(r.status).toBe(0);
    for (const f of [mcp, codex, cf, state]) NO_LEAK(fs.readFileSync(f, 'utf8'));
    const st = JSON.parse(fs.readFileSync(state, 'utf8'));
    expect(st.numStartups).toBe(3);
    expect(st.mcpServers['claude-flow'].env.RUVECTOR_PG_PASSWORD_FILE).toBe('/run/secrets/ruvector-pg/password');
    expect(st.mcpServers['claude-flow'].env.NODE_PATH).toBe('/np');
    expect(st.projects['/w'].mcpServers.colloquy.env.RUVECTOR_PG_HOST).toBe('ruvector-postgres');
    expect(st.projects['/w'].allowedTools).toEqual([]);
    expect(fs.statSync(state).mode & 0o777).toBe(0o600);
    const m = JSON.parse(fs.readFileSync(mcp, 'utf8'));
    expect(m.mcpServers['claude-flow'].env.RUVECTOR_PG_PASSWORD_FILE).toBe('/run/secrets/ruvector-pg/password');
    expect(m.mcpServers['claude-flow'].env.RUVECTOR_PG_HOST).toBe('ruvector-postgres');
    expect(m.mcpServers['claude-flow'].env.NODE_PATH).toBe('/np');
    expect(m.mcpServers.colloquy.env.RUVECTOR_PG_PASSWORD_FILE).toBeTruthy();
    expect(m.mcpServers.other.env).toEqual({ FOO: 'bar' });
    expect(fs.readFileSync(codex, 'utf8')).toContain('RUVECTOR_PG_PASSWORD_FILE = "/run/secrets/ruvector-pg/password"');
    expect(JSON.parse(fs.readFileSync(cf, 'utf8')).memory.password).toBeUndefined();
    expect((fs.statSync(mcp).mode & 0o777)).toBe(0o600);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('every hook command registered in settings.json is free of the password and any conninfo', () => {
    // Registered hook heredocs (TRAJJS, the routing-label recorder, the rest) run with a hostile environment.
    const dir = tmp('pgh-'); const settings = path.join(dir, 'settings.json');
    const hostile = { ...BASE_ENV, RL_CONNINFO: BASE_ENV.RUVECTOR_PG_CONNINFO, TRAJ_CONNINFO: BASE_ENV.RUVECTOR_PG_CONNINFO };
    const regs = [
      ['TRAJ_HOOK', { TRAJ_HOOK: '/opt/agentbox/config/hooks/trajectory-recorder.cjs', TRAJ_PUBKEY: 'ab'.repeat(32), TRAJ_AGENT: 'claude-code' }],
      ['RL_HOOK', { RL_HOOK: '/opt/agentbox/config/hooks/routing-label-recorder.cjs', RL_EMBED_URL: 'http://emb.local/v1/embeddings', RL_MIN_CHARS: '24', RL_PUBKEY: 'cd'.repeat(32) }],
    ];
    for (const [needle, extra] of regs) {
      const h = heredocBody(`process.env.${needle}`);
      fs.rmSync(settings, { force: true });
      const r = spawnSync('node', ['-e', h.body], { encoding: 'utf8', env: { PATH: process.env.PATH, SETTINGS: settings, ...hostile, ...extra } });
      expect(r.status).toBe(0);
      NO_LEAK(fs.readFileSync(settings, 'utf8'));
      expect(fs.readFileSync(settings, 'utf8')).not.toMatch(/CONNINFO|RUVECTOR_PG/);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('4. no literal default password and no conninfo reader survives', () => {
  function gitLs(dirs) {
    const r = spawnSync('git', ['ls-files', '-z', '--', ...dirs], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return r.stdout.split('\0').filter(Boolean).filter((p) => !/node_modules|\/golden\/|^tests\//.test(p) && !/\.(png|jpg|gif|woff2?|lock|zip|gz|wasm)$/.test(p));
  }
  const files = gitLs(['config', 'management-api', 'mcp', 'scripts', 'skills', 'services/dream-engine/src', 'docker-compose.yml', 'docker-compose.override.yml', 'agentbox.sh', 'flake.nix']);
  // The gate's own pattern definitions are the one place the literals may be spelled.
  const scan = (re) => files.filter((p) => p !== 'scripts/ci/check-db-password.sh').filter((p) => { try { return re.test(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return false; } });

  test.each([
    ['password=ruvector', /password=ruvector\b/],
    ['ruvector:ruvector@', /ruvector:ruvector@/],
    ['${RUVECTOR_PG_PASSWORD:-…} non-empty default', /RUVECTOR_PG_PASSWORD:-[^}]/],
    ['${RUVECTOR_PG_PASSWORD:=…} non-empty default', /RUVECTOR_PG_PASSWORD:=[^}]/],
    ['"password": "ruvector"', /"(?:RUVECTOR_PG_)?PASSWORD":\s*"ruvector"/i],
    ['`|| \'…password=…\'` fallback conninfo', /\|\|\s*\n?\s*'host=ruvector-postgres[^']*password=/],
  ])('no %s anywhere in config/, management-api/, mcp/, scripts/, skills/, compose, flake', (_n, re) => {
    expect(scan(re)).toEqual([]);
  });

  test('nothing but the one scrub block names RUVECTOR_PG_CONNINFO any more', () => {
    // estate.rs only names it in a test proving the dream-engine never consults it.
    const hits = scan(/RUVECTOR_PG_CONNINFO/).filter((p) => p !== 'services/dream-engine/src/estate.rs');
    expect(hits).toEqual(['config/entrypoint-unified.sh']);
    const lines = ENTRY.split('\n').filter((l) => l.includes('RUVECTOR_PG_CONNINFO') && !/^\s*#/.test(l));
    const scrub = heredocBody('PGSCRUB_MARKER').body.split('\n');
    // The only other mention is the custody function unsetting the retired variable.
    for (const l of lines) {
      if (/^\s*unset RUVECTOR_PG_PASSWORD RUVECTOR_PG_CONNINFO$/.test(l)) continue;
      expect(scrub).toContain(l);
    }
  });

  test('the CI gate scripts/ci/check-db-password.sh passes', () => {
    const r = spawnSync('sh', ['scripts/ci/check-db-password.sh'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  test('the task env allowlist no longer forwards a conninfo', () => {
    expect(read('management-api/adapters/orchestrator/local-process-manager.js')).not.toMatch(/RUVECTOR_PG/);
  });

  test('docker compose requires the password and never injects a conninfo', () => {
    for (const f of ['docker-compose.yml', 'docker-compose.override.yml']) {
      const t = read(f);
      expect(t).not.toMatch(/RUVECTOR_PG_CONNINFO/);
      for (const m of t.matchAll(/^\s*-\s*(?:POSTGRES_PASSWORD|RUVECTOR_PG_PASSWORD)=.*$/gm)) expect(m[0]).toMatch(/:\?/);
    }
  });

  test('no reader parses a conninfo string: they all go through pg-config', () => {
    for (const p of ['mcp/servers/ruvector-mcp.cjs', 'mcp/servers/ruflo-memory-cli.cjs', 'mcp/servers/lib/aggregate-effectiveness.js', 'mcp/ruvnet-brain/server.js',
      'scripts/ruvector-aggregate-sweep.mjs', 'scripts/ruvector-pattern-distill.mjs', 'scripts/ruvector-recall-harness.mjs', 'scripts/ruvector-sona-feeder.mjs',
      'scripts/dream-machine-nightly.mjs', 'scripts/corpus-memory-ingest.mjs', 'scripts/ruvnet-brain-ingest.mjs', 'scripts/experiments/exp-b8-label-log.cjs']) {
      const t = read(p);
      expect(t).toMatch(/pg-config|poolConfig\(\)/); // the two ingest scripts reach it through scripts/lib/ruvector-bulk.mjs
      expect(t).not.toMatch(/parsed\.(?:dbname|password)/);
    }
  });
});
