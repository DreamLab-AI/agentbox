'use strict';

/**
 * ADR-055 — the cockpit /dream panel's data layer. Covers the ledger parser and
 * path-safety guard, discovery/aggregation over a temp workspace, and the
 * GET /dream/status route via fastify.inject.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Fastify = require('../../management-api/node_modules/fastify');

const {
  parseLedger,
  verdictStats,
  latestNights,
  resolveLedgerPath,
  discoverNominatedRepos,
  aggregateDreamStatus,
} = require('../../management-api/lib/dream-ledger');

const dreamRoutes = require('../../management-api/routes/dream');

const HEADER =
  '| Date | Deep | Finding | Issue | PR | Evaluated? | Verdict | Effect | Witness | Prior-night fates |';
const SEP = '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';
const row = (date, deep, verdict, pr = 'NONE') =>
  `| ${date} | ${deep} | some finding | #1 | ${pr} | yes | ${verdict} |  | abc123 |  |`;

function ledger(rows) {
  return [HEADER, SEP, ...rows].join('\n') + '\n';
}

describe('dream-ledger: parseLedger', () => {
  test('parses data rows, ignoring header, separator and prose', () => {
    const md = 'Some prose above.\n\n' + ledger([row('2026-08-16', 'perf', 'ACCEPT'), row('2026-08-15', 'sec', 'REJECT')]);
    const { rows } = parseLedger(md);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: '2026-08-16', deep: 'perf', verdict: 'ACCEPT' });
    expect(rows[1]).toMatchObject({ date: '2026-08-15', verdict: 'REJECT' });
  });

  test('does not mistake the header row for data', () => {
    expect(parseLedger(ledger([])).rows).toHaveLength(0);
  });

  test('honours escaped pipes inside a cell', () => {
    const md = ledger(['| 2026-08-16 | perf | a \\| b finding | #1 | NONE | yes | ACCEPT |  | h |  |']);
    expect(parseLedger(md).rows[0].finding).toBe('a | b finding');
  });

  test('skips malformed short rows', () => {
    const md = ledger([row('2026-08-16', 'perf', 'ACCEPT')]) + '| too | few | cols |\n';
    expect(parseLedger(md).rows).toHaveLength(1);
  });

  test('tolerates empty / non-string input', () => {
    expect(parseLedger('').rows).toHaveLength(0);
    expect(parseLedger(undefined).rows).toHaveLength(0);
    expect(parseLedger(null).rows).toHaveLength(0);
  });
});

describe('dream-ledger: verdictStats', () => {
  test('counts verdicts and buckets unknowns', () => {
    const { rows } = parseLedger(
      ledger([row('a', 'd', 'ACCEPT'), row('b', 'd', 'REJECT'), row('c', 'd', 'INCONCLUSIVE'), row('e', 'd', 'MAYBE')]),
    );
    expect(verdictStats(rows)).toEqual({ ACCEPT: 1, REJECT: 1, INCONCLUSIVE: 1, other: 1 });
  });
});

describe('dream-ledger: latestNights', () => {
  test('returns the last n rows newest-first', () => {
    const { rows } = parseLedger(ledger([row('2026-08-14', 'd', 'ACCEPT'), row('2026-08-15', 'd', 'REJECT'), row('2026-08-16', 'd', 'ACCEPT')]));
    expect(latestNights(rows, 2).map((r) => r.date)).toEqual(['2026-08-16', '2026-08-15']);
  });
});

describe('dream-ledger: resolveLedgerPath (path safety)', () => {
  const repo = '/home/devuser/workspace/example';
  test('accepts a normal repo-relative path', () => {
    expect(resolveLedgerPath(repo, 'docs/dream-cycle/LEDGER.md')).toBe(path.join(repo, 'docs/dream-cycle/LEDGER.md'));
  });
  test('rejects .. traversal', () => {
    expect(() => resolveLedgerPath(repo, '../../etc/passwd')).toThrow(/escapes/);
  });
  test('rejects an absolute path', () => {
    expect(() => resolveLedgerPath(repo, '/etc/passwd')).toThrow(/escapes/);
  });
  test('rejects the repo dir itself (empty relative)', () => {
    expect(() => resolveLedgerPath(repo, '.')).toThrow(/escapes/);
  });
});

describe('dream-ledger: discovery + aggregation (temp workspace)', () => {
  let ws;
  beforeAll(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dream-ws-'));
    const a = path.join(ws, 'repo-a');
    fs.mkdirSync(path.join(a, 'docs', 'dream-cycle'), { recursive: true });
    fs.writeFileSync(path.join(a, 'dream.config.json'), JSON.stringify({ repo: 'org/repo-a' }));
    // Append-only order: oldest first, newest last (as the engine writes it).
    fs.writeFileSync(path.join(a, 'docs/dream-cycle/LEDGER.md'), ledger([row('2026-08-15', 'sec', 'REJECT'), row('2026-08-16', 'perf', 'ACCEPT')]));
    const b = path.join(ws, 'repo-b');
    fs.mkdirSync(b, { recursive: true });
    fs.writeFileSync(path.join(b, 'dream.config.json'), JSON.stringify({ repo: 'org/repo-b' }));
    fs.mkdirSync(path.join(ws, 'repo-c'), { recursive: true }); // no marker
    const d = path.join(ws, 'repo-d');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'dream.config.json'), '{ not json');
  });
  afterAll(() => fs.rmSync(ws, { recursive: true, force: true }));

  test('discovers only nominated repos, sorted', () => {
    expect(discoverNominatedRepos(ws).map((r) => r.name)).toEqual(['repo-a', 'repo-b', 'repo-d']);
  });

  test('missing workspace root yields empty, not a throw', () => {
    expect(discoverNominatedRepos('/no/such/dir/xyz')).toEqual([]);
  });

  test('aggregates verdicts and handles missing ledgers + bad config honestly', () => {
    const agg = aggregateDreamStatus(ws, { limit: 5 });
    expect(agg.repoCount).toBe(3);
    expect(agg.totals).toMatchObject({ ACCEPT: 1, REJECT: 1, rows: 2 });
    expect(agg.repos.find((r) => r.dir === 'repo-a')).toMatchObject({ ledgerExists: true, lastNight: '2026-08-16' });
    expect(agg.repos.find((r) => r.dir === 'repo-b')).toMatchObject({ ledgerExists: false, rowCount: 0 });
    expect(agg.repos.find((r) => r.dir === 'repo-d').error).toMatch(/invalid/);
  });

  test('rejects a ledger symlinked outside the repo — no file disclosure (ADR-055 guard)', () => {
    const ws2 = fs.mkdtempSync(path.join(os.tmpdir(), 'dream-sym-'));
    try {
      const secret = path.join(ws2, 'SECRET.txt');
      fs.writeFileSync(secret, 'ROOT-PASSWORD-HASH-abc123');
      const repo = path.join(ws2, 'evil');
      fs.mkdirSync(path.join(repo, 'docs', 'dream-cycle'), { recursive: true });
      fs.writeFileSync(path.join(repo, 'dream.config.json'), JSON.stringify({ repo: 'org/evil' }));
      fs.symlinkSync(secret, path.join(repo, 'docs/dream-cycle/LEDGER.md'));
      const agg = aggregateDreamStatus(ws2, { limit: 5 });
      const r = agg.repos.find((x) => x.dir === 'evil');
      expect(r.ledgerExists).toBe(false);
      expect(r.error).toMatch(/symlink/);
      expect(JSON.stringify(agg)).not.toContain('ROOT-PASSWORD-HASH');
    } finally {
      fs.rmSync(ws2, { recursive: true, force: true });
    }
  });
});

describe('dream route: GET /dream/status', () => {
  let app;
  let ws;
  beforeAll(async () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dream-route-'));
    const a = path.join(ws, 'repo-a');
    fs.mkdirSync(path.join(a, 'docs', 'dream-cycle'), { recursive: true });
    fs.writeFileSync(path.join(a, 'dream.config.json'), JSON.stringify({ repo: 'org/repo-a' }));
    fs.writeFileSync(path.join(a, 'docs/dream-cycle/LEDGER.md'), ledger([row('2026-08-16', 'perf', 'ACCEPT')]));
    process.env.WORKSPACE = ws;
    app = Fastify({ logger: false });
    await app.register(dreamRoutes, { prefix: '', logger: { debug() {} } });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    fs.rmSync(ws, { recursive: true, force: true });
    delete process.env.WORKSPACE;
  });

  test('returns 200 with aggregated status', async () => {
    const res = await app.inject({ method: 'GET', url: '/dream/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.repoCount).toBe(1);
    expect(body.totals.ACCEPT).toBe(1);
    expect(typeof body.generatedAt).toBe('string');
    expect(body.repos[0].repo).toBe('org/repo-a');
  });

  test('clamps an out-of-range limit rather than 400-ing or slicing unboundedly', async () => {
    const res = await app.inject({ method: 'GET', url: '/dream/status?limit=9999' });
    expect(res.statusCode).toBe(200);
  });
});
