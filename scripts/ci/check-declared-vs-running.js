#!/usr/bin/env node
'use strict';

/**
 * check-declared-vs-running.js — CY-A2: the manifest must not lie about what
 * runs. For every system-manifest CATALOGUE entry that names a runtime unit
 * (`service`: a supervisor program or a compose container, plus the extra
 * units in UNITS below), the declared state (/v1/system's on/off, from
 * agentbox.toml) must agree with the runtime:
 *
 *   declared on  + no unit present  -> FAIL "declared on, not running"
 *   declared off + a unit present   -> FAIL "declared off, running"
 *
 * Runtime state comes from one of:
 *   (live)          supervisorctl status + docker ps, on the box
 *   --state FILE    a runtime snapshot (what CI checks: the committed, dated
 *                   capture tests/config/fixtures/runtime-state.json)
 *   --capture FILE  write a live snapshot to FILE (pruned to the units the
 *                   catalogue names), then check it
 *
 * A source that cannot be read (no supervisorctl, no docker socket) is
 * reported and its units are NOT judged: a missing instrument never passes as
 * "nothing running", and with neither source the check exits 2.
 *
 * Exit: 0 agree, 1 a disagreement, 2 incomplete (a unit no source covers),
 * no runtime source, or bad arguments.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * Units beyond the catalogue's single `service`, per catalogue id. A compose
 * project counts every container labelled with it.
 */
const UNITS = {
  // ADR-044: `./agentbox.sh voice up` starts the console AND the web voice loop
  // (frontend, backend, traefik) as compose project agentbox-voice. The shared
  // speech plane (nemotron-asr, pocket-tts; project agentbox-speech) follows the
  // core lifecycle, not this gate (agentbox.toml [voice] comment, ADR-044).
  'voice-console': { compose_projects: ['agentbox-voice'] },
};

/**
 * Catalogue entries whose `service` is started on demand and exits by design,
 * never supervised: there is no standing unit to compare.
 */
const ON_DEMAND = {
  'setup-wizard': 'pre-boot manifest editor, started by hand and exits after saving',
};

/** Supervisor programs that run once and exit 0 by design: EXITED means it ran. */
const ONESHOT = new Set(['tmux-autostart', 'setup', 'bootstrap', 'bootstrap-seal', 'tailscale-up']);

const LIVE_SUPERVISOR = new Set(['RUNNING', 'STARTING', 'BACKOFF']);

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--state') a.state = argv[++i];
    else if (argv[i] === '--capture') a.capture = argv[++i];
    else if (argv[i] === '--manifest') a.manifest = argv[++i];
    else if (argv[i] === '--json') a.json = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return a;
}

