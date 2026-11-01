'use strict';

/**
 * lib/routing-label-store — the one place `routing_labels` rows are written
 * (ADR-2110, on the ADR-2164 pattern).
 *
 * The routing-label recorder (config/hooks/routing-label-recorder.cjs) used to
 * open its own Postgres connection, which put the database conninfo, password
 * included, in a registered Stop-hook command. It now posts rows it has already
 * built (embedding, label, router pick) to `POST /v1/agent-events/routing-label`
 * and this module runs the same DDL and parameterised INSERT through the memory
 * adapter's pool: the single connection the API already holds. No prompt text is
 * accepted or stored, only the vector and the text length (ADR-2090).
 */

const TABLE = 'routing_labels';

const DDL = `CREATE TABLE IF NOT EXISTS ${TABLE} (
  id             text PRIMARY KEY,
  session_hash   text NOT NULL,
  turn_ts        timestamptz,
  embed_model    text NOT NULL,
  embedding      real[] NOT NULL,
  loaded         text[] NOT NULL,
  load_via       text[] NOT NULL,
  label          text NOT NULL,
  router_pick    text,
  router_model   text,
  router_cascade text,
  router_margin  double precision,
  prompt_chars   integer NOT NULL,
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  bm25_pick      text,
  bm25_score     double precision
)`;

/** EXP-B8: tables created before the shadow arm gain its two nullable columns. */
const MIGRATIONS = [
  `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS bm25_pick text`,
  `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS bm25_score double precision`,
];

class RoutingLabelInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RoutingLabelInputError';
    this.statusCode = 400;
  }
}

/**
 * The pool of the external-pg memory adapter, or null when the memory slot is
 * anything else (there is then nowhere to persist a label).
 * @param {object} adapters - `fastify.adapters`
 * @returns {object|null}
 */
function routingLabelPool(adapters) {
  const mem = adapters && adapters.memory;
  return mem && mem._implName === 'external-pg' && mem._pool ? mem._pool : null;
}

function validate(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new RoutingLabelInputError('rows must be a non-empty array');
  for (const r of rows) {
    if (!r || typeof r.id !== 'string' || !r.id) throw new RoutingLabelInputError('row.id is required');
    if (!Array.isArray(r.embedding) || !r.embedding.every((x) => typeof x === 'number')) {
      throw new RoutingLabelInputError('row.embedding must be an array of numbers');
    }
  }
}

/**
 * Create the table if needed and insert the rows, in one transaction. Inserts
 * are `ON CONFLICT DO NOTHING` on a content-addressed id, so a retried post is
 * idempotent and the recorder's watermark can stay put on any failure.
 *
 * @param {object} pool - a pg Pool (or anything with connect()/query())
 * @param {Array<object>} rows - as built by config/hooks/lib/routing-labels.cjs `rowFor`
 * @returns {Promise<{rows:number}>}
 * @throws {RoutingLabelInputError} on a malformed post; any database error as-is.
 */
async function persistRoutingLabels(pool, rows) {
  validate(rows);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(DDL);
    for (const m of MIGRATIONS) await client.query(m);
    for (const r of rows) {
      await client.query(
        `INSERT INTO ${TABLE} (id, session_hash, turn_ts, embed_model, embedding, loaded, load_via, label,
           router_pick, router_model, router_cascade, router_margin, prompt_chars, bm25_pick, bm25_score)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (id) DO NOTHING`,
        [r.id, r.session_hash, r.turn_ts, r.embed_model, r.embedding, r.loaded, r.load_via, r.label,
          r.router_pick, r.router_model, r.router_cascade, r.router_margin, r.prompt_chars, r.bm25_pick, r.bm25_score]);
    }
    await client.query('COMMIT');
    return { rows: rows.length };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* the original error matters */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { TABLE, DDL, MIGRATIONS, RoutingLabelInputError, routingLabelPool, persistRoutingLabels };
