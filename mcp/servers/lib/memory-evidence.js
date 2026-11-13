'use strict';
/**
 * memory-evidence.js — evidence references on memory_store (ADR-2201 clauses 1
 * and 7, gate RUVECTOR_EVIDENCE_REFS).
 *
 * An entry may record what it was written from. A reference is one of
 *
 *   { kind: 'memory', namespace, key [, event_time] }   another memory entry
 *   { kind: 'step',   id         [, event_time] }       a trajectory_steps row
 *
 * References are structured, not a `<namespace>/<key>` string, because both
 * namespaces (`knowledge/pages`, `hooks:post-edit`) and keys contain the
 * characters a string form would split on.
 *
 * They are stored in `metadata.evidence` beside `metadata.evidence_state`
 * ('complete' when every reference resolved at write time, 'partial' once one
 * has been withdrawn). Metadata is not embedded, so none of this changes what a
 * query returns.
 *
 * Scope (ADR-2201 clauses 3 and 4): references are readable only inside the
 * container. They are a reading aid, not an attestation: the trajectory
 * recorder is a hook the writer can reach. Nothing here may be copied onto a
 * surface that leaves the container.
 */

const { notExpiredPredicate } = require('./memory-metadata');

const MAX_EVIDENCE_REFS = 32;
const MAX_FIELD_CHARS = 512;

function refIdentity(ref) {
  return ref.kind === 'memory' ? `memory\u0000${ref.namespace}\u0000${ref.key}` : `step\u0000${ref.id}`;
}

function cleanString(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_FIELD_CHARS ? v : null;
}

/**
 * Validate and normalise caller-supplied evidence. Pure.
 *
 * @param {unknown} input the `evidence` option as supplied
 * @param {{namespace?: string, key?: string}} self the entry being written (a self-citation is refused)
 * @returns {{ok: true, evidence: object[]} | {ok: false, error: string}}
 */
function normaliseEvidence(input, self = {}) {
  if (input === undefined || input === null) return { ok: true, evidence: [] };
  if (!Array.isArray(input)) return { ok: false, error: 'evidence must be an array of references' };
  if (input.length > MAX_EVIDENCE_REFS) return { ok: false, error: `evidence holds ${input.length} references; the limit is ${MAX_EVIDENCE_REFS}` };

  const seen = new Set();
  const evidence = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: `evidence[${i}] is not an object` };
    let ref;
    if (raw.kind === 'memory') {
      const namespace = cleanString(raw.namespace);
      const key = cleanString(raw.key);
      if (!namespace || !key) return { ok: false, error: `evidence[${i}]: a memory reference needs namespace and key` };
      if (namespace === self.namespace && key === self.key) return { ok: false, error: `evidence[${i}]: an entry cannot cite itself` };
      ref = { kind: 'memory', namespace, key };
    } else if (raw.kind === 'step') {
      const id = cleanString(raw.id);
      if (!id) return { ok: false, error: `evidence[${i}]: a step reference needs id` };
      ref = { kind: 'step', id };
    } else {
      // 'withdrawn' is written only by the store, never accepted from a caller.
      return { ok: false, error: `evidence[${i}]: kind must be "memory" or "step"` };
    }
    if (raw.event_time !== undefined && raw.event_time !== null) {
      const t = typeof raw.event_time === 'string' ? Date.parse(raw.event_time) : NaN;
      if (!Number.isFinite(t)) return { ok: false, error: `evidence[${i}]: event_time is not a date` };
      ref.event_time = new Date(t).toISOString();
    }
    const id = refIdentity(ref);
    if (seen.has(id)) continue;
    seen.add(id);
    evidence.push(ref);
  }
  return { ok: true, evidence };
}

/**
 * Resolve references against the store. A reference to an expired entry does
 * not resolve. Any failure to check (for instance no trajectory_steps table)
 * leaves those references unresolved: the caller rejects the write.
 *
 * @returns {Promise<object[]>} the references that did NOT resolve
 */
async function findUnresolved(pool, evidence, log = () => {}) {
  const memory = evidence.filter((r) => r.kind === 'memory');
  const steps = evidence.filter((r) => r.kind === 'step');
  const unresolved = [];

  if (memory.length) {
    let found = new Set();
    try {
      const res = await pool.query(
        `SELECT m.namespace, m.key
           FROM memory_entries m
           JOIN unnest($1::text[], $2::text[]) AS want(namespace, key)
             ON m.namespace = want.namespace AND m.key = want.key
          WHERE ${notExpiredPredicate('m.metadata')}`,
        [memory.map((r) => r.namespace), memory.map((r) => r.key)],
      );
      found = new Set(res.rows.map((r) => `${r.namespace}\u0000${r.key}`));
    } catch (e) {
      log('WARN', `evidence resolution failed for memory references: ${e.message}`);
    }
    for (const r of memory) if (!found.has(`${r.namespace}\u0000${r.key}`)) unresolved.push(r);
  }

  if (steps.length) {
    let found = new Set();
    try {
      const res = await pool.query(`SELECT id FROM trajectory_steps WHERE id = ANY($1::text[])`, [steps.map((r) => r.id)]);
      found = new Set(res.rows.map((r) => r.id));
    } catch (e) {
      log('WARN', `evidence resolution failed for step references: ${e.message}`);
    }
    for (const r of steps) if (!found.has(r.id)) unresolved.push(r);
  }

  return unresolved;
}

