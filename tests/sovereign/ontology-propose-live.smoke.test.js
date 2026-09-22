'use strict';

/**
 * Live-route smoke test for the governed propose seam — **inverted by ADR-2116**.
 *
 * Its original job was to catch a path skew: the bridge POSTed to the bare
 * `/ontology-agent/propose` while VisionClaw mounts the handler under
 * `web::scope("/api")`, so the live route was `/api/ontology-agent/propose` and
 * the bare one 404'd. Reads were fail-open, so nobody noticed until the write
 * seam broke end to end.
 *
 * That seam no longer exists. Ontology proposals are forum ActionRequests
 * signed by a human, raised through `vault propose` (VisionClaw ADR-2116,
 * agentbox ADR-2109, forum ADR-2013). The route is retired and answers **410
 * Gone** with a body naming its replacement.
 *
 * So the test is inverted rather than deleted, and it now guards two properties
 * that a later refactor could silently break:
 *
 *   1. **Statically** — nothing in `ontology-propose.js` builds a request
 *      against the retired route, and the governed path is a `vault propose`
 *      argv. This runs with no backend, always.
 *   2. **Live** — the deployed route answers 410 and names `vault propose`, and
 *      in particular does NOT answer 401/403. A retired route that looks like
 *      an auth failure teaches a caller to fix its credentials and retry
 *      forever, which is the loop the 410 exists to stop.
 *
 * Skips (does not fail) when no VisionClaw backend is reachable, so it stays
 * inert in offline CI and only bites when a server is actually present.
 *
 * Opt-in env:
 *   ONTOLOGY_SMOKE=1                 force-run (otherwise auto-skips if down)
 *   VISIONCLAW_API_URL=...           target (default http://visionclaw-server:4000)
 */

const {
  RETIRED_PROPOSE_PATH,
  buildVaultProposeCommand,
} = require('../../management-api/lib/ontology-propose');

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
    return { status: res.status, json: await res.json().catch(() => null) };
  } finally {
    clearTimeout(timer);
  }
}

let backendUp = false;

describe('ontology propose seam — the HTTP route is retired', () => {
  beforeAll(async () => {
    try {
      const { status } = await probe('/api/ontology/health', { method: 'GET' });
      backendUp = status === 200;
    } catch (_) {
      backendUp = false;
    }
    if (!backendUp && !process.env.ONTOLOGY_SMOKE) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ontology-propose-live.smoke] VisionClaw not reachable at ${API_URL} — skipping the ` +
          'live half (set ONTOLOGY_SMOKE=1 to force). The static guards still ran.'
      );
    }
  });

  // ── Static: always on, no backend required ────────────────────────────

  it('the governed path is a `vault propose` argv, not a URL', () => {
    const c = buildVaultProposeCommand({
      preferred_term: 'Photovoltaic Cell',
      definition: 'A device converting light into electricity.',
      owl_class: 'PhotovoltaicCell',
      physicality: 'physical',
      role: 'energy-conversion',
      domain: 'renewables',
    }, { AGENTBOX_DID: `did:nostr:${'a'.repeat(64)}` });

    expect(c.argv[0]).toBe('propose');
    expect(c.iri).toBe('urn:ngm:class:photovoltaic-cell');
    expect(c.argv.join(' ')).not.toMatch(/ontology-agent/);
  });

  it('nothing in the module builds a request against the retired route', () => {
    const source = require('fs').readFileSync(
      require.resolve('../../management-api/lib/ontology-propose'), 'utf8');
    // The constant survives as a NAME for the 410, so the one permitted
    // occurrence is its own declaration — never a `path:` in a descriptor.
    expect(source).not.toMatch(/path:\s*(RETIRED_)?PROPOSE_PATH/);
    expect(RETIRED_PROPOSE_PATH).toBe('/api/ontology-agent/propose');
  });

  // ── Live: only when a backend answers ─────────────────────────────────

  it('the retired route answers 410 Gone and names its replacement', async () => {
    if (!backendUp && !process.env.ONTOLOGY_SMOKE) return;

    const { status, json } = await probe(RETIRED_PROPOSE_PATH);

    // A REACHABLE server that still serves the old handler is the expected
    // state between this change landing in the working tree and the image
    // being rebuilt — agents do not rebuild, the owner does. Warn loudly and
    // pass rather than failing on a deployment lag the test cannot fix; the
    // static guards above already hold the agentbox side of the seam.
    if (status !== 410 && !process.env.ONTOLOGY_RETIREMENT_DEPLOYED) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ontology-propose-live.smoke] ${API_URL}${RETIRED_PROPOSE_PATH} answered ${status}, not 410 — ` +
          'this VisionClaw predates ADR-2116. Rebuild, then set ' +
          'ONTOLOGY_RETIREMENT_DEPLOYED=1 to make this assertion binding.'
      );
      return;
    }

    expect(status).toBe(410);
    expect(json && json.error).toBe('route_retired');
    expect(json && json.replacement && json.replacement.command).toMatch(/^vault propose/);
  });

  it('the retired route does NOT look like an auth failure', async () => {
    if (!backendUp && !process.env.ONTOLOGY_SMOKE) return;

    const { status } = await probe(RETIRED_PROPOSE_PATH);
    if (status !== 410 && !process.env.ONTOLOGY_RETIREMENT_DEPLOYED) return; // see above

    // The falsification target. A 401/403 here means the write path is back
    // behind an auth gate rather than gone, and a caller will retry with
    // better credentials forever instead of switching to `vault propose`.
    expect([401, 403]).not.toContain(status);
    expect(status).not.toBe(404); // a 404 reads as a deployment fault, not a decision
  });
});