/** Read the live runtime: { supervisor: {prog: STATE}|null, containers: {name: {state, project}}|null, errors }. */
function captureLive() {
  const snap = { captured_at: new Date().toISOString(), supervisor: null, containers: null, errors: [] };
  try {
    const out = execFileSync('supervisorctl', ['status'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    snap.supervisor = {};
    for (const line of out.split('\n')) {
      const m = line.match(/^(\S+)\s+([A-Z]+)/);
      if (m) snap.supervisor[m[1]] = m[2];
    }
  } catch (err) {
    // supervisorctl exits 3 when any program is not RUNNING but still prints the table.
    if (err.stdout) {
      snap.supervisor = {};
      for (const line of String(err.stdout).split('\n')) {
        const m = line.match(/^(\S+)\s+([A-Z]+)/);
        if (m) snap.supervisor[m[1]] = m[2];
      }
      if (!Object.keys(snap.supervisor).length) { snap.supervisor = null; snap.errors.push(`supervisorctl: ${err.message.split('\n')[0]}`); }
    } else {
      snap.errors.push(`supervisorctl: ${err.code || err.message}`);
    }
  }
  try {
    const out = execFileSync('docker', ['ps', '-a', '--format', '{{.Names}}\t{{.State}}\t{{.Label "com.docker.compose.project"}}'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
    snap.containers = {};
    for (const line of out.split('\n').filter(Boolean)) {
      const [name, state, project] = line.split('\t');
      snap.containers[name] = { state, project: project || null };
    }
  } catch (err) {
    snap.errors.push(`docker: ${err.code || (err.message || '').split('\n')[0]}`);
  }
  return snap;
}

/**
 * Judge every catalogue entry with a runtime unit against a snapshot. Pure.
 * @param {object[]} entries  buildSystemView modules+surfaces (id, state, service)
 * @param {object} snap       runtime snapshot
 * @returns {{rows: object[], failures: object[]}}
 */
function judge(entries, snap) {
  const rows = [];
  for (const e of entries) {
    const extra = UNITS[e.id] || {};
    if (!e.service && !extra.compose_projects) continue;
    if (e.state !== 'on' && e.state !== 'off') continue; // 'available': undeclared, nothing to contradict
    if (ON_DEMAND[e.id]) {
      rows.push({ id: e.id, gate: e.gate, declared: e.state, present: [], absent: [], verdict: 'on-demand', reason: ON_DEMAND[e.id] });
      continue;
    }
    const present = [];
    const absent = [];
    let judged = false;
    if (e.service) {
      if (snap.supervisor && Object.prototype.hasOwnProperty.call(snap.supervisor, e.service)) {
        judged = true;
        const st = snap.supervisor[e.service];
        const up = LIVE_SUPERVISOR.has(st) || (ONESHOT.has(e.service) && st === 'EXITED');
        (up ? present : absent).push(`supervisor:${e.service}=${st}`);
      } else if (snap.containers && Object.prototype.hasOwnProperty.call(snap.containers, e.service)) {
        judged = true;
        const st = snap.containers[e.service].state;
        (st === 'running' ? present : absent).push(`container:${e.service}=${st}`);
      } else if (snap.supervisor && snap.containers) {
        // Both instruments read, the unit in neither: it does not exist here.
        judged = true;
        absent.push(`${e.service}=absent`);
      }
    }
    for (const proj of extra.compose_projects || []) {
      if (!snap.containers) continue;
      judged = true;
      const mine = Object.entries(snap.containers).filter(([, c]) => c.project === proj);
      for (const [name, c] of mine) {
        const label = `container:${name}=${c.state}`;
        if (present.includes(label) || absent.includes(label)) continue; // already counted as the service
        (c.state === 'running' ? present : absent).push(label);
      }
      if (!mine.length) absent.push(`compose:${proj}=absent`);
    }
    let verdict = 'agree';
    let reason = '';
    if (!judged) { verdict = 'unjudged'; reason = 'no runtime source covers this unit'; }
    else if (e.state === 'on' && present.length === 0) { verdict = 'disagree'; reason = 'declared on, not running'; }
    else if (e.state === 'off' && present.length > 0) { verdict = 'disagree'; reason = 'declared off, running'; }
    rows.push({ id: e.id, gate: e.gate, declared: e.state, present, absent, verdict, reason });
  }
  return { rows, failures: rows.filter((r) => r.verdict === 'disagree') };
}

/**
 * Keep only the units the catalogue names, so a committed snapshot carries no
 * estate-specific container (this repo is public; AGENTS.md "no host-project
 * specifics"). Supervisor programs all come from flake.nix and are public.
 */
function prune(snap, entries) {
  const names = new Set(entries.map((e) => e.service).filter(Boolean));
  const projects = new Set(Object.values(UNITS).flatMap((u) => u.compose_projects || []));
  const containers = snap.containers
    ? Object.fromEntries(Object.entries(snap.containers).filter(([n, c]) => names.has(n) || projects.has(c.project)))
    : null;
  return { ...snap, containers, pruned: 'containers limited to catalogue services and UNITS compose projects' };
}

function main() {
  let a;
  try { a = parseArgs(process.argv.slice(2)); } catch (err) { console.error(err.message); process.exit(2); }
  process.env.AGENTBOX_MANIFEST_PATH = a.manifest || path.join(ROOT, 'agentbox.toml');
  const { loadManifest } = require(path.join(ROOT, 'management-api', 'adapters', 'manifest-loader'));
  const { buildSystemView } = require(path.join(ROOT, 'management-api', 'lib', 'system-manifest'));
  const view = buildSystemView(loadManifest(), null);
  const entries = [...view.surfaces, ...view.modules];

  let snap;
  if (a.state) {
    snap = JSON.parse(fs.readFileSync(a.state, 'utf8'));
  } else {
    snap = captureLive();
    if (a.capture) fs.writeFileSync(a.capture, `${JSON.stringify(prune(snap, entries), null, 2)}\n`);
  }
  if (!snap.supervisor && !snap.containers) {
    console.error(`check-declared-vs-running: no runtime source (${(snap.errors || []).join('; ') || 'empty snapshot'}); pass --state FILE`);
    process.exit(2);
  }
  const { rows, failures } = judge(entries, snap);
  if (a.json) {
    console.log(JSON.stringify({ captured_at: snap.captured_at || null, rows, failures: failures.length }, null, 2));
  } else {
    console.log(`runtime: ${a.state ? `snapshot ${a.state}` : 'live'} (captured ${snap.captured_at || 'unknown'})${(snap.errors || []).length ? `; unread: ${snap.errors.join('; ')}` : ''}`);
    for (const r of rows) {
      const mark = { agree: 'ok  ', unjudged: 'skip', 'on-demand': 'n/a ' }[r.verdict] || 'FAIL';
      console.log(`${mark} ${r.id.padEnd(24)} declared ${r.declared.padEnd(3)} ${r.reason ? `— ${r.reason} ` : ''}[${[...r.present, ...r.absent].join(', ')}]`);
    }
  }
  const unjudged = rows.filter((r) => r.verdict === 'unjudged');
  if (failures.length) {
    console.error(`\ncheck-declared-vs-running: ${failures.length} module(s) declared one way and running another: ${failures.map((f) => `${f.id} (${f.reason})`).join(', ')}`);
    process.exit(1);
  }
  if (unjudged.length) {
    // An unread instrument is not evidence that nothing runs.
    console.error(`\ncheck-declared-vs-running: INCOMPLETE — no runtime source covers ${unjudged.map((r) => r.id).join(', ')}`);
    process.exit(2);
  }
  console.error('\ncheck-declared-vs-running: every declared module agrees with the runtime');
}

if (require.main === module) main();

module.exports = { judge, captureLive, prune, UNITS, ONESHOT, ON_DEMAND };
