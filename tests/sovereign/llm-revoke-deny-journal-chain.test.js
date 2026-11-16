'use strict';

/**
 * ADR-2087 FR4.4 / receipt checks B4 + B5, end to end with no fakes between the
 * route and the disk: POST /v1/llm/revoke with no decision surface is refused
 * (403), and the refusal is journalled EXACTLY ONCE as an `authority.deny`
 * record in the real hash-chained events adapter, in the same shape as its
 * neighbours, and the chain verifies afterwards.
 *
 * The 2026-10-12 receipt reported "B4 deny not journalled once": the record was
 * written, but the check counted records with `jq` over the whole directory and
 * jq stops at the first unparseable line (a torn record in 2026-10-12.jsonl),
 * so every count after it read zero. This test pins the route-to-disk behaviour
 * so a future B4 failure can only mean the route stopped journalling.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const Fastify = require(require.resolve('fastify', { paths: [path.join(__dirname, '../../management-api')] }));
const llmRoutes = require('../../management-api/routes/llm-marketplace');
const { buildAuthorityJournal } = require('../../management-api/lib/authority-journal');
const auditChain = require('../../management-api/lib/audit-chain');
const { LocalJsonlEventsAdapter } = require('../../management-api/adapters/events/local-jsonl');

const MANIFEST = {
  skills: { authority: { enabled: true, default: 'escalation', classes: { mandate_revoke: 'zero-tolerance' } } },
};
const QUIET = { info() {}, debug() {}, warn() {}, error() {} };

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revoke-journal-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

async function bootApp() {
  const events = new LocalJsonlEventsAdapter({ eventsDir: dir });
  const journal = buildAuthorityJournal({ eventsAdapter: events, publisher: null, logger: QUIET });
  const app = Fastify({ logger: false });
  app.register(llmRoutes, { logger: QUIET, manifest: MANIFEST });
  await app.register(async () => {});
  app.decorate('authorityDenyJournal', journal);
  await app.ready();
  return { app, events };
}

const records = () => fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()
  .flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));

describe('a refused revoke reaches the hash-chained journal', () => {
  test('one refusal, one authority.deny record, shaped like its neighbours, chain intact', async () => {
    const { app, events } = await bootApp();
    try {
      await events.dispatch({ kind: 'authority.deny', payload: { type: 'authority.deny', stage: 'decision-surface', reason: 'no-decision-surface', action_class: 'mandate_revoke' } }); // a neighbour
      const res = await app.inject({ method: 'POST', url: '/v1/llm/revoke', payload: { grant_id: 'g-probe', reason: 'test' } });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ revoked: false, code: 'no-decision-surface', hint: 'governance_manual_continue' });

      const denies = records().filter((r) => r.kind === 'authority.deny' && r.payload.action_class === 'mandate_revoke');
      expect(denies).toHaveLength(2); // the neighbour plus exactly one from the route
      const [neighbour, fromRoute] = denies;
      expect(Object.keys(fromRoute).sort()).toEqual(Object.keys(neighbour).sort());
      expect(fromRoute.payload).toMatchObject({
        type: 'authority.deny', stage: 'decision-surface', reason: 'no-decision-surface',
        action_class: 'mandate_revoke', authority_class: 'zero-tolerance',
      });
      expect(typeof fromRoute.payload.operation_sha256 === 'string' || fromRoute.payload.operation_sha256 === null).toBe(true);

      const verified = auditChain.verifyFiles(fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f)));
      expect(verified.ok).toBe(true);
      expect(verified.checked).toBe(2);
    } finally {
      await app.close();
    }
  });

  test('a second refusal adds exactly one more record (not zero, not two)', async () => {
    const { app } = await bootApp();
    try {
      for (let n = 1; n <= 3; n++) {
        await app.inject({ method: 'POST', url: '/v1/llm/revoke', payload: { grant_id: `g-${n}` } });
        expect(records().filter((r) => r.kind === 'authority.deny')).toHaveLength(n);
      }
    } finally {
      await app.close();
    }
  });
});
