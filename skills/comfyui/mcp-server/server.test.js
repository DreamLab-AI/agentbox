'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ComfyUIClient } = require('./server');
function client(responses) {
  const c = Object.create(ComfyUIClient.prototype);
  c.jobTracking = new Map();
  c.httpRequest = async p => { assert.ok(p in responses, p); return responses[p]; };
  return c;
}
test('status survives MCP restart and reports terminal empty success', async () => {
  const c = client({'/history/job-1': {'job-1': {status: {completed: true, status_str: 'success'}, outputs: {}}}});
  assert.equal((await c.getJobStatus('job-1')).status, 'completed');
});
test('partial outputs do not hide terminal execution failure', async () => {
  const c = client({'/history/job-1': {'job-1': {status: {completed: false, status_str: 'error', messages: ['failure']}, outputs: {1: {}}}}});
  const result = await c.getJobStatus('job-1');
  assert.equal(result.status, 'error'); assert.deepEqual(result.diagnostics, ['failure']);
});
test('missing history and queue is unknown, not success or failure', async () => {
  const c = client({'/history/job-1': {}, '/queue': {queue_running: [], queue_pending: []}});
  assert.equal((await c.getJobStatus('job-1')).status, 'unknown');
});
test('status distinguishes running and queued jobs', async () => {
  const c = client({'/history/job-1': {}, '/queue': {queue_running: [[0,'job-1']], queue_pending: []}});
  assert.equal((await c.getJobStatus('job-1')).status, 'running');
});
