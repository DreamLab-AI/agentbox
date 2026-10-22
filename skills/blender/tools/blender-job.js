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
 *   blender-job.js status <id>        running | done (exit 0) | failed (exit N) | cancelled | lost
 *   blender-job.js tail <id> [lines]  last lines of the job log (default 40)
 *   blender-job.js wait <id> [--timeout S]   poll until finished (default 1800 s); exit = job exit code
 *   blender-job.js list               jobs, newest first
 *   blender-job.js cancel <id>        stop a running job (SIGTERM, then SIGKILL after 5 s)
 *   blender-job.js paths              the local/remote share mapping in use
 *
 * Job layout (local view): <share>/jobs/<id>/{script.py,job.json,job.log,exit_code,pid,cancelled}
 * `pid` holds "<pid> <starttime>" (starttime = /proc/<pid>/stat field 22, recorded in the sidecar at
 * launch). A pid is trusted only while its start time still matches, so a recycled pid after a
 * sidecar restart is never reported as running and never signalled.
 * The script sees env BLENDER_JOB_DIR and BLENDER_SHARE (remote paths) and argv after `--`.
 * Render outputs should be written under BLENDER_JOB_DIR (or elsewhere in the share) and are
 * then readable here at the mapped local path.
 *
 * The share is writable by the sidecar, by any submitted job and by other containers, so it is
 * untrusted: `stage` refuses symbolic links on both sides (and checks the destination stays under
 * the share's real path); `tail` and the state files are opened with O_NOFOLLOW.
 *
 * Trust boundary: `submit` runs the given script with the sidecar Blender's full file access,
 * exactly like execute_code. Only submit scripts you wrote or reviewed.
 * Env: BLENDER_HOST (localhost), BLENDER_PORT (9876), BLENDER_LOCAL_SHARE, BLENDER_REMOTE_SHARE,
 * BLENDER_WAIT_POLL_MS (3000; tests only).
 * Exit: 0 ok, 1 error (for `wait`: the job's exit code, clamped to 1..255), 2 sidecar unreachable,
 * 3 outcome unknown (timeout or a partial reply).
 */
const net = require('net');
const fs = require('fs');
const path = require('path');

const HOST = process.env.BLENDER_HOST || 'localhost';
const PORT = parseInt(process.env.BLENDER_PORT || '9876', 10);
const LOCAL = path.resolve(process.env.BLENDER_LOCAL_SHARE || '/home/devuser/gui-tools');
const REMOTE = process.env.BLENDER_REMOTE_SHARE || '/home/devuser/exchange';
const POLL_MS = parseInt(process.env.BLENDER_WAIT_POLL_MS || '3000', 10);
const JOBS = 'jobs';
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SAFE_PATH_RE = /^[A-Za-z0-9._\/@+=,-]+$/;
const MAX_DEPTH = 32;
const TAIL_BYTES = 256 * 1024;
const PROBE_RETRIES = 5;

class Fail extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fail = (code, msg) => { throw new Fail(code, msg); };
const die = (code, msg) => { process.stderr.write(msg + '\n'); process.exit(code); };
const jobLocal = (id) => path.join(LOCAL, JOBS, id);
const jobRemote = (id) => `${REMOTE}/${JOBS}/${id}`;
const checkName = (n, what = 'job id') => { if (!NAME_RE.test(n || '')) fail(1, `invalid ${what}: ${JSON.stringify(n)} (letters, digits, . _ - ; max 64)`); return n; };
const checkRemotePath = (p) => { if (!SAFE_PATH_RE.test(p) || p.split('/').includes('..')) fail(1, `unsafe path: ${JSON.stringify(p)}`); return p; };
const badSegments = (p) => p.split(/[\\/]/).some((s) => s === '..');

/** One request to BlenderMCP. Rejects {code, msg}: 2 = unreachable (nothing received), 3 = partial/unknown, 1 = error. */
function send(code, responseMs = 30000) {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    let buf = ''; let connected = false; let settled = false; let t2;
    const finish = (fn, v) => { if (settled) return; settled = true; clearTimeout(t1); clearTimeout(t2); sock.destroy(); fn(v); };
    const t1 = setTimeout(() => finish(reject, { code: 2, msg: `cannot reach the Blender sidecar at ${HOST}:${PORT}; run blender-health.js` }), 8000);
    sock.connect(PORT, HOST, () => {
      connected = true; clearTimeout(t1);
      sock.write(JSON.stringify({ type: 'execute_code', params: { code } }));
      t2 = setTimeout(() => finish(reject, { code: 3, msg: 'no response in time: outcome UNKNOWN; check the job directory before retrying' }), responseMs);
    });
    sock.on('data', (d) => { buf += d; try { finish(resolve, JSON.parse(buf)); } catch (_) { /* partial */ } });
    sock.on('close', () => finish(reject, buf
      ? { code: 3, msg: 'connection closed mid-reply: outcome UNKNOWN; check the job directory before retrying' }
      : { code: 2, msg: `the Blender sidecar at ${HOST}:${PORT} accepted the connection and closed it without replying (sidecar down?); run blender-health.js` }));
    sock.on('error', (e) => finish(reject, { code: connected ? (buf ? 3 : 1) : 2, msg: `socket error: ${e.message}` }));
  });
}

