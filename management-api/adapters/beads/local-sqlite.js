'use strict';

/**
 * beads/local-sqlite — SQLite-backed durable work-receipt store.
 *
 * Self-initialising schema on first use. Uses better-sqlite3 sync API.
 * Path defaults to $WORKSPACE/beads.db (the agent workspace, normally
 * /home/devuser/workspace); override via opts.dbPath.
 *
 * @see ADR-005 §beads slot
 * @see PRD-001 §Capabilities and adapters
 */

const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { BaseAdapter } = require('../base');
const { NotFound, AlreadyClaimed } = require('../errors');
const CONTRACT_VERSIONS = require('../contract-versions');
const uris = require('../../lib/uris');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS beads (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    parent_id TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    priority INTEGER DEFAULT 1,
    actor TEXT,
    tags JSON,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bead_deps (
    child_id TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'blocks',
    PRIMARY KEY (child_id, parent_id)
  );
  CREATE INDEX IF NOT EXISTS ix_beads_parent ON beads(parent_id);
  CREATE INDEX IF NOT EXISTS ix_beads_status ON beads(status);
`;

class LocalSqliteBeadsAdapter extends BaseAdapter {
  /**
   * @param {object} [opts]
   * @param {string} [opts.dbPath=':memory:'] - SQLite file path or ':memory:' for tests
   */
  constructor(opts = {}) {
    super('beads', 'local-sqlite', CONTRACT_VERSIONS.beads);
    const workspace = process.env.WORKSPACE || path.join(os.homedir(), 'workspace');
    const dbPath = opts.dbPath || path.join(workspace, 'beads.db');
    this._db = new Database(dbPath);
    this._db.exec(SCHEMA);
  }

  /**
   * Create a top-level epic.
   * @param {object} opts
   * @param {string} opts.title
   * @param {number} [opts.priority=1]
   * @param {string} [opts.actor]
   * @param {string[]} [opts.tags]
   * @returns {{ id, title, type, status, priority, actor, tags, created_at, updated_at }}
   */
  async createEpic(opts = {}) {
    if (!opts.title) throw new Error('title is required');
    const now = new Date().toISOString();
    const pubkey = opts.actor || process.env.AGENTBOX_PUBKEY || '0'.repeat(64);
    const row = {
      id: uris.mint({ kind: 'bead', pubkey, payload: { title: opts.title, type: 'epic', ts: now } }),
      title: opts.title,
      type: 'epic',
      parent_id: null,
      status: 'open',
      priority: opts.priority ?? 1,
      actor: opts.actor ?? null,
      tags: opts.tags ? JSON.stringify(opts.tags) : null,
      created_at: now,
      updated_at: now,
    };
    this._db.prepare(
      `INSERT INTO beads (id, title, type, parent_id, status, priority, actor, tags, created_at, updated_at)
       VALUES (@id, @title, @type, @parent_id, @status, @priority, @actor, @tags, @created_at, @updated_at)`
    ).run(row);
    return this._hydrate(this._db.prepare('SELECT * FROM beads WHERE id = ?').get(row.id));
  }

  /**
   * Create a child bead under a parent epic.
   * @param {object} opts
   * @param {string} opts.title
   * @param {string} opts.parent_id
   * @param {string} [opts.actor]
   * @param {number} [opts.priority=1]
   * @param {string[]} [opts.tags]
   * @returns {object}
   */
  async createChild(opts = {}) {
    if (!opts.title) throw new Error('title is required');
    if (!opts.parent_id) throw new Error('parent_id is required');
    const parent = this._db.prepare('SELECT id FROM beads WHERE id = ?').get(opts.parent_id);
    if (!parent) throw new NotFound('epic', opts.parent_id);
    const now = new Date().toISOString();
    const childPubkey = opts.actor || process.env.AGENTBOX_PUBKEY || '0'.repeat(64);
    const row = {
      id: uris.mint({ kind: 'bead', pubkey: childPubkey, payload: { title: opts.title, type: 'child', parent: opts.parent_id, ts: now } }),
      title: opts.title,
      type: 'child',
      parent_id: opts.parent_id,
      status: 'open',
      priority: opts.priority ?? 1,
      actor: opts.actor ?? null,
      tags: opts.tags ? JSON.stringify(opts.tags) : null,
      created_at: now,
      updated_at: now,
    };
    this._db.prepare(
      `INSERT INTO beads (id, title, type, parent_id, status, priority, actor, tags, created_at, updated_at)
       VALUES (@id, @title, @type, @parent_id, @status, @priority, @actor, @tags, @created_at, @updated_at)`
    ).run(row);
    return this._hydrate(this._db.prepare('SELECT * FROM beads WHERE id = ?').get(row.id));
  }

  /**
   * Claim a bead by an actor. Idempotent — re-claim by same actor is a no-op.
   * @param {string} id
   * @param {string} actor
   * @returns {object} Updated bead
   */
  async claim(id, actor) {
    if (!id) throw new Error('id is required');
    if (!actor) throw new Error('actor is required');
    const bead = this._db.prepare('SELECT * FROM beads WHERE id = ?').get(id);
    if (!bead) throw new NotFound('bead', id);
    if (bead.actor && bead.actor !== actor) throw new AlreadyClaimed(id, bead.actor);
    // Idempotent — already claimed by same actor
    if (bead.actor === actor && bead.status === 'claimed') {
      return this._hydrate(bead);
    }
    const now = new Date().toISOString();
    this._db.prepare(
      `UPDATE beads SET actor = ?, status = 'claimed', updated_at = ? WHERE id = ?`
    ).run(actor, now, id);
    return this._hydrate(this._db.prepare('SELECT * FROM beads WHERE id = ?').get(id));
  }

  /**
   * Close a bead with an outcome.
   * @param {string} id
   * @param {string} [outcome='done']
   * @returns {object} Updated bead
   */
  async close(id, outcome = 'done') {
    if (!id) throw new Error('id is required');
    const bead = this._db.prepare('SELECT id FROM beads WHERE id = ?').get(id);
    if (!bead) throw new NotFound('bead', id);
    const now = new Date().toISOString();
    this._db.prepare(
      `UPDATE beads SET status = 'closed', tags = json_set(COALESCE(tags, '{}'), '$.outcome', ?), updated_at = ? WHERE id = ?`
    ).run(outcome, now, id);
    return this._hydrate(this._db.prepare('SELECT * FROM beads WHERE id = ?').get(id));
  }

  /**
   * Return unclaimed children, optionally filtered by parent_id.
   * @param {object} [filter]
   * @param {string} [filter.parent_id]
   * @returns {object[]}
   */
  async getReady(filter = {}) {
    if (filter && filter.parent_id) {
      const rows = this._db.prepare(
        `SELECT * FROM beads WHERE status = 'open' AND actor IS NULL AND parent_id = ?`
      ).all(filter.parent_id);
      return rows.map(r => this._hydrate(r));
    }
    const rows = this._db.prepare(
      `SELECT * FROM beads WHERE status = 'open' AND actor IS NULL`
    ).all();
    return rows.map(r => this._hydrate(r));
  }

  /**
   * Get full detail for a bead by id.
   * @param {string} id
   * @returns {object}
   */
  async show(id) {
    if (!id) throw new Error('id is required');
    const bead = this._db.prepare('SELECT * FROM beads WHERE id = ?').get(id);
    if (!bead) throw new NotFound('bead', id);
    return this._hydrate(bead);
  }

  /**
   * Close the underlying SQLite connection.
   */
  close_db() {
    this._db.close();
  }

  /** @private */
  _hydrate(row) {
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      type: row.type,
      parent_id: row.parent_id,
      status: row.status,
      priority: row.priority,
      actor: row.actor,
      tags: row.tags ? JSON.parse(row.tags) : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

module.exports = { LocalSqliteBeadsAdapter };
