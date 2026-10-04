'use strict';

/**
 * Contract test suite — ADR-2123 governed `ruflo memory …`.
 *
 * ruflo 3.51.1's memory subsystem is local-only (sql.js under .swarm/, an
 * AgentDB mirror, ./ruvector.db, a MiniLM embedder). In this image the baked
 * `ruflo`/`claude-flow` wrappers exec mcp/servers/ruflo-memory-cli.cjs for the
 * `memory` subcommand so the CLI — and the ruflo-console memory pane, which
 * shells out to it — serves the ruvector-postgres sidecar through the governed
 * memory library (lib/memory-tools.js, Xinference embeddings).
 *
 * Covers:
 *   1. Output shapes with --format json are the ones ruflo 3.51.1 emits and the
 *      console parses (plugins/ruflo-console/hooks/data/cli.ts memoryProbe /
 *      namespacesProbe): stats.{backend,entries.total,entries.vectors,
 *      storage.total,oldestEntry,newestEntry}; list → array with
 *      {id,key,namespace,size,accessCount,createdAt,updatedAt,hasEmbedding,
 *      provenanceType}.
 *   2. Every local-store subcommand is refused with exit 2 and touches nothing.
 *   3. Fail-closed: no pg → exit 1, JSON error, no fallback store.
 *   4. The write path is the governed memStore: a protected namespace is
 *      refused without RUVECTOR_ADMIN_WRITE, exactly as the MCP server does.
 *   5. ruflo's flag spellings parse (-k/-v/-n, --key=value, --format json).
 *
 * No DB contact: the pg pool and embedder are stubs.
 */

const path = require('path');

delete process.env.RUVECTOR_ADMIN_WRITE;
delete process.env.RUVECTOR_PROTECTED_NAMESPACES;

const cli = require('../../mcp/servers/ruflo-memory-cli.cjs');

// Shapes captured from the real ruflo 3.51.1 CLI on 2026-10-03
// (`ruflo memory stats --format json` / `ruflo memory list --format json`).
const RUFLO_STATS_KEYS = ['backend', 'entries', 'storage', 'version', 'oldestEntry', 'newestEntry'];
const RUFLO_LIST_KEYS = ['id', 'key', 'namespace', 'size', 'accessCount', 'createdAt', 'updatedAt', 'hasEmbedding', 'provenanceType'];

function fakePool(handlers) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      for (const [re, fn] of handlers) if (re.test(sql)) return fn(sql, params);
      throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
    },
    async end() {},
  };
}

const vec = Array.from({ length: cli.EMBEDDING_DIM }, (_, i) => i / cli.EMBEDDING_DIM);
const fakeEmbed = async () => vec;

