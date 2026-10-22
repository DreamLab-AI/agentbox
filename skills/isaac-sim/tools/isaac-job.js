#!/usr/bin/env node
/**
 * isaac-job.js - client for the isaac-sim sidecar job runner (ADR-2149).
 *
 *   isaac-job.js preflight                     capabilities, versions, GPU, storage, health levels
 *   isaac-job.js stage <src> [dest]            copy a file/dir into <share>/inbox (sha256 printed; symlinks refused)
 *   isaac-job.js submit <script> [--kind K] [--seed N] [--require out.json]... [--input rel]... [--rerun]
 *                       [--min-free-gib N] [-- script args...]
 *   isaac-job.js status <id>                   queued | running | succeeded | failed | cancelled | lost
 *   isaac-job.js tail <id> [lines]
 *   isaac-job.js wait <id> [--timeout S]       exit 0 succeeded, 1 failed/cancelled/lost, 3 still running at timeout
 *   isaac-job.js artefacts <id>                names, sizes, hashes (only complete after validation)
 *   isaac-job.js cancel <id>                   stops that job's process group only
 *   isaac-job.js list | paths
 *
 * <script> and inputs are paths relative to the share (what `stage` prints). A timeout of this client,
 * of `wait` or of a request is never a job failure: re-run `status <id>`; never resubmit to find out.
 * Submitting identical script+inputs+args+seed returns the existing job (idempotent) unless --rerun.
 * Env: ISAAC_URL (http://isaac-sim:9890), ISAAC_LOCAL_SHARE (/home/devuser/gui-tools/isaac).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const URL_BASE = process.env.ISAAC_URL || 'http://isaac-sim:9890';
const SHARE = process.env.ISAAC_LOCAL_SHARE || '/home/devuser/gui-tools/isaac';
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'lost']);

async function call(method, route, body) {
  let res;
  try {
    res = await fetch(URL_BASE + route, {
      method, headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    console.error(`sidecar unreachable or request timed out (${e.message}); the job, if any, is unaffected`);
    process.exit(2);
  }
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function copyTree(src, dest) {
  const st = fs.lstatSync(src);
  if (st.isSymbolicLink()) throw new Error(`symbolic link refused: ${src}`);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const n of fs.readdirSync(src)) copyTree(path.join(src, n), path.join(dest, n));
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && sha256(dest) === sha256(src)) return;
  fs.copyFileSync(src, dest);
}

function parse(argv) {
  const opts = { require: [], input: [], rest: [] };
  let i = 0;
  const pos = [];
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { opts.rest = argv.slice(i + 1); break; }
    if (a === '--rerun') opts.rerun = true;
    else if (a.startsWith('--')) {
      const k = a.slice(2), v = argv[++i];
      if (k === 'require' || k === 'input') opts[k].push(v); else opts[k.replace(/-/g, '_')] = v;
    } else pos.push(a);
  }
  return { opts, pos };
}

async function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  const { opts, pos } = parse(argv);
  const print = (o) => console.log(JSON.stringify(o, null, 2));
  switch (cmd) {
    case 'preflight': { const r = await call('GET', '/v1/capabilities'); print(r.json); break; }
    case 'paths': print({ url: URL_BASE, local_share: SHARE, sidecar_root: '/exchange/isaac', blender_view: '/home/devuser/exchange/isaac' }); break;
    case 'stage': {
      const src = pos[0];
      if (!src) throw new Error('usage: stage <src> [dest]');
      const dest = pos[1] || path.join('inbox', path.basename(src));
      const target = path.resolve(SHARE, dest);
      if (!target.startsWith(path.resolve(SHARE) + path.sep)) throw new Error('destination escapes the share');
      copyTree(src, target);
      const files = fs.statSync(target).isDirectory() ? null : { sha256: sha256(target) };
      print({ staged: dest, ...files });
      break;
    }
    case 'submit': {
      if (!pos[0]) throw new Error('usage: submit <script> [options] [-- args]');
      const spec = { script: pos[0], kind: opts.kind || 'adhoc', seed: Number(opts.seed || 0), args: opts.rest,
        required_outputs: opts.require, inputs: opts.input, rerun: !!opts.rerun };
      if (opts.min_free_gib) spec.min_free_gib = Number(opts.min_free_gib);
      const r = await call('POST', '/v1/jobs', spec); print(r.json);
      if (r.status >= 400) process.exit(1);
      break;
    }
    case 'status': { const r = await call('GET', `/v1/jobs/${pos[0]}`); print(r.json); process.exit(r.status === 200 ? 0 : 1); }
    case 'tail': { const r = await call('GET', `/v1/jobs/${pos[0]}/log?lines=${pos[1] || 40}`); console.log((r.json.lines || []).join('\n')); break; }
    case 'artefacts': { const r = await call('GET', `/v1/jobs/${pos[0]}/artefacts`); print(r.json); break; }
    case 'cancel': { const r = await call('POST', `/v1/jobs/${pos[0]}/cancel`); print(r.json); break; }
    case 'list': { const r = await call('GET', '/v1/jobs'); print(r.json); break; }
    case 'wait': {
      const deadline = Date.now() + Number(opts.timeout || 1800) * 1000;
      for (;;) {
        const r = await call('GET', `/v1/jobs/${pos[0]}`);
        if (TERMINAL.has(r.json.state)) { print(r.json); process.exit(r.json.state === 'succeeded' ? 0 : 1); }
        if (Date.now() > deadline) { print({ id: pos[0], state: r.json.state, note: 'observation timeout; job unaffected' }); process.exit(3); }
        await new Promise((ok) => setTimeout(ok, Number(process.env.ISAAC_WAIT_POLL_MS || 3000)));
      }
    }
    default:
      console.error(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^[/ *]+/gm, ''));
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
