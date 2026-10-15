#!/usr/bin/env node
/**
 * blender-job.js - run headless Blender jobs inside the GPU sidecar, over the shared volume.
 *
 * Sidecar-first replacement for blender-batch.sh. The in-container Blender binary is not
 * baked when `[skills.spatial_and_3d].blender_local = false`; scripted builds and renders
 * run in gui-tools-service instead. This container's $BLENDER_LOCAL_SHARE
 * (default /home/devuser/gui-tools) and the sidecar's $BLENDER_REMOTE_SHARE
 * (default /home/devuser/exchange) are the SAME volume (verified 2026-10-15: bidirectional),
 * so inputs and outputs move by ordinary file copy; only the launch goes over BlenderMCP.
 *
 *   blender-job.js stage <src> [dest-relative-to-share]   copy a file/dir into the share (skips unchanged)
 *   blender-job.js submit <script.py> [--name N] [--blend F] [--cpu] [-- script args...]
 *   blender-job.js status <id>        running | done (exit 0) | failed (exit N) | lost
 *   blender-job.js tail <id> [lines]  last lines of the job log (default 40)
 *   blender-job.js wait <id> [--timeout S]   poll until finished (default 1800 s); exit = job exit code
 *   blender-job.js list               jobs, newest first
 *   blender-job.js cancel <id>        stop a running job
 *   blender-job.js paths              the local/remote share mapping in use
 *
 * Job layout (local view): <share>/jobs/<id>/{script.py,job.json,job.log,exit_code,pid}
 * The script sees env BLENDER_JOB_DIR and BLENDER_SHARE (remote paths) and argv after `--`.
 * Render outputs should be written under BLENDER_JOB_DIR (or elsewhere in the share) and are
 * then readable here at the mapped local path.
 *
 * Trust boundary: `submit` runs the given script with the sidecar Blender's full file access,
 * exactly like execute_code. Only submit scripts you wrote or reviewed.
 * Env: BLENDER_HOST (localhost), BLENDER_PORT (9876), BLENDER_LOCAL_SHARE, BLENDER_REMOTE_SHARE.
 * Exit: 0 ok, 1 error, 2 sidecar unreachable, 3 outcome unknown (timeout).
 */
const net = require('net');
const fs = require('fs');
const path = require('path');

const HOST = process.env.BLENDER_HOST || 'localhost';
const PORT = parseInt(process.env.BLENDER_PORT || '9876', 10);
const LOCAL = path.resolve(process.env.BLENDER_LOCAL_SHARE || '/home/devuser/gui-tools');
const REMOTE = process.env.BLENDER_REMOTE_SHARE || '/home/devuser/exchange';
const JOBS = 'jobs';
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SAFE_PATH_RE = /^[A-Za-z0-9._\/@+=,-]+$/;

const die = (code, msg) => { process.stderr.write(msg + '\n'); process.exit(code); };
const jobLocal = (id) => path.join(LOCAL, JOBS, id);
const jobRemote = (id) => `${REMOTE}/${JOBS}/${id}`;
const checkName = (n, what = 'job id') => { if (!NAME_RE.test(n || '')) die(1, `invalid ${what}: ${JSON.stringify(n)} (letters, digits, . _ - ; max 64)`); return n; };
const checkRemotePath = (p) => { if (!SAFE_PATH_RE.test(p) || p.includes('..')) die(1, `unsafe path: ${JSON.stringify(p)}`); return p; };

function send(code, responseMs = 30000) {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    let buf = ''; let connected = false; let t2;
    const t1 = setTimeout(() => { sock.destroy(); reject({ code: 2, msg: `cannot reach the Blender sidecar at ${HOST}:${PORT}; run blender-health.js` }); }, 8000);
    sock.connect(PORT, HOST, () => {
      connected = true; clearTimeout(t1);
      sock.write(JSON.stringify({ type: 'execute_code', params: { code } }));
      t2 = setTimeout(() => { sock.destroy(); reject({ code: 3, msg: 'no response in time: outcome UNKNOWN; check the job directory before retrying' }); }, responseMs);
    });
    sock.on('data', (d) => { buf += d; try { const j = JSON.parse(buf); clearTimeout(t2); sock.destroy(); resolve(j); } catch (_) { /* partial */ } });
    sock.on('error', (e) => { clearTimeout(t1); clearTimeout(t2); reject({ code: connected ? 1 : 2, msg: `socket error: ${e.message}` }); });
  });
}

