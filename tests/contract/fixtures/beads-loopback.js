'use strict';

/**
 * beads-loopback — a stateful in-process HTTP backend for the beads slot.
 *
 * The events/pods external adapters can be exercised with a stateless
 * fetch-stub because their M2 assertions verify a single request/response
 * round-trip (dispatch returns ts/kind/payload; pod write returns a Location).
 * The beads slot cannot: its M2 assertions assert *stateful behavioural
 * parity* — createChild must link to a previously-created epic's id, claim
 * then getReady must exclude the just-claimed child, close after claim must
 * preserve the original actor, and typed NotFound/AlreadyClaimed must surface
 * over the wire. A canned-body stub would be a fake, not a contract test.
 *
 * This loopback gives the ExternalBeadsAdapter a real federated leg to drive:
 * a `fetchFn` that serialises through the same HTTP path the production
 * adapter uses (`POST /v1/beads/epics`, `POST /v1/beads/:id/claim`,
 * `GET /v1/beads/ready?parent_id=...`, ...), parses the JSON body, mutates a
 * stateful in-memory store, and returns HTTP status codes the adapter maps to
 * typed errors (404 → NotFound, 409 → AlreadyClaimed). The store semantics
 * mirror adapters/beads/local-sqlite.js so federated parity is asserted
 * against the same behaviour the local-first impl guarantees.
 *
 * This is a contract-level LOOPBACK, not a mock: every assertion exercises the
 * adapter's real request construction, header emission, response parsing, and
 * typed-error mapping. Only the network hop is short-circuited.
 *
 * @see ADR-005 §Contract test harness  — "all three implementation classes"
 * @see ADR-031 §Real-parity vs registered exemption — chosen path: real parity
 */

let _seq = 0;
function _id(prefix) {
  _seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${_seq.toString(36)}`;
}

/**
 * Build a stateful loopback. Returns a `fetchFn` compatible with the
 * ExternalBeadsAdapter's `opts.fetchFn` contract: `(url, opts) => Response`.
 *
 * @returns {{ fetchFn: Function, store: Map }}
 */
function makeBeadsLoopback() {
  /** @type {Map<string, object>} id → bead row */
  const store = new Map();

  function jsonResponse(status, body) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }

  function notFound(resource, id) {
    return jsonResponse(404, { resource, id });
  }

  function alreadyClaimed(id, actor) {
    return jsonResponse(409, { id, actor });
  }

  function createEpic(payload) {
    const now = new Date().toISOString();
    const row = {
      id: _id('ep'),
      title: payload.title,
      type: 'epic',
      parent_id: null,
      status: 'open',
      priority: payload.priority ?? 1,
      actor: payload.actor ?? null,
      tags: payload.tags ?? null,
      created_at: now,
      updated_at: now,
    };
    store.set(row.id, row);
    return jsonResponse(201, row);
  }

  function createChild(payload) {
    if (!payload.parent_id || !store.has(payload.parent_id)) {
      return notFound('epic', payload.parent_id || '?');
    }
    const now = new Date().toISOString();
    const row = {
      id: _id('ch'),
      title: payload.title,
      type: 'child',
      parent_id: payload.parent_id,
      status: 'open',
      priority: payload.priority ?? 1,
      actor: payload.actor ?? null,
      tags: payload.tags ?? null,
      created_at: now,
      updated_at: now,
    };
    store.set(row.id, row);
    return jsonResponse(201, row);
  }

  function claim(id, payload) {
    const row = store.get(id);
    if (!row) return notFound('bead', id);
    const actor = payload.actor;
    if (row.actor && row.actor !== actor) return alreadyClaimed(id, row.actor);
    // Idempotent: re-claim by same actor.
    row.actor = actor;
    row.status = 'claimed';
    row.updated_at = new Date().toISOString();
    return jsonResponse(200, row);
  }

  function close(id, payload) {
    const row = store.get(id);
    if (!row) return notFound('bead', id);
    row.status = 'closed';
    row.tags = { ...(row.tags || {}), outcome: payload.outcome || 'done' };
    row.updated_at = new Date().toISOString();
    return jsonResponse(200, row);
  }

  function getReady(parentId) {
    const rows = [...store.values()].filter(
      (r) => r.status === 'open' && r.actor == null && (parentId ? r.parent_id === parentId : true),
    );
    return jsonResponse(200, rows);
  }

  function show(id) {
    const row = store.get(id);
    if (!row) return notFound('bead', id);
    return jsonResponse(200, row);
  }

  /**
   * Route an adapter HTTP call. Mirrors the path grammar the
   * ExternalBeadsAdapter emits (see adapters/beads/external.js).
   */
  async function fetchFn(url, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    // Strip scheme+host; keep path + query.
    const u = new URL(url, 'http://loopback');
    const path = u.pathname;
    let body = {};
    if (opts.body) {
      try { body = JSON.parse(opts.body); } catch (_) { body = {}; }
    }

    // POST /v1/beads/epics
    if (method === 'POST' && path === '/v1/beads/epics') return createEpic(body);
    // POST /v1/beads/children
    if (method === 'POST' && path === '/v1/beads/children') return createChild(body);

    // POST /v1/beads/:id/claim
    let m = path.match(/^\/v1\/beads\/([^/]+)\/claim$/);
    if (method === 'POST' && m) return claim(decodeURIComponent(m[1]), body);

    // POST /v1/beads/:id/close
    m = path.match(/^\/v1\/beads\/([^/]+)\/close$/);
    if (method === 'POST' && m) return close(decodeURIComponent(m[1]), body);

    // GET /v1/beads/ready[?parent_id=...]
    if (method === 'GET' && path === '/v1/beads/ready') {
      const parentId = u.searchParams.get('parent_id');
      return getReady(parentId);
    }

    // GET /v1/beads/:id
    m = path.match(/^\/v1\/beads\/([^/]+)$/);
    if (method === 'GET' && m) return show(decodeURIComponent(m[1]));

    return jsonResponse(404, { resource: 'route', id: `${method} ${path}` });
  }

  return { fetchFn, store };
}

module.exports = { makeBeadsLoopback };
