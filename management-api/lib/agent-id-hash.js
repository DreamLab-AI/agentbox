'use strict';

/**
 * Deterministic string -> non-negative 32-bit id for the binary agent-action
 * protocol. The single mapping every agent-event path uses (`/emit`, `/batch`,
 * and the `/hook` emitter), so one name or one task id yields the same numeric
 * identity regardless of which path reported it and of process start order.
 *
 * @param {string} str
 * @returns {number}
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

module.exports = { hashString };
