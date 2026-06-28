'use strict';

/**
 * lib/precedent-service — governance precedent system (PRD-harness M6).
 *
 * When a human approves the same type of governance decision repeatedly,
 * the system learns to auto-apply that decision. This converts recurring
 * feedback into feedforward — the harness improvement loop.
 *
 * Precedents are stored in RuVector memory (namespace: governance-precedents)
 * and matched via semantic similarity against incoming ActionRequest payloads.
 * When a match exceeds the configured threshold, the orchestrator can
 * auto-apply the decision without human intervention.
 *
 * The store is pluggable: inject a memoryStore in the constructor for
 * testing, or leave null to wire to the RuVector MCP tools in production.
 *
 * @see PRD-harness-engineering §M6
 * @see lib/uris — URN minting for PROV-O provenance
 */

const crypto = require('crypto');
const uris = require('./uris');

const DEFAULT_NAMESPACE = 'governance-precedents';
const DEFAULT_SIMILARITY_THRESHOLD = 0.85;

class PrecedentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PrecedentError';
  }
}

/**
 * In-memory store implementing the memoryStore interface.
 * Useful for testing without RuVector.
 *
 * Interface:
 *   store(key, value, namespace) → Promise<void>
 *   search(query, namespace, limit) → Promise<Array<{ key, value, similarity }>>
 *   list(namespace, limit) → Promise<Array<{ key, value }>>
 *   retrieve(key, namespace) → Promise<string|null>
 */
function createInMemoryStore() {
  const data = new Map(); // Map<namespace, Map<key, value>>

  function _ns(namespace) {
    if (!data.has(namespace)) data.set(namespace, new Map());
    return data.get(namespace);
  }

  /**
   * Naive word-overlap similarity for testing. Production uses
   * RuVector's MiniLM-L6-v2 384-dim vector cosine similarity.
   */
  function _wordSimilarity(a, b) {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let intersection = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) intersection++;
    }
    const union = new Set([...wordsA, ...wordsB]).size;
    return union === 0 ? 0 : intersection / union;
  }

  return {
    async store(key, value, namespace) {
      _ns(namespace).set(key, value);
    },

    async search(query, namespace, limit = 10) {
      const ns = _ns(namespace);
      const results = [];
      for (const [key, value] of ns.entries()) {
        // Extract _searchText from JSON values when available —
        // compare against the semantic text, not raw JSON syntax.
        let compareText = value;
        try {
          const parsed = JSON.parse(value);
          if (parsed._searchText) compareText = parsed._searchText;
        } catch { /* not JSON — compare raw */ }
        const similarity = _wordSimilarity(query, compareText);
        results.push({ key, value, similarity });
      }
      results.sort((a, b) => b.similarity - a.similarity);
      return results.slice(0, limit);
    },

    async list(namespace, limit = 100) {
      const ns = _ns(namespace);
      const results = [];
      for (const [key, value] of ns.entries()) {
        results.push({ key, value });
        if (results.length >= limit) break;
      }
      return results;
    },

    async retrieve(key, namespace) {
      const ns = _ns(namespace);
      return ns.get(key) || null;
    },
  };
}

class PrecedentService {
  /**
   * @param {object} opts
   * @param {string}  [opts.namespace]           — RuVector namespace (default: governance-precedents)
   * @param {number}  [opts.similarityThreshold] — minimum similarity for auto-match (default: 0.85)
   * @param {object}  [opts.memoryStore]         — injected store for testing (default: null, uses MCP)
   */
  constructor(opts = {}) {
    this.namespace = opts.namespace || DEFAULT_NAMESPACE;
    this.similarityThreshold = opts.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
    this._store = opts.memoryStore || null;
  }

  /**
   * Get the memory store, falling back to a stub that warns about
   * missing MCP wiring. Production callers must inject a store or
   * wire the MCP tools before calling service methods.
   */
  _getStore() {
    if (this._store) return this._store;
    throw new PrecedentError(
      'No memoryStore configured. Inject one via constructor opts ' +
      'or wire to RuVector MCP tools in production.'
    );
  }

