// ADR-2207 D7: browsercontainer/cdp-diagnose.js sidecar checks.
//
// Properties under test (pure parts; the CDP round trip needs a live Chrome):
//   - the verdict fails only on display or WebGPU problems: window bounds must equal
//     the configured display (maximised or fullscreen at 0,0); a WebGPU adapter must
//     exist, not be a fallback adapter, and the compute round trip (1024 floats,
//     doubled, read back) must match exactly
//   - window.nostr is information only: absent Podkey never fails the verdict
//   - the WebGPU probe source really writes 1024 floats, doubles them in a compute
//     shader and compares the read-back
//   - the probe runs in a fresh background target on a loopback URL (a secure
//     context), never by navigating an existing tab, and the target is closed
//   - with no target URL the script runs the sidecar checks only
// Run: node --test tests/browsercontainer/diagnose.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '../..');
const diag = require(path.join(REPO, 'browsercontainer/cdp-diagnose.js'));
const display = { width: 1920, height: 1080, size: '1920x1080' };
const win = (o = {}) => ({ windowId: 1, bounds: { left: 0, top: 0, width: 1920, height: 1080, windowState: 'maximized', ...o } });
const gpu = (o = {}) => ({ gpu: true, secure: true,
  adapter: { vendor: 'nvidia', architecture: 'ampere', isFallbackAdapter: false },
  compute: { n: 1024, mismatches: 0, ok: true }, nostr: false, ...o });

test('all good -> ok, no failures', () => {
  const v = diag.verdict({ display, window: win(), webgpu: gpu() });
  assert.equal(v.ok, true);
  assert.deepEqual(v.failures, []);
});

test('fullscreen at the display size also passes', () => {
  assert.equal(diag.verdict({ display, window: win({ windowState: 'fullscreen' }), webgpu: gpu() }).ok, true);
});

test('display failures: clamped 1919x1079, offset, the 500x584 window, unknown window', () => {
  for (const w of [win({ width: 1919, height: 1079 }), win({ left: 710, top: 265 }),
    win({ width: 500, height: 584, windowState: 'normal' }), null]) {
    const v = diag.verdict({ display, window: w, webgpu: gpu() });
    assert.equal(v.ok, false);
    assert.ok(v.failures.some((f) => f.startsWith('display')), JSON.stringify(v.failures));
  }
});

test('WebGPU failures: no navigator.gpu, no adapter, fallback adapter, compute mismatch, probe error', () => {
  for (const g of [gpu({ gpu: false, adapter: undefined, compute: undefined }), gpu({ adapter: null, compute: undefined }),
    gpu({ adapter: { vendor: 'google', architecture: 'swiftshader', isFallbackAdapter: true } }),
    gpu({ compute: { n: 1024, mismatches: 3, ok: false } }), { error: 'Timeout: Runtime.evaluate' }, null]) {
    const v = diag.verdict({ display, window: win(), webgpu: g });
    assert.equal(v.ok, false);
    assert.ok(v.failures.some((f) => f.startsWith('webgpu')), JSON.stringify(v.failures));
  }
});

test('window.nostr is information only', () => {
  const v = diag.verdict({ display, window: win(), webgpu: gpu({ nostr: false }) });
  assert.equal(v.ok, true);
  assert.ok(v.info.some((i) => /window\.nostr/.test(i)));
});

test('the WebGPU probe doubles 1024 floats in a compute shader and compares the read-back', () => {
  const src = diag.WEBGPU_PROBE;
  assert.match(src, /const N = 1024/);
  assert.match(src, /createComputePipeline/);
  assert.match(src, /\* 2\.0/);
  assert.match(src, /mapAsync\(GPUMapMode\.READ\)/);
  assert.match(src, /isFallbackAdapter/);
  assert.match(src, /window\.nostr/);
  new Function(`return ${src}`); // parses as a JS expression
});

test('probe runs in a fresh background loopback target that is closed; no tab is navigated', () => {
  const src = fs.readFileSync(path.join(REPO, 'browsercontainer/cdp-diagnose.js'), 'utf8');
  const checks = src.slice(src.indexOf('async function sidecarChecks'), src.indexOf('// end sidecarChecks'));
  assert.match(checks, /Target\.createTarget[^\n]*background: true/);
  assert.match(checks, /Target\.closeTarget/);
  assert.doesNotMatch(checks, /Page\.navigate/);
  assert.match(diag.probeUrl({ SIDECAR_PORT: '8931' }), /^http:\/\/127\.0\.0\.1:8931\//);
});

test('no target URL -> sidecar checks only', () => {
  assert.equal(diag.parseArgs([], {}).targetUrl, null);
  assert.equal(diag.parseArgs(['http://x:1'], {}).targetUrl, 'http://x:1');
  assert.equal(diag.parseArgs(['http://x:1', '2000'], {}).waitMs, 2000);
  assert.equal(diag.parseArgs([], { TARGET_URL: 'http://y' }).targetUrl, 'http://y');
});
