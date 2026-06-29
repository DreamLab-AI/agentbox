#!/usr/bin/env node
'use strict';

/**
 * Project-tracking publish hook — egress half of Sovereign Project Tracking
 * (ADR-035 §D3; PRD-017; DDD-015). The Node sibling of the SessionEnd digest
 * mirror config/hooks/nostr-session-summary.py: where that shells
 * `nostr-pod-bridge summarise` with a curated kind-30840 SessionSummary, this
 * shells `nostr-pod-bridge track` with one ProjectTrackingDigest per tracked
 * project, and the bridge signs a kind-30841 addressable event (d-tag = project
 * slug), dual-writes it to the Solid pod inbox + projects/<id>.jsonld, and
 * publishes it to the embedded relay (see services/nostr-pod-bridge `track`).
 *
 * The crypto stays in Rust (the bridge); this hook only assembles digests and
 * pipes them as JSON on the bridge's stdin — exactly mirroring the Python
 * publish() contract. It never mints URNs of its own: the project URN is minted
 * upstream via management-api/lib/uris.js and travels in the digest.
 *
 * Source of projects (in order):
 *   1. a single ProjectTrackingDigest JSON piped on STDIN (per-project publish,
 *      e.g. from POST /v1/projects/:id/publish) — used verbatim;
 *   2. otherwise GET http://127.0.0.1:${MANAGEMENT_API_PORT||9090}/v1/projects
 *      with `Authorization: Bearer ${MANAGEMENT_API_KEY}`, each tracked project
 *      mapped to a digest.
 *
 * Gating (silent exit 0 — profiles without the mesh do nothing):
 *   - bridge secrets present: AGENTBOX_BRIDGE_SK (or AGENTBOX_BRIDGE_SK_FILE) +
 *     AGENTBOX_BRIDGE_RECIPIENT_PUBKEY + AGENTBOX_POD_ROOT + AGENTBOX_ADMIN_PUBKEY
 *     (the same bridge_configured() set the session-summary hook requires); and
 *   - AGENTBOX_PROJECT_TRACKING_PUBLISH !== '0'.
 *
 * Discipline: best-effort. Every error logs to stderr and the process exits 0 so
 * a missing key, an unreachable management API, or a failing bridge invocation
 * never blocks the caller. A hard deadline guard (mirroring nostr-live-mirror)
 * guarantees the hook never outlives its budget.
 */

const http = require('http');
const { spawnSync } = require('child_process');

// Total wall-clock budget for the whole hook (API fetch + every bridge shell).
const DEADLINE_MS = 30000;
// Per-`track` invocation budget; matches nostr-session-summary's summarise cap.
const TRACK_TIMEOUT_MS = 30000;
// Budget for the management-API list fetch.
const API_TIMEOUT_MS = 8000;

function log(msg) {
  try { process.stderr.write(`[project-tracking-publish] ${msg}\n`); } catch { /* ignore */ }
}

function envFirst(...keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return '';
}

/** True only when every input the `track` subcommand requires is set. */
function bridgeConfigured() {
  const haveSk = !!(envFirst('AGENTBOX_BRIDGE_SK') || envFirst('AGENTBOX_BRIDGE_SK_FILE'));
  return haveSk
    && !!envFirst('AGENTBOX_BRIDGE_RECIPIENT_PUBKEY')
    && !!envFirst('AGENTBOX_POD_ROOT')
    && !!envFirst('AGENTBOX_ADMIN_PUBKEY');
}

/** Basename slug, never an absolute host path (privacy: ADR-035 §telemetry). */
function slugOf(project) {
  const raw = String(
    project.slug || project.project_id || project.name || project.path || ''
  ).trim();
  if (!raw) return '';
  const base = raw.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return base || raw;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function str(value) {
  return value === undefined || value === null ? '' : String(value);
}

/**
 * Map a TrackedProject (as served by GET /v1/projects) onto the
 * ProjectTrackingDigest the Rust `track` subcommand deserialises. The slug is
 * the d-tag (NIP-33 addressable: re-publish replaces the prior digest).
 */
function toDigest(project) {
  return {
    project_id: slugOf(project),
    name: str(project.name),
    synopsis: str(project.synopsis),
    language: str(project.language),
    remote: str(project.remote),
    commits_30d: num(project.commits_30d !== undefined ? project.commits_30d : project.commits30d),
    open_issues: num(project.open_issues !== undefined ? project.open_issues : project.openIssues),
    stars: num(project.stars),
    last_commit_iso: str(
      project.last_commit_iso !== undefined ? project.last_commit_iso : project.lastCommitIso
    ),
    primer_status: str(
      project.primer_status !== undefined ? project.primer_status : project.primerStatus
    ),
    urn: str(project.urn),
  };
}

/** A payload is already a digest when it carries the d-tag field. */
function isDigest(obj) {
  return obj && typeof obj === 'object' && typeof obj.project_id === 'string' && obj.project_id.trim() !== '';
}

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { buf += chunk; });
      process.stdin.on('end', () => resolve(buf));
      process.stdin.on('error', () => resolve(buf));
      if (process.stdin.isTTY) resolve('');
    } catch {
      resolve(buf);
    }
  });
}

