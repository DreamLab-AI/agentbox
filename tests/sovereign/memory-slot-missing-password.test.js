'use strict';

/**
 * G2: an unusable ruvector password file fails the MEMORY SLOT closed, not the
 * whole management-api. resolveAdapters used to throw out of start(), whose
 * catch ends in process.exit(1). Now the slot is built as a failed adapter, the
 * lifecycle withdraws it (state `disabled`, dispatch gets AdapterDisabled), the
 * API stays up, and /health names the slot and the file path.
 *
 * Not an ADR-015 hard-exit requirement: ADR-015 (amended 2026-07-04, see
 * docs/LEARNING-memory.md) says the ruvector MCP server fails closed with no
 * sql.js fallback; it does not say the management API must exit. Writes still
 * fail closed: dispatch into the withdrawn slot throws.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveAdapters, SLOTS } = require('../../management-api/adapters/index');
const { connectAdapters, toLegacyHealth, failureReasons, failureFiles } = require('../../management-api/adapters/lifecycle');

const MISSING = path.join(os.tmpdir(), `sb-no-such-dir-${process.pid}`, 'password');
const manifest = () => ({
  adapters: { memory: 'external-pg' },
  integrations: { ruvector_external: { conninfo: 'postgresql://ruvector@ruvector-postgres:5432/ruvector' } },
});
let prev;
beforeEach(() => { prev = process.env.RUVECTOR_PG_PASSWORD_FILE; process.env.RUVECTOR_PG_PASSWORD_FILE = MISSING; });
afterEach(() => {
  if (prev === undefined) delete process.env.RUVECTOR_PG_PASSWORD_FILE; else process.env.RUVECTOR_PG_PASSWORD_FILE = prev;
});

const resolveOff = (slot) => resolveAdapters({ adapters: { [slot]: 'off' } })[slot];

test('resolveAdapters does not throw when the password file is missing', () => {
  let adapters;
  expect(() => { adapters = resolveAdapters(manifest()); }).not.toThrow();
  expect(adapters.memory._implName).toBe('external-pg');
  for (const slot of SLOTS) expect(adapters[slot]).toBeTruthy();
});

test('the memory slot is withdrawn, the others are untouched, and the reason names the file', async () => {
  const adapters = resolveAdapters(manifest());
  const { readiness } = await connectAdapters({ slots: SLOTS, adapters, manifest: manifest(), resolveOff });
  expect(readiness.memory.state).toBe('disabled');
  expect(readiness.memory.reason).toContain(MISSING);
  expect(toLegacyHealth(readiness).memory).toBe('degraded');
  for (const slot of SLOTS.filter((s) => s !== 'memory')) expect(['off', 'ready']).toContain(readiness[slot].state);
  await expect(adapters.memory.retrieve('k')).rejects.toThrow(/disabled/i); // fail closed
});

test('failureReasons (what /health publishes) is a fixed class, never error text; the file is a separate field', async () => {
  const adapters = resolveAdapters(manifest());
  const { readiness } = await connectAdapters({ slots: SLOTS, adapters, manifest: manifest(), resolveOff });
  expect(failureReasons(readiness)).toEqual({ memory: 'config-failed' });
  expect(failureFiles(readiness)).toEqual({ memory: MISSING });
  expect(JSON.stringify(failureReasons(readiness))).not.toContain('password unavailable');
  // the full reason stays on the internal record (and in the server log), not on /health
  expect(readiness.memory.reason).toContain(MISSING);
});

test('connect failures publish a fixed class only: no error text reaches /health', async () => {
  const leaky = 'getaddrinfo ENOTFOUND db.internal.example password authentication failed for "u" token=abc123';
  const adapters = { memory: { _implName: 'x', async connect() { throw new Error(leaky); } }, beads: { _implName: 'x', connect: () => new Promise(() => {}) } };
  const { readiness } = await connectAdapters({ slots: ['memory', 'beads'], adapters, manifest: { adapters: { connect_timeout_ms: 20 } }, resolveOff });
  const pub = failureReasons(readiness);
  expect(pub).toEqual({ memory: 'connect-failed', beads: 'connect-timeout' });
  expect(JSON.stringify(pub)).not.toMatch(/abc123|internal\.example|authentication/);
  expect(failureFiles(readiness)).toEqual({});
});

test('a readable password file still builds a normal external-pg slot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-pw-'));
  const f = path.join(dir, 'password');
  fs.writeFileSync(f, 'sentinel-pass\n', { mode: 0o600 });
  process.env.RUVECTOR_PG_PASSWORD_FILE = f;
  const adapters = resolveAdapters(manifest());
  expect(adapters.memory._implName).toBe('external-pg');
  expect(adapters.memory._pool).toBeTruthy();
  fs.rmSync(dir, { recursive: true, force: true });
  return adapters.memory._pool.end && adapters.memory._pool.end();
});

test('server.js publishes failureReasons on /health (schema keeps the field)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../management-api/server.js'), 'utf8');
  expect(src).toMatch(/failureReasons\(app\.adapterReadiness/);
  expect(src).toMatch(/adapter_failures:\s*\{\s*type:\s*'object'/);
  expect(src).toMatch(/adapter_failure_files:\s*failureFiles\(app\.adapterReadiness/);
});
