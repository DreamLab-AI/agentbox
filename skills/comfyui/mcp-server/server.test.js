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

function recorder(responses) {
  const c = Object.create(ComfyUIClient.prototype);
  c.calls = [];
  c.httpRequest = async (p, method = 'GET', body) => {
    c.calls.push([method, p, body]);
    const value = responses[p];
    return typeof value === 'function' ? value() : value ?? {};
  };
  return c;
}
test('cancel deletes an owned pending job by id only', async () => {
  const c = recorder({'/queue': {queue_running: [[0,'other']], queue_pending: [[1,'other2'],[2,'mine']]}});
  assert.equal((await c.cancelJob('mine')).success, true);
  assert.deepEqual(c.calls.filter(x => x[0] === 'POST'), [['POST', '/queue', {delete: ['mine']}]]);
});
test('cancel interrupts a running job only with its own prompt_id', async () => {
  const c = recorder({'/queue': {queue_running: [[0,'mine']], queue_pending: []}});
  assert.equal((await c.cancelJob('mine')).success, true);
  assert.deepEqual(c.calls.filter(x => x[0] === 'POST'), [['POST', '/interrupt', {prompt_id: 'mine'}]]);
});
test('cancel never interrupts a foreign running job', async () => {
  const c = recorder({'/queue': {queue_running: [[0,'theirs']], queue_pending: []}});
  assert.equal((await c.cancelJob('mine')).success, false);
  assert.equal(c.calls.filter(x => x[0] === 'POST').length, 0);
});
test('safeFree skips on a busy queue without calling /free', async () => {
  const c = recorder({'/queue': {queue_running: [], queue_pending: [[1,'x']]}});
  const r = await c.safeFree();
  assert.equal(r.skipped, true); assert.match(r.reason, /not idle/);
  assert.equal(c.calls.some(x => x[1] === '/free'), false);
});
test('safeFree frees once, reports VRAM and flags a job that appeared meanwhile', async () => {
  let queues = [{queue_running: [], queue_pending: []}, {queue_running: [[0,'late']], queue_pending: []}];
  let stats = [{devices: [{vram_free: 100}]}, {devices: [{vram_free: 900}]}];
  const c = recorder({'/queue': () => queues.shift(), '/system_stats': () => stats.shift()});
  const r = await c.safeFree();
  assert.equal(r.vram_before.free, 100); assert.equal(r.vram_after.free, 900);
  assert.equal(r.job_appeared_meanwhile, true);
  assert.equal(c.calls.filter(x => x[1] === '/free').length, 1);
});