// The marker that replaces a withdrawn reference. It keeps the time and
// nothing else: the namespace and key of a deleted entry are themselves part
// of what was deleted.
const WITHDRAWN_MARKER = (timeParam) => `jsonb_build_object('kind', 'withdrawn', 'withdrawn_at', ${timeParam}::text)`;

// The evidence array of row `m`, or an empty array when it is not one.
const EVIDENCE_OF_M = `CASE WHEN jsonb_typeof(m.metadata->'evidence') = 'array' THEN m.metadata->'evidence' ELSE '[]'::jsonb END`;

/**
 * One statement that deletes entries and withdraws every reference to the
 * named entry (ADR-2201 clause 7). It is used whatever the gate says:
 * references written while the gate was on must still be withdrawn after it
 * is switched off.
 *
 * Parameters: $1 namespace, $2 key, $3 withdrawal time (ISO), $4 the jsonb
 * containment probe (withdrawProbe), then whatever `where` uses from $5 on.
 * The new array is computed from the row being updated, so a concurrent
 * rewrite of the citing entry is not overwritten with a stale copy.
 *
 * @param {string} where the DELETE predicate, e.g. `id = $5`
 */
function deleteAndWithdrawSql(where) {
  return `
  WITH del AS (
    DELETE FROM memory_entries WHERE ${where} RETURNING id
  ),
  upd AS (
    UPDATE memory_entries m
       SET metadata = m.metadata || jsonb_build_object(
             'evidence', (
               SELECT jsonb_agg(
                        CASE WHEN e->>'kind' = 'memory' AND e->>'namespace' = $1 AND e->>'key' = $2
                             THEN ${WITHDRAWN_MARKER('$3')}
                             ELSE e END
                        ORDER BY ord)
                 FROM jsonb_array_elements(${EVIDENCE_OF_M}) WITH ORDINALITY AS x(e, ord)),
             'evidence_state', 'partial')
     WHERE m.metadata @> $4::jsonb
       AND m.id NOT IN (SELECT id FROM del)
       AND EXISTS (SELECT 1 FROM del)
     RETURNING m.id
  )
  SELECT (SELECT count(*) FROM del)::int AS deleted, (SELECT count(*) FROM upd)::int AS withdrawn`;
}

function withdrawProbe(namespace, key) {
  return JSON.stringify({ evidence: [{ kind: 'memory', namespace, key }] });
}

// True for an evidence element `e` whose source no longer exists.
function deadPredicate(hasSteps) {
  const memoryGone = `(e->>'kind' = 'memory' AND NOT EXISTS (
        SELECT 1 FROM memory_entries s
         WHERE s.namespace = e->>'namespace' AND s.key = e->>'key'
           AND ${notExpiredPredicate('s.metadata')}))`;
  const stepGone = `(e->>'kind' = 'step' AND NOT EXISTS (
        SELECT 1 FROM trajectory_steps t WHERE t.id = e->>'id'))`;
  return hasSteps ? `(${memoryGone} OR ${stepGone})` : memoryGone;
}

/**
 * Withdraw every reference whose source no longer exists, whatever removed it
 * (the TTL sweep, a bulk ingest's delete, a pruned trajectory step).
 * Parameter: $1 withdrawal time. Candidates are found through
 * `evidence_state`, which the metadata GIN serves. As in the delete
 * statement, the new array is computed from the row being updated.
 *
 * @param {boolean} hasSteps whether the trajectory_steps table exists; without
 *   it step references cannot be checked and are left as they are.
 */
function reconcileSql(hasSteps) {
  const dead = deadPredicate(hasSteps);
  return `
  UPDATE memory_entries m
     SET metadata = m.metadata || jsonb_build_object(
           'evidence', (
             SELECT jsonb_agg(CASE WHEN ${dead} THEN ${WITHDRAWN_MARKER('$1')} ELSE e END ORDER BY ord)
               FROM jsonb_array_elements(${EVIDENCE_OF_M}) WITH ORDINALITY AS x(e, ord)),
           'evidence_state', 'partial')
   WHERE (m.metadata @> '{"evidence_state":"complete"}'::jsonb OR m.metadata @> '{"evidence_state":"partial"}'::jsonb)
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(${EVIDENCE_OF_M}) AS y(e) WHERE ${dead})`;
}

/**
 * Run the reconcile. Returns the number of entries that had a reference
 * withdrawn.
 */
async function reconcile(pool, nowIso = new Date().toISOString()) {
  const probe = await pool.query(`SELECT to_regclass('trajectory_steps')::text AS t`);
  const hasSteps = !!(probe.rows && probe.rows[0] && probe.rows[0].t);
  const res = await pool.query(reconcileSql(hasSteps), [nowIso]);
  return res.rowCount || 0;
}

module.exports = {
  MAX_EVIDENCE_REFS,
  normaliseEvidence,
  findUnresolved,
  withdrawProbe,
  deleteAndWithdrawSql,
  reconcileSql,
  reconcile,
};
