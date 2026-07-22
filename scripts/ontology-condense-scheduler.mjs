#!/usr/bin/env node
// @ts-nocheck
/**
 * ontology-condense-scheduler.mjs — the scheduled staleness driver for the
 * ADR-113 / PRD-020 WS-2 condensation index (C7).
 *
 * The condensation refresh (scripts/ontology-condense-refresh.sh → the two libs
 * ontology-index-build.js + ontology-condense.js) had NO natural trigger:
 * nothing re-ran it when GitHubSync/elevation rewrote the logseq corpus, so the
 * PUSH Class-Summary cache (the per-turn [ONTOLOGY] breadcrumb) and the
 * ns:ontology-classes condensed store silently went stale — the "triggered
 * incrementally on sync" claim was unwired. This is that missing execution
 * surface: a gated, incremental, idempotent staleness loop that re-runs the
 * refresh only when the corpus has actually moved (or a max-age safety floor is
 * crossed). It is a THIN wrapper — it does NOT reimplement condensation; the
 * parse, the cheap-LLM pass and the cache fold all stay in the refresh script.
 *
 * Design (mirrors scripts/ruvector-aggregate-sweep.mjs — the house pattern for a
 * gated, fail-open, supervisord-staged loop):
 *   • Self-gating (default off): runs iff BOTH ONTOLOGY_CONDENSE_ENABLED and
 *     ONTOLOGY_CONDENSE_SCHEDULE are on (baked into imageEnv from
 *     [skills.ontology.condense] in agentbox.toml). Launching it is a no-op
 *     until an operator opts in and the container reboots.
 *   • Staleness gate (the GitHubSync/elevation trigger): a tick rebuilds only
 *     when the newest logseq page mtime is later than the last condense output,
 *     or the condense output is missing, or it is older than the max-age floor.
 *     A fresh index writes NOTHING (no LLM load, no cache churn).
 *   • Idempotent + locked: the actual work is ontology-condense-refresh.sh,
 *     which is itself flock-serialised (skips if a refresh already holds the
 *     lock) and whose stages overwrite/resume deterministically. The scheduler
 *     awaits each child to completion before sleeping, so ticks never overlap.
 *   • Fail-open (never crashes the loop): a failed tick — unreachable model,
 *     missing corpus dir, non-zero refresh exit — is logged and retried next
 *     tick. Nothing is thrown out of the loop.
 *
 * Config (resolved from the process env; imageEnv bakes these from the manifest):
 *   ONTOLOGY_CONDENSE_ENABLED               bool  condense master gate (shared)
 *   ONTOLOGY_CONDENSE_SCHEDULE              bool  scheduler gate (default off)
 *   ONTOLOGY_CONDENSE_SCHEDULE_INTERVAL_MINS int  loop cadence (default 60)
 *   ONTOLOGY_CONDENSE_SCHEDULE_MAX_AGE_HOURS int  rebuild-anyway floor (default 24)
 *   ONTOLOGY_PAGES_DIR      corpus dir (default logseq mainKnowledgeGraph/pages)
 *   ONTOLOGY_CONDENSED_OUT  condense output = the "index built at" marker
 *
 * Modes:
 *   node ontology-condense-scheduler.mjs --once     # one gated staleness check + refresh, then exit
 *   node ontology-condense-scheduler.mjs --loop     # gated ticks every interval (jittered ±20%)
 *   node ontology-condense-scheduler.mjs --dry-run  # report the staleness decision, run NOTHING (ungated)
 *
 * ───────────────────────────────────────────────────────────────────────────
 * SCHEDULING ARTEFACTS (mirrors ruvector-aggregate-sweep.mjs §4).
 *
 * (a) LIVE container NOW (no image rebuild): a detached self-loop, gated-off by
 *     default. Relaunch after a container restart until the supervisord program
 *     below is imaged:
 *
 *       setsid node /opt/agentbox/scripts/ontology-condense-scheduler.mjs --loop \
 *         >>/var/log/ontology-condense-scheduler.log 2>&1 &
 *
 *     Verify without waiting for a tick:
 *       node scripts/ontology-condense-scheduler.mjs --dry-run   # staleness only
 *       node scripts/ontology-condense-scheduler.mjs --once      # gated single run
 *
 * (b) NEXT image build: the durable [program:ontology-condense-scheduler] block
 *     is already staged in flake.nix next to the ruvector loops (priority 234).
 *     No environment= plumbing — the gates ride imageEnv from PID 1.
 * ───────────────────────────────────────────────────────────────────────────
 */