/** Run Python in the sidecar; throws Fail on any problem. */
async function run(code) {
  let r;
  try { r = await send(code); } catch (e) { throw new Fail(e.code || 1, e.msg || String(e)); }
  if (r.status === 'error') fail(1, `Blender error: ${r.message || JSON.stringify(r)}`);
  const inner = r.result && typeof r.result === 'object' ? r.result : { result: String(r.result ?? '') };
  return String(inner.result ?? '');
}

// --- symlink-safe filesystem helpers ------------------------------------------------------------
const lst = (p) => { try { return fs.lstatSync(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
let LOCAL_REAL = null;
const localReal = () => LOCAL_REAL || (LOCAL_REAL = fs.realpathSync(LOCAL));
const under = (p, root) => p === root || p.startsWith(root + path.sep);

/** Create dest's parent directories component by component under the share, refusing symlinks. */
function safeMkdirs(dir) {
  fs.mkdirSync(LOCAL, { recursive: true });
  const rel = path.relative(LOCAL, dir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) fail(1, `destination escapes the share: ${dir}`);
  let cur = LOCAL;
  for (const seg of rel.split(path.sep).filter(Boolean)) {
    cur = path.join(cur, seg);
    const st = lst(cur);
    if (!st) fs.mkdirSync(cur);
    else if (st.isSymbolicLink()) fail(1, `refusing symlink in destination path: ${cur}`);
    else if (!st.isDirectory()) fail(1, `destination component is not a directory: ${cur}`);
  }
  if (!under(fs.realpathSync(dir), localReal())) fail(1, `destination resolves outside the share: ${dir}`);
}

function copyFile(src, dest, st) {
  const d = lst(dest);
  if (d && d.isSymbolicLink()) fail(1, `refusing symlink at destination: ${dest}`);
  if (d && d.isDirectory()) fail(1, `destination is a directory: ${dest}`);
  if (d && d.size === st.size && Math.floor(d.mtimeMs / 1000) >= Math.floor(st.mtimeMs / 1000)) return 0;
  safeMkdirs(path.dirname(dest));
  const C = fs.constants;
  const inFd = fs.openSync(src, C.O_RDONLY | C.O_NOFOLLOW);
  let outFd;
  try {
    outFd = fs.openSync(dest, C.O_WRONLY | C.O_CREAT | C.O_TRUNC | C.O_NOFOLLOW, 0o644);
    const buf = Buffer.allocUnsafe(1 << 20); let n;
    while ((n = fs.readSync(inFd, buf, 0, buf.length, null)) > 0) fs.writeSync(outFd, buf, 0, n);
  } finally { fs.closeSync(inFd); if (outFd !== undefined) fs.closeSync(outFd); }
  fs.utimesSync(dest, st.atime, st.mtime);
  return 1;
}

function copyTree(src, dest, depth = 0) {
  if (depth > MAX_DEPTH) fail(1, `directory tree deeper than ${MAX_DEPTH} levels: ${src}`);
  const st = lst(src);
  if (!st) fail(1, `no such file or directory: ${src}`);
  if (st.isSymbolicLink()) fail(1, `refusing symlink in source: ${src}`);
  if (st.isDirectory()) {
    safeMkdirs(dest);
    let n = 0;
    for (const e of fs.readdirSync(src)) n += copyTree(path.join(src, e), path.join(dest, e), depth + 1);
    return n;
  }
  if (!st.isFile()) fail(1, `not a regular file: ${src}`);
  return copyFile(src, dest, st);
}

/** Read at most `max` bytes from the end of a regular file, never following a symlink. */
function readTail(p, max) {
  const C = fs.constants;
  let fd;
  try { fd = fs.openSync(p, C.O_RDONLY | C.O_NOFOLLOW); } catch (e) { return { err: e.code === 'ELOOP' ? 'symlink' : e.code }; }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { err: 'not a regular file' };
    const len = Math.min(st.size, max); const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    return { text: buf.toString('utf8'), truncated: st.size > max };
  } finally { fs.closeSync(fd); }
}
/** Small state files (pid, exit_code): never follow a symlink, cap the size. */
function readSmall(p) { const r = readTail(p, 128); return r.err ? null : r.text; }

function jobDirOk(id) { const st = lst(jobLocal(id)); return !!st && st.isDirectory() && !st.isSymbolicLink(); }

function launchPython(id, jobJson) {
  const j = JSON.stringify(jobJson);
  return `import bpy, json, os, subprocess, sys
job = json.loads(${JSON.stringify(j)})
d = job["dir"]
os.makedirs(d, exist_ok=True)
binary = bpy.app.binary_path
cmd = [binary, "-b", "--factory-startup"]
if job.get("blend"): cmd = [binary, "-b", job["blend"]]
# Background Blender exits 0 after a Python exception unless told otherwise, which made a crashed
# script look like "done exit 0". The flag must precede --python.
cmd += ["--python-exit-code", "1", "--python", job["script"]]
if job.get("args"): cmd += ["--"] + job["args"]
env = dict(os.environ, BLENDER_JOB_DIR=d, BLENDER_SHARE=job["share"], BLENDER_JOB_CPU="1" if job.get("cpu") else "0")
ec = os.path.join(d, "exit_code")
wrapper = '"$0" "$@"; echo $? > "' + ec + '.tmp" && mv "' + ec + '.tmp" "' + ec + '"'
with open(os.path.join(d, "job.log"), "ab", buffering=0) as log:
    p = subprocess.Popen(["/bin/sh", "-c", wrapper] + cmd, stdout=log, stderr=subprocess.STDOUT, cwd=d, env=env, start_new_session=True)
st = open("/proc/%d/stat" % p.pid).read()
start = st[st.rindex(")") + 2:].split()[19]
with open(os.path.join(d, "pid"), "w") as f: f.write("%d %s" % (p.pid, start))
print("launched", p.pid, binary)
`;
}

/** Parse the pid record "<pid> <starttime>"; null when missing, malformed or lacking the token. */
function pidRecord(id) {
  const t = readSmall(path.join(jobLocal(id), 'pid'));
  const m = t && /^(\d+)\s+(\d+)\s*$/.exec(t);
  if (!m) return null;
  const pid = parseInt(m[1], 10);
  return pid >= 2 ? { pid, start: m[2] } : null;
}

/** Python that prints "match" only when pid exists with the recorded start time. */
const verifyPython = (r) => `import os
def _st(p):
    try:
        s = open("/proc/%d/stat" % p).read()
        return s[s.rindex(")") + 2:].split()[19]
    except Exception:
        return None
`;
const matchExpr = (r) => `_st(${r.pid}) == "${r.start}"`;

function jobState(id) {
  if (!jobDirOk(id)) return { state: 'unknown', note: 'no such job' };
  const ec = readSmall(path.join(jobLocal(id), 'exit_code'));
  if (ec !== null && ec.trim() !== '') { const c = parseInt(ec.trim(), 10); if (Number.isInteger(c)) return { state: c === 0 ? 'done' : 'failed', exit: c }; }
  if (lst(path.join(jobLocal(id), 'cancelled'))) return { state: 'cancelled' };
  return { state: 'running?', note: 'no exit_code yet' };
}

/** True while the recorded process is still the same process. Throws Fail if the sidecar cannot be asked. */
async function alive(id) {
  const r = pidRecord(id);
  if (!r) return false;
  const out = await run(`${verifyPython(r)}print("alive" if ${matchExpr(r)} else "gone")`);
  return out.includes('alive');
}

async function status(id) {
  const s = jobState(id);
  if (s.state !== 'running?') return s;
  if (await alive(id)) return { state: 'running' };
  const again = jobState(id); // the job may have finished between the two checks
  if (again.state !== 'running?') return again;
  return { state: 'lost', note: 'process gone without an exit_code (killed, or the sidecar restarted); read the log' };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseTimeout(rest) {
  const ti = rest.indexOf('--timeout');
  if (ti < 0) return 1800;
  const v = rest[ti + 1];
  if (v === undefined || !/^\d+$/.test(v) || parseInt(v, 10) < 1) fail(1, `--timeout needs a positive number of seconds, got ${JSON.stringify(v)}`);
  return parseInt(v, 10);
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'paths':
      console.log(`local  share: ${LOCAL}\nremote share: ${REMOTE}\njobs: ${LOCAL}/${JOBS}  (remote ${REMOTE}/${JOBS})`);
      return 0;
    case 'stage': {
      const [src, destArg] = rest;
      if (!src) fail(1, 'usage: stage <src> [dest-relative-to-share]');
      const base = path.basename(src);
      if (destArg === undefined && (base === '' || base === '.' || base === '..')) fail(1, `staging ${JSON.stringify(src)} needs an explicit destination (its name is not usable); e.g. stage . myproject`);
      const destRel = destArg === undefined ? base : destArg;
      if (path.isAbsolute(destRel) || badSegments(destRel) || path.normalize(destRel) === '.') fail(1, 'dest must be a relative path under the share, containing no .. segment');
      const n = copyTree(path.resolve(src), path.join(LOCAL, destRel));
      console.log(`staged ${n} file(s) -> ${REMOTE}/${destRel}`);
      return 0;
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
      if (!script || args.length) fail(1, 'usage: submit <script.py> [--name N] [--blend share-relative.blend] [--cpu] [-- script args...]');
      if (!fs.existsSync(script)) fail(1, `no such script: ${script}`);
      const id = checkName(name || `${path.basename(script, '.py')}-${Date.now().toString(36)}`);
      let remoteBlend = null;
      if (blend) {
        if (path.isAbsolute(blend) || badSegments(blend)) fail(1, '--blend must be relative to the share (stage it first)');
        if (!fs.existsSync(path.join(LOCAL, blend))) fail(1, `blend not in the share: ${blend} (use stage)`);
        remoteBlend = checkRemotePath(`${REMOTE}/${blend}`);
      }
      for (const a of passthrough) if (a.includes('\0')) fail(1, 'argument contains NUL');
      if (lst(jobLocal(id))) fail(1, `job ${id} already exists; choose another --name`);
      // Confirm the sidecar answers BEFORE any job directory exists, so an unreachable sidecar leaves nothing behind.
      await run('print("ok")');
      safeMkdirs(path.join(LOCAL, JOBS));
      try { fs.mkdirSync(jobLocal(id)); } catch (e) { if (e.code === 'EEXIST') fail(1, `job ${id} already exists; choose another --name`); throw e; }
      let out;
      try {
        fs.copyFileSync(script, path.join(jobLocal(id), 'script.py'));
        const job = { id, dir: checkRemotePath(jobRemote(id)), share: REMOTE, script: checkRemotePath(`${jobRemote(id)}/script.py`), blend: remoteBlend, cpu, args: passthrough };
        fs.writeFileSync(path.join(jobLocal(id), 'job.json'), JSON.stringify({ ...job, submitted: new Date().toISOString() }, null, 2));
        out = await run(launchPython(id, job));
      } catch (e) {
        // Exit 2 means nothing reached Blender: remove the directory so a retry with the same --name works.
        if (e instanceof Fail && e.code === 2) fs.rmSync(jobLocal(id), { recursive: true, force: true });
        throw e;
      }
      console.log(`${id}\n${out.trim()}\nlog: ${path.join(jobLocal(id), 'job.log')}`);
      return 0;
    }
    case 'status': {
      const id = checkName(rest[0]); const s = await status(id);
      console.log(JSON.stringify({ id, ...s }));
      return s.state === 'done' || s.state === 'running' ? 0 : 1;
    }
    case 'tail': {
      const id = checkName(rest[0]);
      const n = rest[1] === undefined ? 40 : /^\d+$/.test(rest[1]) ? parseInt(rest[1], 10) : 40;
      if (!jobDirOk(id)) fail(1, 'no such job');
      const r = readTail(path.join(jobLocal(id), 'job.log'), TAIL_BYTES);
      if (r.err) fail(1, r.err === 'ENOENT' ? 'no log yet' : `cannot read job.log (${r.err})`);
      const lines = r.text.split('\n'); if (r.truncated) lines.shift();
      console.log(lines.slice(-n - 1).join('\n').trimEnd());
      return 0;
    }
    case 'wait': {
      const id = checkName(rest[0]); const limit = parseTimeout(rest) * 1000; const t0 = Date.now();
      let failures = 0;
      for (;;) {
        let s;
        try { s = await status(id); failures = 0; } catch (e) {
          if (!(e instanceof Fail) || e.code === 1 || ++failures >= PROBE_RETRIES) throw e;
          if (Date.now() - t0 > limit) fail(3, `timed out after ${limit / 1000}s; job ${id} state unknown (sidecar not answering; not cancelled)`);
          await sleep(POLL_MS); continue;
        }
        if (s.state === 'done') { console.log(JSON.stringify({ id, ...s })); return 0; }
        if (['failed', 'lost', 'unknown', 'cancelled'].includes(s.state)) { console.log(JSON.stringify({ id, ...s })); return s.exit > 0 ? Math.min(s.exit, 255) : 1; }
        if (Date.now() - t0 > limit) fail(3, `timed out after ${limit / 1000}s; job ${id} still running (not cancelled)`);
        await sleep(POLL_MS);
      }
    }
    case 'list': {
      const d = path.join(LOCAL, JOBS);
      if (!lst(d)) { console.log('(no jobs)'); return 0; }
      const ids = fs.readdirSync(d).filter((x) => NAME_RE.test(x) && jobDirOk(x) && lst(path.join(d, x, 'job.json')))
        .sort((a, b) => lst(path.join(d, b)).mtimeMs - lst(path.join(d, a)).mtimeMs);
      for (const id of ids.slice(0, 30)) { const s = jobState(id); console.log(`${id}\t${s.state}${s.exit !== undefined ? ' ' + s.exit : ''}`); }
      return 0;
    }
    case 'cancel': {
      const id = checkName(rest[0]);
      if (!jobDirOk(id)) fail(1, 'no such job');
      const r = pidRecord(id);
      if (!r) fail(1, 'no verifiable pid record (missing, malformed, or recorded without a start time); not signalling anything');
      const sig = (s) => `${verifyPython(r)}import signal
if ${matchExpr(r)}:
    os.killpg(${r.pid}, signal.${s}); print("signalled")
else:
    print("mismatch")`;
      const first = (await run(sig('SIGTERM'))).trim();
      if (first !== 'signalled') fail(1, `pid ${r.pid} no longer matches the recorded process (already finished, or the pid was reused); nothing signalled`);
      fs.writeFileSync(path.join(jobLocal(id), 'cancelled'), new Date().toISOString() + '\n');
      await sleep(5000);
      if (await alive(id)) { await run(sig('SIGKILL')); console.log(`cancelled ${id} (SIGKILL after 5 s)`); } else console.log(`cancelled ${id}`);
      return 0;
    }
    default:
      fail(1, 'usage: blender-job.js stage|submit|status|tail|wait|list|cancel|paths (see the header comment)');
  }
}

module.exports = { launchPython, main };

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => process.exit(c || 0), (e) => {
    if (e instanceof Fail) die(e.code, e.message);
    die(1, e && e.stack ? e.stack : String(e));
  });
}
