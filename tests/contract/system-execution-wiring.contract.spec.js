'use strict';

/**
 * Contract test — ADR-2041: server.js registers `routes/system` with
 * `execution.snapshot = action-plane.getCoverageSnapshot`, so `/v1/system`
 * carries the live execution snapshot instead of always under-reporting
 * `declared`.
 */

const fs = require('fs');
const path = require('path');
const Fastify = require('../../management-api/node_modules/fastify');
const systemRoutes = require('../../management-api/routes/system');
const actionPlane = require('../../management-api/lib/action-plane');

const logger = { debug() {}, info() {}, warn() {}, error() {} };

async function build(execution) {
  const app = Fastify();
  await app.register(systemRoutes, { logger, manifest: {}, adapters: null, tipProbes: {}, execution });
  await app.ready();
  return app;
}

describe('ADR-2041 /v1/system execution wiring', () => {
  test('server.js passes action-plane.getCoverageSnapshot as execution.snapshot', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../management-api/server.js'), 'utf8');
    const at = src.indexOf("require('./routes/system')");
    expect(at).toBeGreaterThan(-1);
    const call = src.slice(at, at + 600);
    expect(call).toMatch(/execution:\s*\{\s*snapshot:\s*require\('\.\/lib\/action-plane'\)\.getCoverageSnapshot\s*\}/);
  });

  test('with the real snapshot and no built plane, execution is declared (never fabricated live)', async () => {
    const app = await build({ snapshot: actionPlane.getCoverageSnapshot });
    const res = await app.inject({ method: 'GET', url: '/v1/system' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.execution.journal.status).toBe('declared');
    await app.close();
  });

  test('a live snapshot from the wired option surfaces as status live on /v1/system', async () => {
    const snapshot = () => ({
      journal: { harness_coverage: { claude: ['task.spawn'] }, sessions: { s1: 3 }, mode: 'local' },
      pipeline: { stages: [], executed: 1 },
    });
    const app = await build({ snapshot });
    const res = await app.inject({ method: 'GET', url: '/v1/system' });
    const body = res.json();
    expect(body.execution.journal.status).toBe('live');
    expect(body.execution.journal.sessions).toEqual({ s1: 3 });
    await app.close();
  });
});
