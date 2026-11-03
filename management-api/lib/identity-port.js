'use strict';

// One bounded client for the port's typed operations. Params travel on stdin,
// never argv; neither a refusal nor a missing port falls back to a key file.
const { spawn, spawnSync } = require('child_process');
const MAX_REPLY = 256 * 1024;
const DEADLINE_MS = 2000;

function selected(manifest, env = process.env) {
  return String(env.AGENTBOX_ROLE_ISOLATION || '') === '1' || manifest?.security?.role_isolation === true;
}

function answer(result) {
  let doc;
  try { doc = JSON.parse(result.out || ''); } catch { throw new Error('identity port returned no valid response'); }
  if (result.code !== 0 || doc.refused || doc.unavailable) throw new Error('identity port refused or unavailable');
  return doc;
}

function requestSync(op, params, opts = {}) {
  const env = opts.env || process.env;
  const result = (opts.spawnSync || spawnSync)(env.AGENTBOX_POD_BRIDGE_BIN || 'nostr-pod-bridge', ['sign-request', op], {
    env, input: JSON.stringify(params), encoding: 'utf8', timeout: DEADLINE_MS,
    maxBuffer: MAX_REPLY, stdio: ['pipe', 'pipe', 'ignore'],
  });
  return answer({ code: result.status, out: result.stdout });
}

function request(op, params, opts = {}) {
  const env = opts.env || process.env;
  return new Promise((resolve, reject) => {
    let child;
    try { child = (opts.spawn || spawn)(env.AGENTBOX_POD_BRIDGE_BIN || 'nostr-pod-bridge', ['sign-request', op], { env, stdio: ['pipe', 'pipe', 'ignore'] }); }
    catch { reject(new Error('identity port unavailable')); return; }
    let out = '';
    let settled = false;
    const finish = (err, value) => { if (!settled) { settled = true; clearTimeout(timer); err ? reject(err) : resolve(value); } };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('identity port deadline exceeded')); }, DEADLINE_MS);
    child.stdout.on('data', chunk => { out += chunk; if (out.length > MAX_REPLY) { child.kill('SIGKILL'); finish(new Error('identity port response too large')); } });
    child.on('error', () => finish(new Error('identity port unavailable')));
    child.on('close', code => { try { finish(null, answer({ code, out })); } catch (err) { finish(err); } });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(params));
  });
}

function signer(key, opts = {}) {
  const call = opts.request || ((op, params) => request(op, params, opts));
  const callSync = opts.requestSync || ((op, params) => requestSync(op, params, opts));
  const info = callSync('pubkey', { key });
  const pubkey = info.pubkey;
  if (typeof pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(pubkey)) throw new Error('identity port omitted public identity');
  return {
    pubkey,
    async sign(event) {
      if (event.kind === 22242) {
        const tag = name => event.tags?.find(t => t[0] === name)?.[1];
        return (await call('nip42_auth', { key, relay: tag('relay'), challenge: tag('challenge') })).event;
      }
      return (await call('forum_event', { key, kind: event.kind, content: event.content || '', tags: event.tags || [] })).event;
    },
    async wrapDm(recipient, content) { return (await call('nip17_wrap', { key, recipient, content })).event; },
    async unwrapAny(event) {
      try { return await call('nip17_unwrap', { key, event }); }
      catch { return call('forum_grant_unwrap', { key, event }); }
    },
    async sealChannel(event, plan) {
      return (await call('forum_seal', { key, content: event.content, tags: event.tags || [], zone: { id: plan.key.zone, epoch: plan.key.epoch, pubkey: plan.key.pubkey } })).event;
    },
  };
}

module.exports = { selected, request, requestSync, signer };