  /**
   * Store a promoted governance decision as a precedent.
   *
   * @param {object} params
   * @param {string} params.caseId    — unique case identifier
   * @param {string} params.outcome   — decision outcome (approve, reject, defer, etc.)
   * @param {string} params.reason    — human-readable reason for the decision
   * @param {string} params.category  — decision category for matching
   * @param {string} params.decidedBy — pubkey hex of the deciding human
   * @param {string} [params.eventId] — originating ActionResponse event ID
   * @returns {Promise<{ stored: boolean, key: string }>}
   */
  async storePrecedent({ caseId, outcome, reason, category, decidedBy, eventId }) {
    if (!caseId) throw new PrecedentError('caseId is required');
    if (!outcome) throw new PrecedentError('outcome is required');
    if (!reason) throw new PrecedentError('reason is required');
    if (!category) throw new PrecedentError('category is required');

    const store = this._getStore();
    const key = `precedent-${caseId}`;
    const record = {
      caseId,
      outcome,
      reason,
      category,
      decidedBy: decidedBy || '',
      eventId: eventId || '',
      promotedAt: new Date().toISOString(),
      retired: false,
    };

    // The value stored is a searchable text summary followed by the
    // JSON record. RuVector embeds the value text for semantic search.
    const searchableValue = `${category} ${outcome} ${reason}`;
    const value = JSON.stringify({ ...record, _searchText: searchableValue });

    await store.store(key, value, this.namespace);
    return { stored: true, key };
  }

  /**
   * Search for a matching precedent for an incoming ActionRequest.
   *
   * @param {object} params
   * @param {string} params.title       — request title
   * @param {string} params.description — request description
   * @param {string} [params.category]  — request category
   * @returns {Promise<{ matched: boolean, precedent: object|null, similarity: number }>}
   */
  async matchPrecedent({ title, description, category }) {
    if (!title && !description) {
      return { matched: false, precedent: null, similarity: 0 };
    }

    const store = this._getStore();
    const query = [category, title, description].filter(Boolean).join(' ');
    const results = await store.search(query, this.namespace, 5);

    for (const result of results) {
      let record;
      try {
        record = JSON.parse(result.value);
      } catch {
        continue;
      }

      // Skip retired precedents
      if (record.retired) continue;

      if (result.similarity >= this.similarityThreshold) {
        return {
          matched: true,
          precedent: {
            key: result.key,
            caseId: record.caseId,
            outcome: record.outcome,
            reason: record.reason,
            category: record.category,
            decidedBy: record.decidedBy,
            eventId: record.eventId,
            promotedAt: record.promotedAt,
          },
          similarity: result.similarity,
        };
      }
    }

    // Best similarity from non-retired results, or 0
    const bestSimilarity = results.length > 0 ? results[0].similarity : 0;
    return { matched: false, precedent: null, similarity: bestSimilarity };
  }

