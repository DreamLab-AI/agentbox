'use strict';

/**
 * lib/trajectory-store — the one place trajectory rows are written (ADR-2164,
 * amending ADR-2015).
 *
 * The trajectory recorder (config/hooks/trajectory-recorder.cjs) used to open
 * its own Postgres connection, which meant a task needed database credentials.
 * It now posts the rows it has already computed to
 * `POST /v1/agent-events/trajectory`, and this module runs the same
 * parameterised SQL through the memory adapter's pool — the single conninfo the
 * API already holds. Nothing here decides row content: ids, step order,
 * result JSON and the cumulative rollup all arrive fully formed from the
 * recorder, which owns the stash they derive from.
 *
 * Tables: `trajectories` (one row per session) and `trajectory_steps` (one row
 * per graded Bash call). Every insert is `ON CONFLICT DO NOTHING` on a
 * content-addressed id, so a retried post is idempotent; the rollup is an
 * idempotent UPDATE of the same row.
 */

class TrajectoryInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TrajectoryInputError';
    this.statusCode = 400;
  }
}

/** A task token wrote to a trajectory another task, or the operator, owns. */
class TrajectoryForbiddenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TrajectoryForbiddenError';
    this.statusCode = 403;
  }
}

/**
 * The pool of the external-pg memory adapter, or null when the memory slot is
 * anything else (there is then nowhere to persist a trajectory).
 * @param {object} adapters - `fastify.adapters`
 * @returns {object|null}
 */
function trajectoryPool(adapters) {
  const mem = adapters && adapters.memory;
  return mem && mem._implName === 'external-pg' && mem._pool ? mem._pool : null;
}

