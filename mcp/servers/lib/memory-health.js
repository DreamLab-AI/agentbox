'use strict';
/**
 * memory-health.js — read-only diagnostics wrapper (PRD-018 D4, gate
 * RUVECTOR_HEALTH_TOOL). Surfaces the sidecar's own health signal as a
 * first-class MCP tool over four verified extension functions:
 *   ruvector_is_healthy()      -> boolean
 *   ruvector_health_status()   -> jsonb  (enabled/healthy/metrics/problems)
 *   ruvector_system_metrics()  -> jsonb
 *   ruvector_simd_info()       -> text   ("architecture: …, active: avx512, …")
 *
 * READ-ONLY and fail-open: any error returns { success:false } without touching
 * state. No auto-execute self-healing is exposed (ADR-036 D4: irreversible
 * strategies stay manual).
 */

function createHealthTools(deps) {
  const { pool, getPgOk, log } = deps;

  async function memHealth() {
    if (!getPgOk() || !pool) return { success: false, action: 'health', error: 'pg unavailable' };
    try {
      const res = await pool.query(
        `SELECT ruvector_is_healthy()     AS is_healthy,
                ruvector_health_status()   AS health_status,
                ruvector_system_metrics()  AS system_metrics,
                ruvector_simd_info()       AS simd_info`
      );
      const row = res.rows[0] || {};
      return {
        success: true,
        action: 'health',
        healthy: row.is_healthy === true,
        health_status: row.health_status || null,
        system_metrics: row.system_metrics || null,
        simd_info: row.simd_info || null,
        storage: 'ruvector-postgres',
        checked_at: new Date().toISOString(),
      };
    } catch (err) {
      log('WARN', `health check failed: ${err.message}`);
      return { success: false, action: 'health', error: err.message };
    }
  }

  return { memHealth };
}

module.exports = { createHealthTools };
