'use strict';

/**
 * Callers inside a Management API task have TASK_ACTION_TOKEN and TASK_ID but
 * no MANAGEMENT_API_KEY. The trajectory recorder and the consultant emitter
 * must authenticate with the token (and the consultant must name its task).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const TOKEN = 'tok-' + 'z'.repeat(40);
const TASK = 'urn:agentbox:activity:cccccccccccc';

function listen() {
  const hits = [];
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => { hits.push({ url: req.url, auth: req.headers.authorization, body: b ? JSON.parse(b) : null }); res.end('{}'); });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, hits, port: srv.address().port })));
}

function withEnv(env, fn) {
  const prev = {};
  for (const k of Object.keys(env)) { prev[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  const restore = () => { for (const k of Object.keys(env)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } };
  return Promise.resolve().then(fn).finally(restore);
}

describe('trajectory recorder emit', () => {
  // The recorder is a self-running hook script, so lift its emit function out
  // of the source rather than require() it (which would run main()).
  const src = fs.readFileSync(path.join(__dirname, '../../config/hooks/trajectory-recorder.cjs'), 'utf8');
  const start = src.indexOf('const CTC_EMIT_TIMEOUT_MS');
  const end = src.indexOf('// ADR-2015 accounting closeout');
  const emitCtcStep = new Function('http', 'process', 'log', `${src.slice(start, end)}; return emitCtcStep;`)(http, process, () => {});

  test('posts with the task token when the API key is absent', async () => {
    const { srv, hits, port } = await listen();
    await withEnv({ MANAGEMENT_API_KEY: undefined, TASK_ACTION_TOKEN: TOKEN, MANAGEMENT_API_PORT: String(port) },
      () => emitCtcStep({ source_agent_id: 'a', target_node_id: 'b', action_type: 'query', taskId: TASK }));
    srv.close();
    expect(hits).toHaveLength(1);
    expect(hits[0].auth).toBe(`Bearer ${TOKEN}`);
  });

  test('operator key still wins when present', async () => {
    const { srv, hits, port } = await listen();
    await withEnv({ MANAGEMENT_API_KEY: 'op-key', TASK_ACTION_TOKEN: TOKEN, MANAGEMENT_API_PORT: String(port) },
      () => emitCtcStep({ source_agent_id: 'a', target_node_id: 'b', action_type: 'query' }));
    srv.close();
    expect(hits[0].auth).toBe('Bearer op-key');
  });
});

describe('consultant emitter', () => {
  test('no early return without the key: posts with the token and names its task', async () => {
    const { srv, hits, port } = await listen();
    await withEnv({ MANAGEMENT_API_KEY: undefined, TASK_ACTION_TOKEN: TOKEN, TASK_ID: TASK, MANAGEMENT_API_PORT: String(port) }, async () => {
      jest.resetModules();
      const { _emitConsultEvent } = require('../../mcp/consultants/shared/consultant-base');
      _emitConsultEvent('codex', { consultation_urn: 'urn:x', model: 'm', ok: true });
      for (let i = 0; i < 50 && !hits.length; i++) await new Promise((r) => setTimeout(r, 20));
    });
    srv.close();
    expect(hits).toHaveLength(1);
    expect(hits[0].auth).toBe(`Bearer ${TOKEN}`);
    expect(hits[0].body.taskId).toBe(TASK);
  });

  test('with neither credential it stays silent', async () => {
    const { srv, hits, port } = await listen();
    await withEnv({ MANAGEMENT_API_KEY: undefined, TASK_ACTION_TOKEN: undefined, TASK_ID: undefined, MANAGEMENT_API_PORT: String(port) }, async () => {
      jest.resetModules();
      require('../../mcp/consultants/shared/consultant-base')._emitConsultEvent('codex', { consultation_urn: 'urn:x' });
      await new Promise((r) => setTimeout(r, 100));
    });
    srv.close();
    expect(hits).toHaveLength(0);
  });
});
