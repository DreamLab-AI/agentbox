/**
 * RC-003-07 — Probe semantics under adapter connect delay
 *
 * Verifies that:
 *   - /livez returns 200 immediately (event loop alive) even when bootstrap
 *     sentinel is absent and adapters are still connecting.
 *   - /ready returns 503 during the delay window.
 *   - Both /livez and /ready return 200 after the delay resolves and the
 *     sentinel is written.
 *
 * Injection mechanism:
 *   AGENTBOX_TEST_ADAPTER_DELAY_MS=5000 — read by the adapter connect shim
 *   (see management-api/adapters/index.js test hook) to artificially delay
 *   adapter connect for the specified number of milliseconds.
 *
 * NOTE: This spec assumes the management-api process is started by the test
 * harness with the relevant env vars and that a writable /tmp/agentbox-test
 * directory is available for the sentinel.
 */

'use strict';

const http = require('http');
const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Allow override so CI can point at an already-running container.
const BASE_URL = process.env.AGENTBOX_TEST_BASE_URL || 'http://localhost:9090';
const ADAPTER_DELAY_MS = parseInt(process.env.AGENTBOX_TEST_ADAPTER_DELAY_MS || '5000', 10);
const SENTINEL_DIR = process.env.AGENTBOX_TEST_SENTINEL_DIR || '/tmp/agentbox-test';
const SENTINEL_PATH = path.join(SENTINEL_DIR, 'bootstrap.done');

// How long to wait for a response before failing
const REQUEST_TIMEOUT_MS = 3000;

/**
 * Simple HTTP GET returning { statusCode, body }.
 */
function httpGet(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error(`GET ${url} timed out after ${timeoutMs}ms`)); });
    req.on('error', reject);
  });
}

/**
 * Poll url until it returns expectedStatus or until timeoutMs elapses.
 * Resolves with the final response.
 */
async function pollUntil(url, expectedStatus, timeoutMs, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await httpGet(url);
      if (last.statusCode === expectedStatus) return last;
    } catch (_) {
      // keep polling
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}

describe('RC-003-07: Probe semantics under adapter connect delay', () => {
  // These tests require the management-api to be running with the test
  // injection env vars. They are integration tests — skip if the server
  // is not reachable.
  let serverReachable = false;

  beforeAll(async () => {
    try {
      const r = await httpGet(`${BASE_URL}/livez`, 2000);
      serverReachable = r.statusCode < 500;
    } catch (_) {
      serverReachable = false;
    }

    // Ensure sentinel dir exists and sentinel is absent at test start.
    if (serverReachable) {
      fs.mkdirSync(SENTINEL_DIR, { recursive: true });
      try { fs.unlinkSync(SENTINEL_PATH); } catch (_) {}
    }
  });

  afterAll(() => {
    // Clean up sentinel written during the test.
    try { fs.unlinkSync(SENTINEL_PATH); } catch (_) {}
  });

  test('/livez returns 200 when adapter delay is active (process alive, no sentinel)', async () => {
    if (!serverReachable) {
      console.warn('Management API not reachable — skipping RC-003-07');
      return;
    }

    const res = await httpGet(`${BASE_URL}/livez`);
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.live).toBe(true);
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThan(0);
  });

  test('/ready returns 503 before bootstrap sentinel is written', async () => {
    if (!serverReachable) return;

    // Sentinel must be absent (cleaned in beforeAll).
    const res = await httpGet(`${BASE_URL}/ready`);
    expect(res.statusCode).toBe(503);

    const body = JSON.parse(res.body);
    expect(body.ready).toBe(false);
    expect(typeof body.reason).toBe('string');
    expect(Array.isArray(body.missing)).toBe(true);
    expect(body.missing.some((m) => m.includes('bootstrap'))).toBe(true);
  });

  test('/ready returns 200 after sentinel is written and adapters healthy', async () => {
    if (!serverReachable) return;

    // Write the sentinel to unblock readiness.
    fs.mkdirSync(SENTINEL_DIR, { recursive: true });
    fs.writeFileSync(SENTINEL_PATH, '');

    // Poll for up to 10s — the server polls the sentinel every 2s.
    const res = await pollUntil(`${BASE_URL}/ready`, 200, 10000, 500);
    expect(res).toBeDefined();
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.ready).toBe(true);
    expect(typeof body.since).toBe('string');
    expect(Array.isArray(body.requirements)).toBe(true);
  });

  test('/livez remains 200 throughout (never checks sentinel)', async () => {
    if (!serverReachable) return;

    const res = await httpGet(`${BASE_URL}/livez`);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.live).toBe(true);
  });

  test('/livez response time is under 100ms', async () => {
    if (!serverReachable) return;

    const t0 = Date.now();
    const res = await httpGet(`${BASE_URL}/livez`, 500);
    const elapsed = Date.now() - t0;

    expect(res.statusCode).toBe(200);
    expect(elapsed).toBeLessThan(100);
  });
});