'use strict';

import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = resolve(HERE, '..');
const REFRESH_SH = join(REPO_DIR, 'scripts', 'ontology-condense-refresh.sh');

const HOME = process.env.HOME || '/home/devuser';

function log(level, msg) {
  process.stderr.write(`[${new Date().toISOString()}] ${level} [condense-scheduler] ${msg}\n`);
}

// ── gates (exact-string bool, mirrors ruvector-gates.js semantics) ──────────────
function boolGate(name) {
  const v = process.env[name];
  return v === '1' || v === 'true';
}
function intGate(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

// ── path resolution (kept in lock-step with ontology-condense-refresh.sh) ───────
function pagesDir() {
  return process.env.ONTOLOGY_PAGES_DIR
    || '/home/devuser/workspace/logseq/mainKnowledgeGraph/pages';
}
function condensedOut() {
  return process.env.ONTOLOGY_CONDENSED_OUT
    || join(HOME, 'workspace', '.agentbox-data', 'ontology-condensed.json');
}

// Newest *.md mtime in the corpus (ms epoch); 0 if the dir is unreadable/empty.
// GitHubSync/elevation rewrites page files, bumping their mtime — that is the
// signal the index is behind the corpus.
function newestPageMtime(dir) {
  let newest = 0;
  let files;
  try { files = readdirSync(dir); } catch { return { newest: 0, readable: false, count: 0 }; }
  let count = 0;
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    try {
      const m = statSync(join(dir, f)).mtimeMs;
      if (m > newest) newest = m;
      count++;
    } catch { /* skip a vanished/racing file */ }
  }
  return { newest, readable: true, count };
}

// Decide whether the condensation index is stale relative to the corpus.
// Reasons: 'missing' (never built), 'corpus-newer' (sync/elevation moved pages),
// 'max-age' (safety floor), or null (fresh → skip).
function staleness() {
  const out = condensedOut();
  const dir = pagesDir();
  const maxAgeHours = Math.max(1, intGate('ONTOLOGY_CONDENSE_SCHEDULE_MAX_AGE_HOURS', 24));

  let outMtime = null;
  if (existsSync(out)) {
    try { outMtime = statSync(out).mtimeMs; } catch { outMtime = null; }
  }
  if (outMtime === null) {
    return { stale: true, reason: 'missing', out, ageHours: null };
  }

  const ageHours = (Date.now() - outMtime) / 3_600_000;
  const { newest, readable, count } = newestPageMtime(dir);

  if (readable && newest > outMtime) {
    return { stale: true, reason: 'corpus-newer', out, ageHours, pages: count };
  }
  if (ageHours >= maxAgeHours) {
    return { stale: true, reason: 'max-age', out, ageHours, maxAgeHours };
  }
  return { stale: false, reason: null, out, ageHours, pages: count };
}

// ── run the refresh (idempotent + flock-serialised inside the shell) ────────────
function runRefresh() {
  return new Promise((resolve_) => {
    let child;
    try {
      child = spawn('bash', [REFRESH_SH], {
        stdio: ['ignore', 'inherit', 'inherit'],
        env: process.env,
      });
    } catch (err) {
      log('WARN', `could not spawn refresh (fail-open): ${err.message}`);
      resolve_({ ok: false, error: err.message });
      return;
    }
    child.on('error', (err) => {
      log('WARN', `refresh spawn error (fail-open): ${err.message}`);
      resolve_({ ok: false, error: err.message });
    });
    child.on('close', (code) => {
      if (code === 0) resolve_({ ok: true, code });
      else { log('WARN', `refresh exited ${code} (fail-open — retry next tick)`); resolve_({ ok: false, code }); }
    });
  });
}

