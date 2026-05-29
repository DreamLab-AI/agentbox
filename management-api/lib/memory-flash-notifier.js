'use strict';

/**
 * memory-flash-notifier — fire-and-forget RuVector-access → VisionClaw beacon.
 *
 * Every RuVector memory operation (store / retrieve / search / delete) emits a
 * privacy-safe beacon to VisionClaw's `POST /api/memory-flash` route, which
 * broadcasts a `memory_flash` WebSocket frame to every connected client. The
 * client's EmbeddingCloudLayer animates a burst ring at the embedding-cloud
 * point matching the entry key (or, on a miss, the namespace cluster) — the
 * visible "spark" that fires when memory is touched (PRD-014 Seam C).
 *
 * The render chain (client EmbeddingCloudLayer → textMessageHandler `memoryFlash`
 * event → VisionClaw memory_flash_handler.rs → ClientCoordinator broadcast) was
 * already complete on both sides; this module is the missing producer call.
 *
 * Invariants:
 *   - Privacy (ADR-008): only the entry KEY, the logical NAMESPACE, and the
 *     action verb ever leave the process. The stored VALUE never does. The
 *     `user:<pubkey>:` scoping prefix is stripped so the visual groups by the
 *     logical namespace, not the per-user shard.
 *   - Fail-open: a disabled, failed, or slow beacon never affects — and never
 *     delays — the memory operation. All calls are fire-and-forget; errors are
 *     swallowed; a hung POST is aborted after VISIONCLAW_MEMORY_FLASH_TIMEOUT_MS.
 *   - Disabled by default: no beacon is sent unless VISIONCLAW_API_URL (or
 *     VISIONCLAW_MEMORY_FLASH_URL) is set. Set VISIONCLAW_MEMORY_FLASH=off to
 *     force-disable even when a URL is present.
 */

const RAW_BASE = process.env.VISIONCLAW_MEMORY_FLASH_URL
  || process.env.VISIONCLAW_API_URL
  || '';
const FLASH_BASE = RAW_BASE.replace(/\/+$/, '');
const DISABLED = String(process.env.VISIONCLAW_MEMORY_FLASH || '').toLowerCase() === 'off';
const TIMEOUT_MS = Number(process.env.VISIONCLAW_MEMORY_FLASH_TIMEOUT_MS) || 1500;

const ENABLED = !DISABLED && FLASH_BASE.length > 0 && typeof fetch === 'function';

/** Strip the `user:<pubkey>:` access-control prefix → logical namespace. */
function logicalNamespace(namespace) {
  return String(namespace || 'default').replace(/^user:[0-9a-fA-F]{1,64}:/, '');
}

function postFlash(path, payload) {
  let controller = null;
  let timer = null;
  try {
    controller = new AbortController();
    timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  } catch {
    controller = null;
  }
  Promise.resolve()
    .then(() => fetch(`${FLASH_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      ...(controller ? { signal: controller.signal } : {}),
    }))
    .catch(() => { /* fail-open: best-effort beacon, never blocks memory ops */ })
    .finally(() => { if (timer) clearTimeout(timer); });
}

/**
 * Emit a single memory-access beacon. Fire-and-forget; returns immediately.
 * @param {{ key: string, namespace?: string, action?: string }} flash
 */
function notifyMemoryFlash(flash) {
  if (!ENABLED) return;
  const key = flash && flash.key;
  if (!key) return;
  postFlash('/api/memory-flash', {
    key: String(key),
    namespace: logicalNamespace(flash.namespace),
    action: flash.action || 'access',
  });
}

/**
 * Emit several beacons in one request via the batch route — used by search,
 * where each matched entry key lights its own embedding-cloud point.
 * @param {Array<{ key: string, namespace?: string, action?: string }>} flashes
 */
function notifyMemoryFlashBatch(flashes) {
  if (!ENABLED || !Array.isArray(flashes)) return;
  const events = flashes
    .filter((f) => f && f.key)
    .map((f) => ({
      key: String(f.key),
      namespace: logicalNamespace(f.namespace),
      action: f.action || 'access',
    }));
  if (events.length === 0) return;
  if (events.length === 1) {
    postFlash('/api/memory-flash', events[0]);
    return;
  }
  postFlash('/api/memory-flash/batch', { events });
}

module.exports = {
  notifyMemoryFlash,
  notifyMemoryFlashBatch,
  // exposed for tests / introspection
  _isEnabled: () => ENABLED,
  _logicalNamespace: logicalNamespace,
};
