'use strict';

/**
 * Live-route smoke test for the governed propose seam (gap doc §2.6-(3)).
 *
 * The federation boundary rotted silently once already: the bridge POSTed to
 * the bare `/ontology-agent/propose` while VisionClaw mounts the handler under
 * `web::scope("/api")`, so the live route is `/api/ontology-agent/propose`. The
 * bare path 404s. Reads are fail-open so nobody noticed; the write seam only
 * breaks end-to-end, which no offline unit test exercises.
 *
 * This test POSTs the *actual* `PROPOSE_PATH` constant the bridge uses against
 * the live server and asserts the route EXISTS (non-404). It does NOT assert a
 * successful proposal — an anonymous/empty POST is expected to be rejected by
 * the auth gate (403) or the body validator (400/422). Any of those proves the
 * route resolved; a 404 proves the path skew is back.
 *
 * Skips (does not fail) when no VisionClaw backend is reachable, so it is inert
 * in offline CI and only bites when a server is actually present.
 *
 * Opt-in env:
 *   ONTOLOGY_SMOKE=1                 force-run (otherwise auto-skips if down)
 *   VISIONCLAW_API_URL=...           target (default http://visionclaw-server:4000)
 */

const { PROPOSE_PATH } = require('../../mcp/servers/ontology-propose');

const API_URL = (process.env.VISIONCLAW_API_URL || 'http://visionclaw-server:4000').replace(/\/$/, '');
const PROBE_TIMEOUT_MS = parseInt(process.env.ONTOLOGY_SMOKE_TIMEOUT_MS || '3000', 10);

async function probe(path, { method = 'POST', body = '{}' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : body,
      signal: controller.signal,
    });
    return res.status;
  } finally {
    clearTimeout(timer);
  }
}

let backendUp = false;

describe('ontology propose seam — live route', () => {
  beforeAll(async () => {
    try {
      const code = await probe('/api/ontology/health', { method: 'GET' });
      backendUp = code === 200;
    } catch (_) {
      backendUp = false;
    }
    if (!backendUp && !process.env.ONTOLOGY_SMOKE) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ontology-propose-live.smoke] VisionClaw not reachable at ${API_URL} — skipping ` +
          '(set ONTOLOGY_SMOKE=1 to force).'
      );
    }
  });

  it('PROPOSE_PATH carries the /api prefix the live server mounts', () => {
    // Cheap, always-on guard: catches a constant revert even with no backend.
    expect(PROPOSE_PATH).toBe('/api/ontology-agent/propose');
  });

  it('the constant the bridge POSTs to resolves to a real route (non-404)', async () => {
    if (!backendUp && !process.env.ONTOLOGY_SMOKE) {
      return; // inert offline; the static guard above still ran
    }
    const status = await probe(PROPOSE_PATH);
    // 401/403 = auth gate; 400/422 = body validator; 200 = accepted. All prove
    // the route exists. 404 = the path skew regressed.
    expect(status).not.toBe(404);
    expect([200, 400, 401, 403, 422]).toContain(status);
  });

  it('the bare /ontology-agent/propose (no /api) is genuinely a 404', async () => {
    if (!backendUp && !process.env.ONTOLOGY_SMOKE) {
      return;
    }
    // Confirms the skew is real and the /api prefix is load-bearing, not cosmetic.
    const status = await probe('/ontology-agent/propose');
    expect(status).toBe(404);
  });
});
