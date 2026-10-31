const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv/dist/2020');
const root = path.resolve(__dirname, '../..');

test('user_cron schema accepts boolean enable gate and rejects unknown settings', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'schema/agentbox.toml.schema.json')));
  const validate = new Ajv().compile(schema.properties.user_cron);
  assert.equal(validate({ enabled: true }), true);
  assert.equal(validate({ enabled: false }), true);
  assert.equal(validate({ enabled: 'true' }), false);
  assert.equal(validate({ enabled: true, crontab: '/private' }), false);
});