  /**
   * Apply a matched precedent to auto-decide an ActionRequest.
   *
   * Produces a synthetic ActionResponse event the orchestrator can
   * process identically to a human decision, plus a PROV-O URN
   * linking the precedent source to this application.
   *
   * @param {object} params
   * @param {object} params.precedent          — matched precedent record
   * @param {object} params.actionRequestEvent — the incoming ActionRequest event
   * @returns {Promise<{ syntheticEvent: object, provenanceUrn: string }>}
   */
  async applyPrecedent({ precedent, actionRequestEvent }) {
    if (!precedent) throw new PrecedentError('precedent is required');
    if (!actionRequestEvent) throw new PrecedentError('actionRequestEvent is required');

    const eventId = crypto.randomBytes(32).toString('hex');
    const now = Math.floor(Date.now() / 1000);

    // Parse the action request content for case_id
    let requestContent = {};
    try {
      requestContent = typeof actionRequestEvent.content === 'string'
        ? JSON.parse(actionRequestEvent.content)
        : actionRequestEvent.content || {};
    } catch {
      // non-JSON content — proceed with empty
    }

    const caseId = requestContent.case_id || actionRequestEvent.id || eventId;

    // Mint a PROV-O provenance URN linking source precedent to this application.
    // Uses the 'activity' kind (content-addressed) from lib/uris.
    const provenancePayload = {
      type: 'precedent_application',
      source: precedent.key,
      target: caseId,
      appliedAt: new Date(now * 1000).toISOString(),
    };

    // The activity kind requires a pubkey scope. Use the precedent's
    // decidedBy if available, or fall back to a deterministic zero key.
    const scopePubkey = precedent.decidedBy && /^[0-9a-f]{64}$/.test(precedent.decidedBy)
      ? precedent.decidedBy
      : '0'.repeat(64);

    const provenanceUrn = uris.mint({
      kind: 'activity',
      pubkey: scopePubkey,
      payload: provenancePayload,
    });

    const syntheticEvent = {
      id: eventId,
      kind: 31403, // ActionResponse
      pubkey: precedent.decidedBy || '',
      content: JSON.stringify({
        case_id: caseId,
        outcome: precedent.outcome,
        reason: `Auto-applied from precedent ${precedent.key}: ${precedent.reason}`,
        type: 'precedent_auto_applied',
        precedent_source: precedent.key,
        provenance_urn: provenanceUrn,
      }),
      tags: [
        ['d', `response-${caseId}`],
        ['e', actionRequestEvent.id || ''],
        ['t', 'precedent-auto-applied'],
      ],
      created_at: now,
      sig: '', // synthetic — no cryptographic signature
    };

    return { syntheticEvent, provenanceUrn };
  }

  /**
   * Retire a precedent so it no longer matches future requests.
   *
   * @param {object} params
   * @param {string} params.caseId — case ID of the precedent to retire
   * @param {string} [params.reason] — reason for retirement
   * @returns {Promise<{ retired: boolean, key: string }>}
   */
  async retirePrecedent({ caseId, reason }) {
    if (!caseId) throw new PrecedentError('caseId is required');

    const store = this._getStore();
    const key = `precedent-${caseId}`;

    const existing = await store.retrieve(key, this.namespace);
    if (!existing) {
      throw new PrecedentError(`Precedent not found: ${key}`);
    }

    let record;
    try {
      record = JSON.parse(existing);
    } catch {
      throw new PrecedentError(`Corrupt precedent record: ${key}`);
    }

    record.retired = true;
    record.retiredAt = new Date().toISOString();
    record.retireReason = reason || '';

    await store.store(key, JSON.stringify(record), this.namespace);
    return { retired: true, key };
  }

  /**
   * List active (non-retired) precedents.
   *
   * @param {object} [opts]
   * @param {number} [opts.limit=20] — maximum number of results
   * @returns {Promise<{ precedents: Array, total: number }>}
   */
  async listPrecedents({ limit = 20 } = {}) {
    const store = this._getStore();
    const all = await store.list(this.namespace, 200);
    const active = [];

    for (const entry of all) {
      let record;
      try {
        record = JSON.parse(entry.value);
      } catch {
        continue;
      }
      if (record.retired) continue;
      active.push({
        key: entry.key,
        caseId: record.caseId,
        outcome: record.outcome,
        reason: record.reason,
        category: record.category,
        decidedBy: record.decidedBy,
        eventId: record.eventId,
        promotedAt: record.promotedAt,
      });
    }

    return {
      precedents: active.slice(0, limit),
      total: active.length,
    };
  }
}

module.exports = {
  PrecedentService,
  PrecedentError,
  createInMemoryStore,
  DEFAULT_NAMESPACE,
  DEFAULT_SIMILARITY_THRESHOLD,
};
