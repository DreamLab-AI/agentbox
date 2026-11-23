// AB-04.15: management-api/adapters/lifecycle.js reads [adapters].connect_timeout_ms
// (a number, or a per-slot table with a `default` key) so the schema must accept it.
//   node --test tests/config/adapters-connect-timeout-schema.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.join(import.meta.dirname, '..', '..');
const schema = JSON.parse(fs.readFileSync(path.join(root, 'schema/agentbox.toml.schema.json'), 'utf8'));
const TOML = require('@iarna/toml');
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const { connectTimeoutFor, DEFAULT_CONNECT_TIMEOUT_MS } = require('../../management-api/adapters/lifecycle.js');

// Same Ajv class and options as scripts/agentbox-config-validate.js (2020-12, strict).
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);
const ok = (toml) => validate(TOML.parse(toml));

test('scalar connect_timeout_ms is accepted', () => {
  assert.equal(ok('[adapters]\nbeads = "off"\nconnect_timeout_ms = 2500\n'), true, JSON.stringify(validate.errors));
});

test('per-slot table with default is accepted', () => {
  assert.equal(
    ok('[adapters]\nbeads = "off"\n[adapters.connect_timeout_ms]\nmemory = 700\ndefault = 3000\n'),
    true, JSON.stringify(validate.errors));
});

test('non-positive, non-integer, string and unknown-slot values are rejected', () => {
  assert.equal(ok('[adapters]\nconnect_timeout_ms = 0\n'), false);
  assert.equal(ok('[adapters]\nconnect_timeout_ms = -5\n'), false);
  assert.equal(ok('[adapters]\nconnect_timeout_ms = "soon"\n'), false);
  assert.equal(ok('[adapters]\nconnect_timeout_ms = 1.5\n'), false);
  assert.equal(ok('[adapters.connect_timeout_ms]\nnope = 10\n'), false);
});

test('schema stays in step with what lifecycle.js resolves', () => {
  assert.equal(connectTimeoutFor('memory', { adapters: { connect_timeout_ms: 2500 } }), 2500);
  assert.equal(connectTimeoutFor('pods', { adapters: { connect_timeout_ms: { memory: 700, default: 3000 } } }), 3000);
  assert.equal(typeof DEFAULT_CONNECT_TIMEOUT_MS, 'number');
});
