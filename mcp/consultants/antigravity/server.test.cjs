'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Exercise the real consultant without starting MCP or an authenticated CLI.
function load(env = {}) {
  const calls = [];
  let options;
  const context = vm.createContext({
    process: { env, stderr: { write() {} }, exit() { throw new Error('unexpected exit'); } },
    require(name) {
      if (name === '../shared/consultant-base') {
        return { BaseConsultant: class {
          constructor(value) { options = value; }
          async start() {}
        } };
      }
      if (name === '../shared/spawn-cli') {
        return { spawnCli: async (args) => {
          calls.push(args);
          return { code: 0, stdout: 'answer', stderr: '' };
        } };
      }
      throw new Error(`unexpected import ${name}`);
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8'), context);
  return { options, calls, context };
}

test('default and explicit override reach the actual CLI argv', async () => {
  for (const model of [undefined, 'gemini-3.5-flash']) {
    const { options, calls } = load(model ? { AGENTBOX_ANTIGRAVITY_MODEL: model } : {});
    const expected = model || 'gemini-3.8-flash';
    assert.equal(options.model, expected);
    const result = await options.callConsult({ question: 'hello' });
    assert.equal(calls[0].args[1], expected);
    assert.equal(result.model, expected);
    assert.equal(result.response, 'answer');
    if (model) {
      assert.equal(result.cost_usd, null);
      await assert.rejects(options.estimateCost({ question_size: 100, expected_response_size: 100 }), /No published tariff/);
    }
  }
});

test('published introductory tariff expires at the UTC year boundary', () => {
  const { context } = load();
  assert.equal(vm.runInContext("rates(new Date('2026-12-31T23:59:59Z')).prompt", context), 0.00075);
  assert.equal(vm.runInContext("rates(new Date('2027-01-01T00:00:00Z')).prompt", context), 0.0015);
  assert.equal(vm.runInContext("rates(new Date('2027-01-01T00:00:00Z')).completion", context), 0.0075);
});