async function run(code) {
  let r;
  try { r = await send(code); } catch (e) { die(e.code || 1, e.msg || String(e)); }
  if (r.status === 'error') die(1, `Blender error: ${r.message || JSON.stringify(r)}`);
  const inner = r.result && typeof r.result === 'object' ? r.result : { result: String(r.result ?? '') };
  return String(inner.result ?? '');
}

function copyTree(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    let n = 0;
    for (const e of fs.readdirSync(src)) n += copyTree(path.join(src, e), path.join(dest, e));
    return n;
  }
  try { const d = fs.statSync(dest); if (d.size === st.size && Math.floor(d.mtimeMs / 1000) >= Math.floor(st.mtimeMs / 1000)) return 0; } catch (_) { /* absent */ }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  fs.utimesSync(dest, st.atime, st.mtime);
  return 1;
}

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; } }

function launchPython(id, jobJson) {
  const j = JSON.stringify(jobJson);
  return `import bpy, json, os, subprocess, sys
job = json.loads(${JSON.stringify(j)})
d = job["dir"]
os.makedirs(d, exist_ok=True)
binary = bpy.app.binary_path
cmd = [binary, "-b", "--factory-startup"]
if job.get("blend"): cmd = [binary, "-b", job["blend"]]
cmd += ["--python", job["script"]]
if job.get("args"): cmd += ["--"] + job["args"]
env = dict(os.environ, BLENDER_JOB_DIR=d, BLENDER_SHARE=job["share"], BLENDER_JOB_CPU="1" if job.get("cpu") else "0")
log = open(os.path.join(d, "job.log"), "ab", buffering=0)
wrapper = '"$0" "$@"; echo $? > "' + os.path.join(d, "exit_code") + '"'
p = subprocess.Popen(["/bin/sh", "-c", wrapper] + cmd, stdout=log, stderr=subprocess.STDOUT, cwd=d, env=env, start_new_session=True)
open(os.path.join(d, "pid"), "w").write(str(p.pid))
print("launched", p.pid, binary)
`;
}

function jobState(id) {
  const d = jobLocal(id);
  if (!fs.existsSync(d)) return { state: 'unknown', note: 'no such job' };
  const ec = path.join(d, 'exit_code');
  if (fs.existsSync(ec)) { const c = parseInt(fs.readFileSync(ec, 'utf8').trim(), 10); return { state: c === 0 ? 'done' : 'failed', exit: c }; }
  return { state: 'running?', note: 'no exit_code yet' };
}

async function alive(id) {
  const pidFile = path.join(jobLocal(id), 'pid');
  if (!fs.existsSync(pidFile)) return false;
  const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
  if (!Number.isInteger(pid)) return false;
  const out = await run(`import os\ntry:\n    os.kill(${pid}, 0); print("alive")\nexcept ProcessLookupError:\n    print("gone")\nexcept PermissionError:\n    print("alive")`);
  return out.includes('alive');
}

