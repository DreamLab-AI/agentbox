'use strict';

/**
 * The boot credential scrub (PGSCRUB_MARKER in config/entrypoint-unified.sh) also
 * reaches Claude Code's rolling .claude.json backups and the operator/reconcile
 * snapshots (*.pre-*, *.bak*), and every rewrite is atomic. Run for real against a
 * fixture HOME seeded with a sentinel password.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const ENTRY = fs.readFileSync(path.join(ROOT, 'config/entrypoint-unified.sh'), 'utf8');
const SECRET = 'sentinel-snap-secret-4f81aa';
const CONN = `host=ruvector-postgres port=5432 dbname=ruvector user=ruvector password=${SECRET}`;
const PWFILE = '/run/secrets/ruvector-pg/password';

function scrubBody() {
  const at = ENTRY.indexOf('PGSCRUB_MARKER');
  const head = ENTRY.lastIndexOf('<<', at);
  const lineEnd = ENTRY.indexOf('\n', head);
  const marker = ENTRY.slice(head, lineEnd).match(/<<-?\s*'?"?([A-Za-z_]+)/)[1];
  return ENTRY.slice(lineEnd + 1, ENTRY.indexOf(`\n${marker}\n`, lineEnd));
}

function walk(dir, acc = []) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    const st = fs.lstatSync(p);
    if (st.isDirectory()) walk(p, acc); else acc.push(p);
  }
  return acc;
}

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pgsnap-'));
  const claude = path.join(home, '.claude');
  const ws = path.join(home, 'workspace');
  fs.mkdirSync(path.join(claude, 'backups'), { recursive: true });
  fs.mkdirSync(path.join(ws, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.codex'));
  fs.mkdirSync(path.join(home, '.claude-flow'));
  const mcp = { mcpServers: { 'claude-flow': { command: 'node', env: { RUVECTOR_PG_CONNINFO: CONN, NODE_PATH: '/np' } } } };
  const settings = { hooks: { Stop: [{ hooks: [{ type: 'command', command: `RUVECTOR_PG_CONNINFO="${CONN}" node /opt/h.cjs`, timeout: 10 }] }] }, keep: 'yes' };
  const files = {
    [path.join(home, '.mcp.json')]: [mcp, 0o644],
    [path.join(claude, '.claude.json')]: [{ numStartups: 2, ...mcp }, 0o600],
    [path.join(claude, 'backups', '.claude.json.backup.1700000000001')]: [{ numStartups: 1, ...mcp }, 0o600],
    [path.join(claude, 'backups', '.claude.json.backup.1700000000002')]: [{ projects: { '/w': mcp } }, 0o640],
    [path.join(claude, 'settings.json.pre-adr2138')]: [settings, 0o644],
    [path.join(claude, 'settings.json.pre-hooks-reconcile')]: [settings, 0o600],
    [path.join(claude, 'settings.json.bak-1')]: [settings, 0o600],
    [path.join(ws, '.mcp.json.pre-checkround-2026-09-04')]: [mcp, 0o664],
    [path.join(ws, '.claude', 'settings.json.pre-hooks-reconcile')]: [settings, 0o644],
    [path.join(home, '.claude-flow', 'config.json')]: [{ memory: { backend: 'external-pg', password: SECRET } }, 0o644],
    [path.join(home, '.claude-flow', 'config.json.bak')]: [{ memory: { password: SECRET } }, 0o644],
  };
  const modes = {};
  for (const [f, [obj, mode]] of Object.entries(files)) { fs.writeFileSync(f, JSON.stringify(obj, null, 2)); fs.chmodSync(f, mode); modes[f] = mode; }
  const codex = path.join(home, '.codex', 'config.toml');
  fs.writeFileSync(codex, `[mcp_servers.m.env]\nRUVECTOR_PG_CONNINFO = "${CONN}"\n`);
  fs.writeFileSync(codex + '.bak', `[mcp_servers.m.env]\nRUVECTOR_PG_CONNINFO = "${CONN}"\n`);
  // untouched bystanders: an unrelated file with a similar suffix and a clean snapshot
  fs.writeFileSync(path.join(claude, 'notes.txt.pre-x'), 'nothing here\n');
  return { home, claude, ws, codex, modes };
}

function run(fx, extra = {}) {
  return spawnSync('node', ['-e', scrubBody()], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      PGS_MCP_JSON: path.join(fx.home, '.mcp.json'),
      PGS_CODEX: fx.codex,
      PGS_CF: path.join(fx.home, '.claude-flow', 'config.json'),
      PGS_FILE: PWFILE,
      PGS_CLAUDE_JSON: `${path.join(fx.claude, '.claude.json')}:${path.join(fx.home, '.claude.json')}`,
      PGS_SNAP_DIRS: [fx.claude, path.join(fx.claude, 'backups'), fx.home, fx.ws, path.join(fx.ws, '.claude'), path.dirname(fx.codex), path.join(fx.home, '.claude-flow')].join(':'),
      PGS_ANY_DIRS: `${fx.claude}:${path.join(fx.claude, 'backups')}`,
      ...extra,
    },
  });
}

const snapshot = (dir) => Object.fromEntries(walk(dir).map((f) => [f, [fs.readFileSync(f, 'utf8'), fs.statSync(f).mode & 0o777, fs.statSync(f).mtimeMs]]));

describe('credential scrub: snapshots and atomic writes', () => {
  test("another database's credentials in the same files are left byte-identical", () => {
    const fx = fixture();
    const other = {
      mcpServers: { pgtool: { command: 'x', env: { DATABASE_URL: 'postgres://app:other-pw-77@db.example.com:5432/app', PG: 'host=db.example.com user=app dbname=app password=other-pw-77' } } },
      history: ['psql "postgresql://admin:other-pw-77@warehouse.internal/wh"'],
    };
    const live = path.join(fx.claude, '.claude.json');
    const snap = path.join(fx.claude, 'settings.json.pre-other');
    fs.writeFileSync(live, JSON.stringify({ ...JSON.parse(fs.readFileSync(live, 'utf8')), ...other }, null, 2));
    fs.writeFileSync(snap, JSON.stringify({ note: other.history, env: other.mcpServers.pgtool.env }, null, 2));
    run(fx);
    const j = JSON.parse(fs.readFileSync(live, 'utf8'));
    expect(j.mcpServers.pgtool).toEqual(other.mcpServers.pgtool);
    expect(j.history).toEqual(other.history);
    const s2 = JSON.parse(fs.readFileSync(snap, 'utf8'));
    expect(s2.note).toEqual(other.history);
    expect(s2.env).toEqual(other.mcpServers.pgtool.env);
    // while RuVector's own copies in the same run are scrubbed
    expect(fs.readFileSync(live, 'utf8')).not.toContain(SECRET);
    fs.rmSync(fx.home, { recursive: true, force: true });
  });

  test('the rewrite carries the original owner across the rename (source assertion; the test runs unprivileged)', () => {
    const body = scrubBody();
    expect(body).toMatch(/uid: st\.uid, gid: st\.gid/);
    expect(body).toMatch(/fs\.fchownSync\(fd, uid, gid\)/);
    expect(body).toMatch(/atomicWrite\(f, out, mode, r\.uid, r\.gid\)/);
    // fchown must come before the rename so the file is never visible with the wrong owner
    expect(body.indexOf('fchownSync')).toBeLessThan(body.indexOf('renameSync'));
  });

  test('backups and *.pre-*/*.bak* snapshots are scrubbed, valid, mode-preserving, with no temp left', () => {
    const fx = fixture();
    const r = run(fx);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).not.toContain(SECRET);
    for (const f of walk(fx.home)) {
      const t = fs.readFileSync(f, 'utf8');
      expect(t).not.toContain(SECRET);
      expect(t).not.toMatch(/password=/i);
      expect(path.basename(f)).not.toMatch(/pgscrub/);
      if (!/\.toml(\.bak)?$|notes\.txt/.test(f)) expect(() => JSON.parse(t)).not.toThrow();
    }
    for (const [f, mode] of Object.entries(fx.modes)) {
      // the live .mcp.json and .claude.json are forced to 0600 (existing guarantee); all others keep their mode
      const live = f === path.join(fx.home, '.mcp.json') || f === path.join(fx.claude, '.claude.json');
      expect(fs.statSync(f).mode & 0o777).toBe(live ? 0o600 : mode);
    }
    const hook = JSON.parse(fs.readFileSync(path.join(fx.claude, 'settings.json.pre-adr2138'), 'utf8'));
    expect(hook.keep).toBe('yes');
    expect(hook.hooks.Stop[0].hooks[0].command).toBe(`RUVECTOR_PG_PASSWORD_FILE=${PWFILE} node /opt/h.cjs`);
    const bk = JSON.parse(fs.readFileSync(path.join(fx.claude, 'backups', '.claude.json.backup.1700000000002'), 'utf8'));
    expect(bk.projects['/w'].mcpServers['claude-flow'].env.RUVECTOR_PG_PASSWORD_FILE).toBe(PWFILE);
    expect(fs.readFileSync(path.join(fx.claude, 'notes.txt.pre-x'), 'utf8')).toBe('nothing here\n');
    expect(fs.readFileSync(fx.codex + '.bak', 'utf8')).toContain(`RUVECTOR_PG_PASSWORD_FILE = "${PWFILE}"`);
    fs.rmSync(fx.home, { recursive: true, force: true });
  });

  test('a second run is a no-op: same bytes, modes and mtimes, nothing logged with a value', () => {
    const fx = fixture();
    run(fx);
    const before = snapshot(fx.home);
    const r = run(fx);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('no stored Postgres password/conninfo found');
    expect(snapshot(fx.home)).toEqual(before);
    fs.rmSync(fx.home, { recursive: true, force: true });
  });

  test('a failure before the rename leaves every original intact and no temp file behind', () => {
    const fx = fixture();
    const before = snapshot(fx.home);
    const r = run(fx, { PGS_TEST_FAIL_BEFORE_RENAME: '1' });
    expect(r.status).toBe(0); // fail-open
    expect(r.stdout + r.stderr).not.toContain(SECRET);
    expect(r.stdout).toMatch(/could not be rewritten/);
    expect(snapshot(fx.home)).toEqual(before);
    expect(walk(fx.home).filter((f) => /pgscrub/.test(f))).toEqual([]);
    fs.rmSync(fx.home, { recursive: true, force: true });
  });

  test('symlinked snapshots are not followed', () => {
    const fx = fixture();
    const outside = path.join(fx.home, 'outside.json');
    fs.writeFileSync(outside, JSON.stringify({ memory: { password: SECRET } }));
    fs.symlinkSync(outside, path.join(fx.claude, 'settings.json.pre-link'));
    run(fx);
    expect(fs.readFileSync(outside, 'utf8')).toContain(SECRET);
    expect(fs.lstatSync(path.join(fx.claude, 'settings.json.pre-link')).isSymbolicLink()).toBe(true);
    fs.rmSync(fx.home, { recursive: true, force: true });
  });
});
