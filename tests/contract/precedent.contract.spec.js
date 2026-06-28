'use strict';

/**
 * Contract test suite — precedent system (PRD-harness M6)
 *
 * Exercises the PrecedentService lifecycle:
 *   1. Store a promoted governance decision as a precedent
 *   2. Match an incoming ActionRequest against stored precedents
 *   3. Auto-apply a matched precedent (synthetic ActionResponse + PROV-O)
 *   4. Retire a precedent and verify it no longer matches
 *   5. List only active precedents
 *
 * Uses an in-memory store — no RuVector, no filesystem, no network.
 *
 * @see management-api/lib/precedent-service.js
 * @see mcp/servers/precedent-bridge.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

function expect(actual) {
  return {
    toBe(expected)        { assert.strictEqual(actual, expected); },
    toEqual(expected)     { assert.deepStrictEqual(actual, expected); },
    toBeDefined()         { assert.notStrictEqual(actual, undefined); },
    toBeUndefined()       { assert.strictEqual(actual, undefined); },
    toBeTruthy()          { assert.ok(actual); },
    toBeFalsy()           { assert.ok(!actual); },
    toBeNull()            { assert.strictEqual(actual, null); },
    toBeGreaterThan(n)    { assert.ok(actual > n); },
    toBeGreaterThanOrEqual(n) { assert.ok(actual >= n); },
    toBeLessThan(n)       { assert.ok(actual < n); },
    toContain(s)          { assert.ok(typeof actual === 'string' ? actual.includes(s) : Array.isArray(actual) && actual.includes(s)); },
    toMatch(re)           { assert.match(actual, re); },
    toThrow(msg)          { assert.throws(actual, msg ? { message: msg } : undefined); },
    toHaveLength(n)       { assert.strictEqual(actual.length, n); },
    toHaveProperty(k, v)  { assert.ok(k in actual); if (v !== undefined) assert.deepStrictEqual(actual[k], v); },
    not: {
      toBe(expected)      { assert.notStrictEqual(actual, expected); },
      toBeDefined()       { assert.strictEqual(actual, undefined); },
      toBeNull()          { assert.notStrictEqual(actual, null); },
      toContain(s)        { assert.ok(typeof actual === 'string' ? !actual.includes(s) : !(Array.isArray(actual) && actual.includes(s))); },
    },
  };
}

const crypto = require('crypto');

const {
  PrecedentService,
  PrecedentError,
  createInMemoryStore,
} = require('../../management-api/lib/precedent-service');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_PUBKEY = 'a'.repeat(64);
const TEST_PUBKEY_B = 'b'.repeat(64);

/** Build a minimal ActionRequest event fixture. */
function makeActionRequestEvent({ caseId, title, description, category } = {}) {
  return {
    id: crypto.randomBytes(32).toString('hex'),
    kind: 31402,
    pubkey: TEST_PUBKEY,
    content: JSON.stringify({
      case_id: caseId || `case-${crypto.randomUUID().slice(0, 8)}`,
      title: title || 'Approve knowledge graph merge',
      description: description || 'Agent recommends merging 42 new concepts into the ontology.',
      category: category || 'kg-merge',
    }),
    tags: [['d', `request-${caseId || 'test'}`]],
    created_at: Math.floor(Date.now() / 1000),
    sig: 'f'.repeat(128),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('precedent system :: contract tests', () => {

  let store;
  let service;

  beforeEach(() => {
    store = createInMemoryStore();
    service = new PrecedentService({
      memoryStore: store,
      similarityThreshold: 0.85,
    });
  });

  // ── Store and match ────────────────────────────────────────────────────

  describe('store → match → returns correct result', () => {

    it('stores a precedent and matches it with high similarity', async () => {
      // Store a precedent about KG merge approvals
      const storeResult = await service.storePrecedent({
        caseId: 'case-kg-001',
        outcome: 'approve',
        reason: 'Knowledge graph merge verified by domain expert',
        category: 'kg-merge',
        decidedBy: TEST_PUBKEY,
        eventId: 'evt-001',
      });

      expect(storeResult.stored).toBe(true);
      expect(storeResult.key).toBe('precedent-case-kg-001');

      // Match with a very similar query (word overlap must exceed 0.85)
      const matchResult = await service.matchPrecedent({
        title: 'Knowledge graph merge verified',
        description: 'Knowledge graph merge verified by domain expert',
        category: 'kg-merge',
      });

      expect(matchResult.matched).toBe(true);
      expect(matchResult.precedent).not.toBeNull();
      expect(matchResult.precedent.caseId).toBe('case-kg-001');
      expect(matchResult.precedent.outcome).toBe('approve');
      expect(matchResult.precedent.reason).toBe('Knowledge graph merge verified by domain expert');
      expect(matchResult.precedent.category).toBe('kg-merge');
      expect(matchResult.precedent.decidedBy).toBe(TEST_PUBKEY);
      expect(matchResult.similarity).toBeGreaterThanOrEqual(0.85);
    });

    it('returns all expected fields on a matched precedent', async () => {
      await service.storePrecedent({
        caseId: 'case-fields-check',
        outcome: 'reject',
        reason: 'Ontology proposal contains circular references',
        category: 'ontology-review',
        decidedBy: TEST_PUBKEY_B,
        eventId: 'evt-fields',
      });

      const matchResult = await service.matchPrecedent({
        title: 'Ontology proposal circular references',
        description: 'Ontology proposal contains circular references',
        category: 'ontology-review',
      });

      expect(matchResult.matched).toBe(true);
      const p = matchResult.precedent;
      expect(p.key).toBe('precedent-case-fields-check');
      expect(p.caseId).toBe('case-fields-check');
      expect(p.outcome).toBe('reject');
      expect(p.eventId).toBe('evt-fields');
      expect(p.promotedAt).toBeDefined();
    });
  });

  // ── Low similarity → no match ─────────────────────────────────────────

  describe('store → match with low similarity → returns matched=false', () => {

    it('does not match when query is semantically distant', async () => {
      await service.storePrecedent({
        caseId: 'case-kg-002',
        outcome: 'approve',
        reason: 'Knowledge graph merge verified by domain expert',
        category: 'kg-merge',
        decidedBy: TEST_PUBKEY,
      });

      // Query about something completely different
      const matchResult = await service.matchPrecedent({
        title: 'Deploy new authentication microservice',
        description: 'Provision TLS certificates and rotate API keys for the auth gateway',
        category: 'infrastructure',
      });

      expect(matchResult.matched).toBe(false);
      expect(matchResult.precedent).toBeNull();
      expect(matchResult.similarity).toBeLessThan(0.85);
    });

    it('returns matched=false when no precedents exist', async () => {
      const matchResult = await service.matchPrecedent({
        title: 'Anything',
        description: 'No precedents stored yet',
      });

      expect(matchResult.matched).toBe(false);
      expect(matchResult.precedent).toBeNull();
    });

    it('returns matched=false when title and description are empty', async () => {
      const matchResult = await service.matchPrecedent({
        title: '',
        description: '',
      });

      expect(matchResult.matched).toBe(false);
      expect(matchResult.precedent).toBeNull();
      expect(matchResult.similarity).toBe(0);
    });
  });

  // ── Store → retire → match → returns matched=false ────────────────────

  describe('store → retire → match → returns matched=false', () => {

    it('retired precedent is skipped during matching', async () => {
      await service.storePrecedent({
        caseId: 'case-retire-001',
        outcome: 'approve',
        reason: 'Automated KG merge approved after validation',
        category: 'kg-merge',
        decidedBy: TEST_PUBKEY,
      });

      // Verify it matches before retirement (use exact wording for word overlap)
      const beforeRetire = await service.matchPrecedent({
        title: 'KG merge approved after validation',
        description: 'Automated KG merge approved after validation',
        category: 'kg-merge',
      });
      expect(beforeRetire.matched).toBe(true);

      // Retire
      const retireResult = await service.retirePrecedent({
        caseId: 'case-retire-001',
        reason: 'Policy changed — manual review now required',
      });
      expect(retireResult.retired).toBe(true);
      expect(retireResult.key).toBe('precedent-case-retire-001');

      // Match again — should no longer match
      const afterRetire = await service.matchPrecedent({
        title: 'KG merge approved after validation',
        description: 'Automated KG merge approved after validation',
        category: 'kg-merge',
      });
      expect(afterRetire.matched).toBe(false);
      expect(afterRetire.precedent).toBeNull();
    });

    it('throws PrecedentError when retiring a nonexistent precedent', async () => {
      await assert.rejects(
        () => service.retirePrecedent({ caseId: 'nonexistent' }),
        { name: 'PrecedentError' },
      );
    });

    it('throws PrecedentError when caseId is missing', async () => {
      await assert.rejects(
        () => service.retirePrecedent({}),
        { name: 'PrecedentError', message: /caseId is required/ },
      );
    });
  });

  // ── Apply generates correct synthetic event with PROV-O URN ───────────

  describe('apply generates correct synthetic event with PROV-O URN', () => {

    it('produces a synthetic ActionResponse with provenance URN', async () => {
      await service.storePrecedent({
        caseId: 'case-apply-001',
        outcome: 'approve',
        reason: 'Merge validated by ontology expert',
        category: 'kg-merge',
        decidedBy: TEST_PUBKEY,
      });

      const matchResult = await service.matchPrecedent({
        title: 'Merge validated by ontology expert approve',
        description: 'Merge validated by ontology expert',
        category: 'kg-merge',
      });
      expect(matchResult.matched).toBe(true);

      const actionRequest = makeActionRequestEvent({
        caseId: 'case-new-001',
        title: 'New KG merge request',
        description: 'Agent proposes merging 15 concepts',
        category: 'kg-merge',
      });

      const { syntheticEvent, provenanceUrn } = await service.applyPrecedent({
        precedent: matchResult.precedent,
        actionRequestEvent: actionRequest,
      });

      // Verify synthetic event structure
      expect(syntheticEvent.kind).toBe(31403);
      expect(syntheticEvent.id).toBeDefined();
      expect(typeof syntheticEvent.id).toBe('string');
      expect(syntheticEvent.id.length).toBe(64); // hex-encoded 32 bytes

      const content = JSON.parse(syntheticEvent.content);
      expect(content.outcome).toBe('approve');
      expect(content.type).toBe('precedent_auto_applied');
      expect(content.case_id).toBe('case-new-001');
      expect(content.reason).toContain('Auto-applied from precedent');
      expect(content.reason).toContain('precedent-case-apply-001');
      expect(content.reason).toContain('Merge validated by ontology expert');
      expect(content.precedent_source).toBe('precedent-case-apply-001');
      expect(content.provenance_urn).toBeDefined();

      // Verify tags
      const tTag = syntheticEvent.tags.find(t => t[0] === 't');
      expect(tTag).toBeDefined();
      expect(tTag[1]).toBe('precedent-auto-applied');

      const eTag = syntheticEvent.tags.find(t => t[0] === 'e');
      expect(eTag).toBeDefined();
      expect(eTag[1]).toBe(actionRequest.id);

      // Verify PROV-O URN
      expect(provenanceUrn).toBeDefined();
      expect(provenanceUrn).toMatch(/^urn:agentbox:activity:/);
      expect(content.provenance_urn).toBe(provenanceUrn);
    });

    it('uses a zero-key scope when decidedBy is missing', async () => {
      const precedent = {
        key: 'precedent-no-pubkey',
        caseId: 'no-pubkey',
        outcome: 'defer',
        reason: 'Deferred pending review',
        category: 'general',
        decidedBy: '',
        eventId: '',
        promotedAt: new Date().toISOString(),
      };

      const actionRequest = makeActionRequestEvent({ caseId: 'case-zero-key' });

      const { provenanceUrn } = await service.applyPrecedent({
        precedent,
        actionRequestEvent: actionRequest,
      });

      // Should still produce a valid URN with zero-key scope
      expect(provenanceUrn).toMatch(/^urn:agentbox:activity:0{64}:/);
    });

    it('throws when precedent is missing', async () => {
      const actionRequest = makeActionRequestEvent();
      await assert.rejects(
        () => service.applyPrecedent({ precedent: null, actionRequestEvent: actionRequest }),
        { name: 'PrecedentError', message: /precedent is required/ },
      );
    });

    it('throws when actionRequestEvent is missing', async () => {
      await assert.rejects(
        () => service.applyPrecedent({ precedent: { key: 'x' }, actionRequestEvent: null }),
        { name: 'PrecedentError', message: /actionRequestEvent is required/ },
      );
    });
  });

  // ── List returns only active precedents ────────────────────────────────

  describe('list returns only active precedents', () => {

    it('lists all stored precedents when none are retired', async () => {
      await service.storePrecedent({
        caseId: 'list-001',
        outcome: 'approve',
        reason: 'Approved merge',
        category: 'kg-merge',
        decidedBy: TEST_PUBKEY,
      });
      await service.storePrecedent({
        caseId: 'list-002',
        outcome: 'reject',
        reason: 'Rejected proposal',
        category: 'ontology-review',
        decidedBy: TEST_PUBKEY_B,
      });

      const result = await service.listPrecedents();
      expect(result.total).toBe(2);
      expect(result.precedents).toHaveLength(2);

      const caseIds = result.precedents.map(p => p.caseId);
      expect(caseIds).toContain('list-001');
      expect(caseIds).toContain('list-002');
    });

    it('excludes retired precedents from the list', async () => {
      await service.storePrecedent({
        caseId: 'list-active',
        outcome: 'approve',
        reason: 'Active precedent',
        category: 'general',
        decidedBy: TEST_PUBKEY,
      });
      await service.storePrecedent({
        caseId: 'list-retired',
        outcome: 'reject',
        reason: 'Will be retired',
        category: 'general',
        decidedBy: TEST_PUBKEY,
      });

      await service.retirePrecedent({ caseId: 'list-retired', reason: 'Outdated' });

      const result = await service.listPrecedents();
      expect(result.total).toBe(1);
      expect(result.precedents).toHaveLength(1);
      expect(result.precedents[0].caseId).toBe('list-active');
    });

    it('returns empty list when no precedents exist', async () => {
      const result = await service.listPrecedents();
      expect(result.total).toBe(0);
      expect(result.precedents).toHaveLength(0);
    });

    it('respects the limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await service.storePrecedent({
          caseId: `limit-${i}`,
          outcome: 'approve',
          reason: `Reason ${i}`,
          category: 'general',
          decidedBy: TEST_PUBKEY,
        });
      }

      const result = await service.listPrecedents({ limit: 3 });
      expect(result.precedents).toHaveLength(3);
      expect(result.total).toBe(5);
    });
  });

  // ── Validation ────────────────────────────────────────────────────────

  describe('validation', () => {

    it('throws PrecedentError when storing without caseId', async () => {
      await assert.rejects(
        () => service.storePrecedent({
          outcome: 'approve', reason: 'test', category: 'test',
        }),
        { name: 'PrecedentError', message: /caseId is required/ },
      );
    });

    it('throws PrecedentError when storing without outcome', async () => {
      await assert.rejects(
        () => service.storePrecedent({
          caseId: 'x', reason: 'test', category: 'test',
        }),
        { name: 'PrecedentError', message: /outcome is required/ },
      );
    });

    it('throws PrecedentError when storing without reason', async () => {
      await assert.rejects(
        () => service.storePrecedent({
          caseId: 'x', outcome: 'approve', category: 'test',
        }),
        { name: 'PrecedentError', message: /reason is required/ },
      );
    });

    it('throws PrecedentError when storing without category', async () => {
      await assert.rejects(
        () => service.storePrecedent({
          caseId: 'x', outcome: 'approve', reason: 'test',
        }),
        { name: 'PrecedentError', message: /category is required/ },
      );
    });

    it('throws PrecedentError when no memoryStore is configured', async () => {
      const noStoreService = new PrecedentService();
      await assert.rejects(
        () => noStoreService.storePrecedent({
          caseId: 'x', outcome: 'approve', reason: 'test', category: 'test',
        }),
        { name: 'PrecedentError', message: /No memoryStore configured/ },
      );
    });
  });

  // ── Custom threshold ──────────────────────────────────────────────────

  describe('custom similarity threshold', () => {

    it('matches with a lower threshold that would not match at default', async () => {
      const looseService = new PrecedentService({
        memoryStore: store,
        similarityThreshold: 0.1,
      });

      await looseService.storePrecedent({
        caseId: 'threshold-test',
        outcome: 'approve',
        reason: 'Knowledge graph merge',
        category: 'kg-merge',
        decidedBy: TEST_PUBKEY,
      });

      // A somewhat related but not identical query — shares "merge" and "kg-merge"
      // but differs enough that default 0.85 threshold would reject it
      const matchResult = await looseService.matchPrecedent({
        title: 'Graph operations pending',
        description: 'Merge some graph data into repository',
        category: 'kg-merge',
      });

      expect(matchResult.matched).toBe(true);
    });
  });
});