// Whether trajectory_steps has a duration_ms column, per pool. Only a definite
// answer is cached: a lookup that threw must not pin "no column" forever.
const durationColumnByPool = new WeakMap();
async function hasDurationColumn(pool) {
  if (durationColumnByPool.has(pool)) return durationColumnByPool.get(pool);
  try {
    const res = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'trajectory_steps' AND column_name = 'duration_ms' LIMIT 1`
    );
    const has = res.rowCount > 0;
    durationColumnByPool.set(pool, has);
    return has;
  } catch {
    return false;
  }
}

/**
 * A step id is `<trajectory id>:step-<hash>`; refuse a step that names another
 * trajectory so one post can only ever touch the trajectory it declares.
 * @param {object} p - the posted body
 * @throws {TrajectoryInputError}
 */
function validate(p) {
  const traj = p && p.trajectory;
  if (!traj || typeof traj.id !== 'string' || !traj.id) throw new TrajectoryInputError('trajectory.id is required');
  if (!Array.isArray(p.steps)) throw new TrajectoryInputError('steps must be an array');
  if (!p.rollup || typeof p.rollup !== 'object') throw new TrajectoryInputError('rollup is required');
  const prefix = `${traj.id}:step-`;
  for (const s of p.steps) {
    if (!s || typeof s.id !== 'string' || !s.id.startsWith(prefix)) {
      throw new TrajectoryInputError(`step id must start with '${prefix}'`);
    }
  }
}

/**
 * Persist one trajectory post: the session row, its new steps, and the
 * cumulative rollup, in a single transaction (a failure writes nothing, so the
 * recorder's watermark can safely stay put).
 *
 * Ownership (B1): a trajectory id derives from the session, which the server
 * never learns, so ownership is recorded at creation as `metadata.task_id`.
 * With a `taskId` (a task-token post) the row is stamped with it, the owner is
 * re-read under a row lock, and a trajectory owned by another task, or by the
 * operator (no task_id), is refused before any step or rollup is written.
 * Without a `taskId` (operator credentials) behaviour is unchanged.
 *
 * @param {object} pool - a pg Pool (or anything with connect()/query())
 * @param {object} p
 * @param {{id:string, task:string, agent:string, metadata:object}} p.trajectory
 * @param {Array<{id:string, action:string, result:object, quality:number,
 *   step_order:number, duration_ms:(number|null)}>} p.steps
 * @param {{success:boolean, step_count:number, mean_quality:number,
 *   outcome:string, handoff_id:(string|null), handoff_count:number,
 *   ctc_emit_queued:number, ctc_emit_carried_in:number}} p.rollup
 * @param {string|null} [taskId] - the token's task id; null/absent for the operator.
 * @returns {Promise<{steps:number}>}
 * @throws {TrajectoryInputError} on a malformed post.
 * @throws {TrajectoryForbiddenError} when a token writes a trajectory it does not own.
 * Any database error is rethrown as-is.
 */
async function persistTrajectory(pool, p, taskId = null) {
  validate(p);
  const hasDur = await hasDurationColumn(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. one trajectory row per session (idempotent). A token post stamps the
    //    owner over whatever metadata it sent: the caller never chooses it.
    const metadata = taskId ? { ...(p.trajectory.metadata || {}), task_id: taskId } : (p.trajectory.metadata || {});
    await client.query(
      `INSERT INTO trajectories (id, task, agent, status, started_at, metadata)
         VALUES ($1, $2, $3, 'recording', CURRENT_TIMESTAMP, $4::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [p.trajectory.id, p.trajectory.task, p.trajectory.agent, JSON.stringify(metadata)]
    );

    if (taskId) {
      // The INSERT above is a no-op on an existing row, so the owner on file is
      // the creator's. Lock the row so a concurrent post cannot slip past.
      const own = await client.query(
        'SELECT metadata->>\'task_id\' AS task_id FROM trajectories WHERE id = $1 FOR UPDATE',
        [p.trajectory.id]
      );
      const owner = own.rows && own.rows[0] ? own.rows[0].task_id : null;
      if (owner !== taskId) {
        throw new TrajectoryForbiddenError('trajectory is owned by another task or by the operator');
      }
    }

    // 2. one step row per graded Bash call (idempotent by content-addressed id).
    for (const s of p.steps) {
      const durationMs = s.duration_ms == null ? null : s.duration_ms;
      if (hasDur) {
        await client.query(
          `INSERT INTO trajectory_steps
             (id, trajectory_id, action, result, quality, step_order, duration_ms)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO NOTHING`,
          [s.id, p.trajectory.id, s.action, JSON.stringify(s.result || {}), s.quality, s.step_order, durationMs]
        );
      } else {
        // No column: the duration rides in the result JSON, as it always has.
        const result = durationMs != null ? { ...(s.result || {}), duration_ms: durationMs } : (s.result || {});
        await client.query(
          `INSERT INTO trajectory_steps
             (id, trajectory_id, action, result, quality, step_order)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO NOTHING`,
          [s.id, p.trajectory.id, s.action, JSON.stringify(result), s.quality, s.step_order]
        );
      }
    }

    // 3. roll the trajectory up to its current cumulative outcome (idempotent).
    const r = p.rollup;
    await client.query(
      `UPDATE trajectories
          SET ended_at = CURRENT_TIMESTAMP,
              status   = 'complete',
              success  = $2,
              metadata = COALESCE(metadata, '{}'::jsonb)
                         || jsonb_build_object(
                              'ended_at_iso',  to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'),
                              'step_count',    $3::int,
                              'mean_quality',  $4::double precision,
                              'outcome',       $5::text,
                              'handoff_id',    $6::text,
                              'handoff_count', $7::int,
                              'ctc_emit_queued',   $8::int,
                              'ctc_emit_carried_in', $9::int)
        WHERE id = $1`,
      [p.trajectory.id, !!r.success, r.step_count, r.mean_quality, r.outcome,
        r.handoff_id == null ? null : r.handoff_id, r.handoff_count, r.ctc_emit_queued, r.ctc_emit_carried_in]
    );

    await client.query('COMMIT');
    return { steps: p.steps.length };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* the original error matters */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { persistTrajectory, trajectoryPool, TrajectoryInputError, TrajectoryForbiddenError };