describe('ADR-2123 governed ruflo memory CLI', () => {
  test('stats --format json emits the ruflo 3.51.1 shape the console parses', async () => {
    const pool = fakePool([
      [/pg_total_relation_size/, () => ({ rows: [{ total: '213332', vectors: '213330', oldest: new Date('2025-10-14T13:20:30Z'), newest: new Date('2026-10-03T18:29:12Z'), namespaces: 464, bytes: '2931515392' }] })],
      [/pg_extension/, () => ({ rows: [{ extversion: '0.3.0' }] })],
    ]);
    const r = await cli.run(['stats', '--format', 'json'], { deps: { pool, getEmbedding: fakeEmbed, xinfEnsure: async () => true, log: () => {} } });
    expect(r.code).toBe(cli.EXIT_OK);
    const out = JSON.parse(r.stdout);
    for (const k of RUFLO_STATS_KEYS) expect(out).toHaveProperty(k);
    expect(out.backend).toMatch(/^ruvector-postgres/);
    expect(out.backend.length).toBeLessThanOrEqual(60); // console's stringOf(…, 60)
    expect(out.entries).toEqual({ total: 213332, vectors: 213330, text: 2 });
    expect(out.storage.total).toBe('2931515392 B');
    expect(out.oldestEntry).toBe('2025-10-14T13:20:30.000Z');
    expect(out.newestEntry).toBe('2026-10-03T18:29:12.000Z');
    expect(out.version).toBe('ruvector-postgres 0.3.0');
    expect(out.embedding).toEqual(expect.objectContaining({ model: 'bge-small-en-v1.5', dimensions: 384 }));
  });

  test('list --format json emits ruflo-shaped rows, newest first, across namespaces by default', async () => {
    const pool = fakePool([
      [/SELECT id, key, namespace/, (sql, params) => {
        expect(params[0]).toBe('*');
        expect(params[1]).toBe(500);
        expect(params[2]).toEqual(['governance-precedents']); // wildcard excludes protected namespaces
        return { rows: [
          { id: 'agentbox:project-state:a', key: 'a', namespace: 'project-state', size: '12', access_count: 3, created_at: new Date(1791052152041), updated_at: new Date(1791052152041), has_embedding: true, source_type: 'agentbox' },
          { id: 'agentbox:personal-context:b', key: 'b', namespace: 'personal-context', size: '7', access_count: 0, created_at: new Date(1791051586246), updated_at: new Date(1791051586246), has_embedding: false, source_type: 'agentbox' },
        ] };
      }],
    ]);
    const r = await cli.run(['list', '--format', 'json', '--limit', '500'], { deps: { pool, getEmbedding: fakeEmbed, xinfEnsure: async () => true, log: () => {} } });
    expect(r.code).toBe(cli.EXIT_OK);
    const out = JSON.parse(r.stdout);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(2);
    for (const k of RUFLO_LIST_KEYS) expect(out[0]).toHaveProperty(k);
    expect(out[0]).toMatchObject({ key: 'a', namespace: 'project-state', size: 12, accessCount: 3, createdAt: 1791052152041, hasEmbedding: true, provenanceType: 'unknown' });
    expect(out[1].hasEmbedding).toBe(false);
  });

  test('list -n <namespace> scopes the query and does not exclude anything', async () => {
    const pool = fakePool([[/SELECT id, key, namespace/, (sql, params) => {
      expect(params[0]).toBe('cli-probe');
      expect(params[2]).toEqual([]);
      return { rows: [] };
    }]]);
    const r = await cli.run(['ls', '-n', 'cli-probe', '--format', 'json'], { deps: { pool, getEmbedding: fakeEmbed, xinfEnsure: async () => true, log: () => {} } });
    expect(r.code).toBe(cli.EXIT_OK);
    expect(JSON.parse(r.stdout)).toEqual([]);
  });

  test.each([...cli.REFUSED])('refuses `memory %s` with exit 2 and no backend contact', async (sub) => {
    const pool = fakePool([]);
    const r = await cli.run([sub, '--format', 'json'], { deps: { pool, getEmbedding: fakeEmbed, log: () => {} } });
    expect(r.code).toBe(cli.EXIT_REFUSED);
    expect(JSON.parse(r.stdout)).toMatchObject({ success: false, refused: sub });
    expect(pool.calls).toHaveLength(0);
    const human = await cli.run([sub], { deps: { pool, getEmbedding: fakeEmbed, log: () => {} } });
    expect(human.code).toBe(cli.EXIT_REFUSED);
    expect(human.stderr).toMatch(/ADR-2014/);
  });

  test('fails closed without pg: exit 1, JSON error, nothing written', async () => {
    const r = await cli.run(['stats', '--format', 'json'], { deps: { pool: null, getEmbedding: fakeEmbed, log: () => {} } });
    expect(r.code).toBe(cli.EXIT_FAIL);
    expect(JSON.parse(r.stdout)).toMatchObject({ success: false, backend: 'ruvector-postgres' });
  });

  test('store goes through the governed memStore: protected namespace refused without admin write', async () => {
    const pool = fakePool([[/INSERT INTO memory_entries/, () => ({ rowCount: 1, rows: [] })]]);
    const deps = { pool, getEmbedding: fakeEmbed, xinfEnsure: async () => true, log: () => {} };
    const refused = await cli.run(['store', '-k', 'x', '-v', 'y', '-n', 'governance-precedents', '--format', 'json'], { deps });
    expect(refused.code).toBe(cli.EXIT_FAIL);
    expect(JSON.parse(refused.stdout).success).toBe(false);
    expect(pool.calls).toHaveLength(0);

    const ok = await cli.run(['store', '--key=k1', '--value=hello world', '--namespace=cli-probe', '--tags', 'a,b', '--importance', '0.4', '--format', 'json'], { deps });
    expect(ok.code).toBe(cli.EXIT_OK);
    const out = JSON.parse(ok.stdout);
    expect(out).toMatchObject({ success: true, key: 'k1', namespace: 'cli-probe', embedded: true });
    const insert = pool.calls.find(c => /INSERT INTO memory_entries/.test(c.sql));
    expect(insert.params[0]).toBe(`${cli.WRITE_SOURCE_TYPE}:cli-probe:k1`); // same entry id the MCP server uses
    expect(insert.sql).toMatch(/ruvector\(384\)/);
  });

  test('store without an embedding is rejected (ADR-2014 fail-closed), never stored unsearchable', async () => {
    const pool = fakePool([[/INSERT INTO memory_entries/, () => ({ rowCount: 1, rows: [] })]]);
    const deps = { pool, getEmbedding: async () => { throw new Error('xinference down'); }, xinfEnsure: async () => true, log: () => {} };
    const r = await cli.run(['store', '-k', 'k', '-v', 'v', '-n', 'cli-probe', '--format', 'json'], { deps });
    expect(r.code).toBe(cli.EXIT_FAIL);
    expect(JSON.parse(r.stdout)).toMatchObject({ success: false, reason: 'embedding-unavailable' });
    expect(pool.calls.filter(c => /INSERT/.test(c.sql))).toHaveLength(0);
  });

  test('search uses the governed memSearch, shapes results and reports the backend', async () => {
    const pool = fakePool([
      [/<=>|embedding/i, () => ({ rows: [
        { key: 'a', namespace: 'project-state', value: '"alpha text"', score: 0.81, source_type: 'agentbox' },
        { key: 'b', namespace: 'project-state', value: '"beta text"', score: 0.2, source_type: 'agentbox' },
      ] })],
    ]);
    const r = await cli.run(['search', '-q', 'alpha', '-n', 'project-state', '-l', '5', '--threshold', '0.5', '--format', 'json'], { deps: { pool, getEmbedding: fakeEmbed, xinfEnsure: async () => true, log: () => {} } });
    expect(r.code).toBe(cli.EXIT_OK);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({ query: 'alpha', namespace: 'project-state', total: 1 });
    expect(out.backend).toMatch(/^ruvector-postgres \(hnsw-xinference\)/);
    expect(out.results[0].key).toBe('a');
    expect(out).toHaveProperty('searchTime');
  });

  test('usage errors exit 64; help exits 0', async () => {
    const deps = { pool: fakePool([]), getEmbedding: fakeEmbed, log: () => {} };
    expect((await cli.run(['bogus'], { deps })).code).toBe(cli.EXIT_USAGE);
    expect((await cli.run(['search'], { deps })).code).toBe(cli.EXIT_USAGE);
    expect((await cli.run(['store', '-k', 'only-key'], { deps })).code).toBe(cli.EXIT_USAGE);
    const help = await cli.run(['help'], { deps });
    expect(help.code).toBe(cli.EXIT_OK);
    expect(help.stdout).toMatch(/ADR-2123/);
  });

  test('parseArgs accepts ruflo spellings', () => {
    const { flags, positional } = cli.parseArgs(['store', '-k', 'key1', '--value=v=1', '-n', 'ns', '--format', 'json', '--verbose']);
    expect(positional).toEqual(['store']);
    expect(flags).toEqual({ key: 'key1', value: 'v=1', namespace: 'ns', format: 'json', verbose: true });
  });

  test('the shipped wrapper routes `memory` to this CLI and sets the repo-safe defaults', () => {
    const fs = require('fs');
    const flake = fs.readFileSync(path.join(__dirname, '..', '..', 'flake.nix'), 'utf8');
    const block = flake.slice(flake.indexOf('rufloGovernedPkg = pkgs.runCommand'));
    expect(block).toMatch(/if \[ "\\\$1" = "memory" \]/);
    expect(block).toMatch(/ruflo-memory-cli\.cjs/);
    for (const v of ['RUFLO_DAEMON_AUTOSTART', 'CLAUDE_FLOW_DISABLE_BRIDGE', 'CLAUDE_FLOW_MEMORY_PATH']) expect(block).toContain(`export ${v}=`);
    expect(flake).toMatch(/rufloConsoleOn\) \[ rufloGovernedPkg \]/);
    const entry = fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'entrypoint-unified.sh'), 'utf8');
    expect(entry).toMatch(/export RUFLO_DAEMON_AUTOSTART="\$\{RUFLO_DAEMON_AUTOSTART:-0\}"/);
    expect(entry).toMatch(/export CLAUDE_FLOW_DISABLE_BRIDGE="\$\{CLAUDE_FLOW_DISABLE_BRIDGE:-1\}"/);
  });
});