async function status(id) {
  const s = jobState(id);
  if (s.state === 'running?') return (await alive(id)) ? { state: 'running' } : { state: 'lost', note: 'process gone without an exit_code (killed, or the sidecar restarted); read the log' };
  return s;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'paths':
      console.log(`local  share: ${LOCAL}\nremote share: ${REMOTE}\njobs: ${LOCAL}/${JOBS}  (remote ${REMOTE}/${JOBS})`);
      return;
    case 'stage': {
      const [src, destRel = path.basename(rest[0] || '')] = rest;
      if (!src) die(1, 'usage: stage <src> [dest-relative-to-share]');
      if (!fs.existsSync(src)) die(1, `no such file or directory: ${src}`);
      if (destRel.includes('..') || path.isAbsolute(destRel)) die(1, 'dest must be relative to the share and contain no ..');
      const n = copyTree(path.resolve(src), path.join(LOCAL, destRel));
      console.log(`staged ${n} file(s) -> ${REMOTE}/${destRel}`);
      return;
    }
    case 'submit': {
      const args = []; let name = null; let blend = null; let cpu = false; let script = null; let passthrough = [];
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--') { passthrough = rest.slice(i + 1); break; }
        else if (a === '--name') name = rest[++i];
        else if (a === '--blend') blend = rest[++i];
        else if (a === '--cpu') cpu = true;
        else if (!script) script = a;
        else args.push(a);
      }
      if (!script || args.length) die(1, 'usage: submit <script.py> [--name N] [--blend share-relative.blend] [--cpu] [-- script args...]');
      if (!fs.existsSync(script)) die(1, `no such script: ${script}`);
      const id = checkName(name || `${path.basename(script, '.py')}-${Date.now().toString(36)}`);
      if (fs.existsSync(jobLocal(id))) die(1, `job ${id} already exists; choose another --name`);
      fs.mkdirSync(jobLocal(id), { recursive: true });
      fs.copyFileSync(script, path.join(jobLocal(id), 'script.py'));
      let remoteBlend = null;
      if (blend) {
        if (blend.includes('..') || path.isAbsolute(blend)) die(1, '--blend must be relative to the share (stage it first)');
        if (!fs.existsSync(path.join(LOCAL, blend))) die(1, `blend not in the share: ${blend} (use stage)`);
        remoteBlend = checkRemotePath(`${REMOTE}/${blend}`);
      }
      for (const a of passthrough) if (a.includes('\0')) die(1, 'argument contains NUL');
      const job = { id, dir: checkRemotePath(jobRemote(id)), share: REMOTE, script: checkRemotePath(`${jobRemote(id)}/script.py`), blend: remoteBlend, cpu, args: passthrough };
      fs.writeFileSync(path.join(jobLocal(id), 'job.json'), JSON.stringify({ ...job, submitted: new Date().toISOString() }, null, 2));
      const out = await run(launchPython(id, job));
      console.log(`${id}\n${out.trim()}\nlog: ${path.join(jobLocal(id), 'job.log')}`);
      return;
    }
    case 'status': {
      const id = checkName(rest[0]); const s = await status(id);
      console.log(JSON.stringify({ id, ...s })); process.exit(s.state === 'done' ? 0 : s.state === 'running' ? 0 : 1);
    }
    case 'tail': {
      const id = checkName(rest[0]); const n = parseInt(rest[1] || '40', 10);
      const p = path.join(jobLocal(id), 'job.log');
      if (!fs.existsSync(p)) die(1, 'no log yet');
      console.log(fs.readFileSync(p, 'utf8').split('\n').slice(-n - 1).join('\n').trimEnd());
      return;
    }
    case 'wait': {
      const id = checkName(rest[0]); const ti = rest.indexOf('--timeout');
      const limit = (ti >= 0 ? parseInt(rest[ti + 1], 10) : 1800) * 1000; const t0 = Date.now();
      for (;;) {
        const s = await status(id);
        if (s.state === 'done') { console.log(JSON.stringify({ id, ...s })); process.exit(0); }
        if (s.state === 'failed' || s.state === 'lost' || s.state === 'unknown') { console.log(JSON.stringify({ id, ...s })); process.exit(s.exit && s.exit > 0 ? 1 : 1); }
        if (Date.now() - t0 > limit) die(3, `timed out after ${limit / 1000}s; job ${id} still running (not cancelled)`);
        await sleep(3000);
      }
    }
    case 'list': {
      const d = path.join(LOCAL, JOBS);
      if (!fs.existsSync(d)) { console.log('(no jobs)'); return; }
      const ids = fs.readdirSync(d).filter((x) => fs.existsSync(path.join(d, x, 'job.json'))).sort((a, b) => fs.statSync(path.join(d, b)).mtimeMs - fs.statSync(path.join(d, a)).mtimeMs);
      for (const id of ids.slice(0, 30)) { const s = jobState(id); console.log(`${id}\t${s.state}${s.exit !== undefined ? ' ' + s.exit : ''}`); }
      return;
    }
    case 'cancel': {
      const id = checkName(rest[0]); const pf = path.join(jobLocal(id), 'pid');
      if (!fs.existsSync(pf)) die(1, 'no pid recorded');
      const pid = parseInt(fs.readFileSync(pf, 'utf8').trim(), 10);
      if (!Number.isInteger(pid) || pid < 2) die(1, 'bad pid');
      console.log((await run(`import os, signal\ntry:\n    os.killpg(${pid}, signal.SIGTERM); print("terminated process group ${pid}")\nexcept ProcessLookupError:\n    print("already gone")`)).trim());
      return;
    }
    default:
      die(1, 'usage: blender-job.js stage|submit|status|tail|wait|list|cancel|paths (see the header comment)');
  }
})();