/** GET the tracked-project list from the in-process management API. */
function fetchProjects() {
  return new Promise((resolve) => {
    const port = envFirst('MANAGEMENT_API_PORT') || '9090';
    const apiKey = envFirst('MANAGEMENT_API_KEY');
    const options = {
      host: '127.0.0.1',
      port: Number(port),
      path: '/v1/projects',
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      timeout: API_TIMEOUT_MS,
    };
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    try {
      const req = http.request(options, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            log(`management API GET /v1/projects -> HTTP ${res.statusCode}`);
            return done([]);
          }
          try {
            const parsed = JSON.parse(body);
            const list = Array.isArray(parsed)
              ? parsed
              : (parsed && Array.isArray(parsed.projects) ? parsed.projects : []);
            done(list);
          } catch (err) {
            log(`failed to parse /v1/projects response (non-fatal): ${err && err.message}`);
            done([]);
          }
        });
      });
      req.on('timeout', () => { try { req.destroy(); } catch { /* ignore */ } done([]); });
      req.on('error', (err) => { log(`management API unreachable (non-fatal): ${err && err.message}`); done([]); });
      req.end();
    } catch (err) {
      log(`management API request failed (non-fatal): ${err && err.message}`);
      done([]);
    }
  });
}

/** Shell `nostr-pod-bridge track` with one digest on stdin (mirrors publish()). */
function publishOne(digest) {
  const binary = envFirst('AGENTBOX_BRIDGE_BIN') || 'nostr-pod-bridge';
  const proc = spawnSync(binary, ['track'], {
    input: JSON.stringify(digest),
    timeout: TRACK_TIMEOUT_MS,
    encoding: 'utf8',
  });
  if (proc.error) {
    log(`${binary} track failed for ${digest.project_id} (non-fatal): ${proc.error.message}`);
    return false;
  }
  if (proc.status !== 0) {
    const stderr = String(proc.stderr || '').slice(0, 400);
    log(`${binary} track exited ${proc.status} for ${digest.project_id}: ${stderr}`);
    return false;
  }
  return true;
}

async function main() {
  // Gate 1: explicit off switch.
  if (envFirst('AGENTBOX_PROJECT_TRACKING_PUBLISH') === '0') return 0;
  // Gate 2: bridge secrets absent → profile has no mesh, silent no-op.
  if (!bridgeConfigured()) return 0;

  let digests = [];

  // Source 1: a single ProjectTrackingDigest piped on STDIN.
  const raw = await readStdin();
  if (raw && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (isDigest(parsed)) {
        digests = [parsed];
      } else if (parsed && typeof parsed === 'object') {
        // A TrackedProject (not yet a digest) may be piped directly too.
        const slug = slugOf(parsed);
        if (slug) digests = [toDigest(parsed)];
      }
    } catch (err) {
      log(`stdin is not valid JSON (non-fatal): ${err && err.message}`);
    }
  }

  // Source 2: fall back to the management API project list.
  if (digests.length === 0) {
    const projects = await fetchProjects();
    digests = projects
      .map(toDigest)
      .filter((d) => d.project_id && d.project_id.trim() !== '');
  }

  if (digests.length === 0) return 0;

  let published = 0;
  for (const digest of digests) {
    if (publishOne(digest)) published += 1;
  }
  log(`published ${published}/${digests.length} project digest(s) to the mesh`);
  return 0;
}

// Hard kill-switch: never let the hook outlive its budget under any circumstance.
const guard = setTimeout(() => { try { process.exit(0); } catch { /* ignore */ } }, DEADLINE_MS + 1500);
if (typeof guard.unref === 'function') guard.unref();

main()
  .then((code) => process.exit(typeof code === 'number' ? code : 0))
  .catch((err) => { log(`fatal (swallowed): ${err && err.message}`); process.exit(0); });