// ── one tick ────────────────────────────────────────────────────────────────
// Returns a small status object; NEVER throws (fail-open).
async function tick({ dryRun = false } = {}) {
  try {
    const s = staleness();
    if (!s.stale) {
      log('INFO', `index fresh (age ${s.ageHours != null ? s.ageHours.toFixed(1) : '?'}h, ${s.pages ?? '?'} pages) — skipping.`);
      return { status: 'skipped', reason: 'fresh', ...s };
    }
    if (dryRun) {
      log('INFO', `[dry-run] index STALE (${s.reason}) — a real tick would run ${REFRESH_SH}. Nothing run.`);
      return { status: 'dry-run', ...s };
    }
    log('INFO', `index stale (${s.reason}) — running condensation refresh…`);
    const r = await runRefresh();
    return { status: r.ok ? 'refreshed' : 'error', ...s, refresh: r };
  } catch (err) {
    // Belt-and-braces: staleness()/spawn are already guarded, but never let the
    // loop die.
    log('WARN', `tick failed (fail-open): ${err.stack || err.message}`);
    return { status: 'error', error: err.message };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function gatesOpen() {
  return boolGate('ONTOLOGY_CONDENSE_ENABLED') && boolGate('ONTOLOGY_CONDENSE_SCHEDULE');
}

async function mainOnce() {
  if (!gatesOpen()) {
    log('INFO', 'ONTOLOGY_CONDENSE_ENABLED and/or ONTOLOGY_CONDENSE_SCHEDULE is off — exiting (no-op). ' +
      'Enable [skills.ontology.condense].{enabled,schedule_enabled} and reboot, or use --dry-run.');
    return 0;
  }
  const r = await tick({ dryRun: false });
  process.stdout.write(`scheduler --once: ${r.status}${r.reason ? ` (${r.reason})` : ''}.\n`);
  return 0;
}

async function mainDryRun() {
  // Ungated read-only inspection of the staleness decision.
  const r = await tick({ dryRun: true });
  process.stdout.write(`scheduler --dry-run: ${r.status}${r.reason ? ` (${r.reason})` : ''}.\n`);
  return 0;
}

async function mainLoop() {
  let running = true;
  const stop = (sig) => { log('INFO', `${sig} received — exiting loop after current tick.`); running = false; };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  log('INFO', 'condensation staleness loop starting.');
  while (running) {
    if (!gatesOpen()) {
      log('INFO', 'gate(s) off — exiting loop (no-op).');
      return 0;
    }
    const r = await tick({ dryRun: false });
    log('INFO', `tick: ${r.status}${r.reason ? ` (${r.reason})` : ''}.`);
    if (!running) break;
    const mins = Math.max(1, intGate('ONTOLOGY_CONDENSE_SCHEDULE_INTERVAL_MINS', 60));
    // Jitter ±20% to avoid synchronised rebuilds across a fleet.
    const jitter = 1 + (Math.random() * 0.4 - 0.2);
    const until = Date.now() + Math.round(mins * 60_000 * jitter);
    // Sleep in short slices so a stop signal is honoured promptly.
    while (running && Date.now() < until) await sleep(Math.min(1000, until - Date.now()));
  }
  return 0;
}

async function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  if (has('-h') || has('--help')) {
    process.stdout.write(
      'Usage: ontology-condense-scheduler.mjs [--once|--loop|--dry-run]\n' +
      '  --once      one gated staleness check + refresh, then exit\n' +
      '  --loop      gated ticks every ONTOLOGY_CONDENSE_SCHEDULE_INTERVAL_MINS (default 60, ±20% jitter)\n' +
      '  --dry-run   report the staleness decision, run NOTHING (ungated, read-only)\n',
    );
    return 0;
  }
  if (has('--dry-run')) return mainDryRun();
  if (has('--loop')) return mainLoop();
  return mainOnce();
}

main()
  .then((code) => process.exit(code || 0))
  .catch((e) => { log('ERROR', e.stack || e.message); process.exit(1); });
