#!/usr/bin/env node
'use strict';

/**
 * aoe-session-boundary.cjs — the thin shim Agent of Empires `[status_hooks]`
 * invoke on a session status transition (ADR-043 D4.1/D4.2, PRD-021 WS3,
 * DDD-019 §Anti-Corruption Layer).
 *
 * AoE runs a configured command on each transition, exporting the status-hook
 * context as env vars (src/status_hooks.rs): AOE_SESSION_ID, AOE_SESSION_TITLE,
 * AOE_PROJECT_PATH, AOE_PROFILE, AOE_TOOL, AOE_GROUP_PATH, AOE_OLD_STATUS,
 * AOE_NEW_STATUS, AOE_STATUS_CHANGED_AT (statuses are lowercase in hook env).
 * This shim maps the transition to a session-boundary phase and POSTs it to the
 * management API's /v1/sessions/boundary, which does the actual identity/URN/
 * beads/namespace/mandate binding.
 *
 *   creating | starting  → phase=create   (mint did:nostr + URN + epic + ns)
 *   running              → phase=turn      (createChild + claim a work unit)
 *   stopped  | deleting  → phase=close     (close the session epic)
 *   everything else      → no-op (exit 0)
 *
 * FAIL-OPEN: any error (no key, unreachable API, non-2xx, timeout) is logged to
 * stderr and the process exits 0 so a status transition is never blocked by the
 * identity binding. Node-only, zero dependencies (core http/https).
 *
 * Config (env): MANAGEMENT_API_URL (default http://127.0.0.1:9090),
 * MANAGEMENT_API_KEY (bearer — required; without it the shim no-ops). Optional
 * per-session overrides carried on the session's profile env: AGENTBOX_EAGER_
 * MANDATE=true, AGENTBOX_REPO_SLUG=<slug>, AGENTBOX_MANDATE_CONTAINER=<path>.
 *
 * Usage: invoked by AoE with no args (reads env), or `node aoe-session-boundary.cjs <phase>`
 * to force a phase for testing.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

function logErr(msg) {
  try { process.stderr.write(`[aoe-session-boundary] ${msg}\n`); } catch (_) { /* ignore */ }
}

function phaseForStatus(newStatus) {
  switch (String(newStatus || '').toLowerCase()) {
    case 'creating':
    case 'starting':
      return 'create';
    case 'running':
      return 'turn';
    case 'stopped':
    case 'deleting':
      return 'close';
    default:
      return null;
  }
}

function main() {
  const key = process.env.MANAGEMENT_API_KEY;
  if (!key) {
    logErr('MANAGEMENT_API_KEY not set — skipping session-boundary bind (fail-open)');
    process.exit(0);
    return;
  }

  const forced = process.argv[2];
  const validForced = ['create', 'turn', 'close'].includes(forced) ? forced : null;
  const phase = validForced || process.env.AOE_PHASE || phaseForStatus(process.env.AOE_NEW_STATUS);
  if (!phase) {
    // Not a binding transition (waiting/idle/error/unknown) — nothing to do.
    process.exit(0);
    return;
  }

  const sessionId = process.env.AOE_SESSION_ID || '';
  if (!sessionId) {
    logErr('AOE_SESSION_ID not set — cannot bind session (fail-open)');
    process.exit(0);
    return;
  }

  const slug = process.env.AOE_PROFILE || process.env.AOE_SESSION_TITLE || sessionId;
  const body = {
    phase,
    session_id: sessionId,
    slug,
    tool: process.env.AOE_TOOL || null,
    project_path: process.env.AOE_PROJECT_PATH || null,
    old_status: process.env.AOE_OLD_STATUS || null,
    new_status: process.env.AOE_NEW_STATUS || null,
    changed_at: process.env.AOE_STATUS_CHANGED_AT || null,
  };
  if (process.env.AGENTBOX_REPO_SLUG) body.repo_slug = process.env.AGENTBOX_REPO_SLUG;
  if (process.env.AGENTBOX_MANDATE_CONTAINER) body.mandate_container = process.env.AGENTBOX_MANDATE_CONTAINER;
  if (String(process.env.AGENTBOX_EAGER_MANDATE || '').toLowerCase() === 'true') body.eager_mandate = true;
  if (phase === 'turn' && process.env.AOE_SESSION_TITLE) body.turn_title = `turn:${process.env.AOE_SESSION_TITLE}`;
  if (phase === 'close' && process.env.AOE_NEW_STATUS) body.outcome = String(process.env.AOE_NEW_STATUS).toLowerCase();

  const base = process.env.MANAGEMENT_API_URL || 'http://127.0.0.1:9090';
  let target;
  try {
    target = new URL('/v1/sessions/boundary', base);
  } catch (err) {
    logErr(`bad MANAGEMENT_API_URL "${base}": ${err.message} (fail-open)`);
    process.exit(0);
    return;
  }

  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  const transport = target.protocol === 'https:' ? https : http;
  const req = transport.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: target.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
        Authorization: `Bearer ${key}`,
      },
      timeout: 5000,
    },
    (res) => {
      let chunks = '';
      res.on('data', (d) => { chunks += d.toString(); });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          process.exit(0);
        } else {
          logErr(`boundary POST ${phase} → HTTP ${res.statusCode}: ${chunks.slice(0, 300)} (fail-open)`);
          process.exit(0);
        }
      });
    },
  );

  req.on('error', (err) => {
    logErr(`boundary POST ${phase} failed: ${err.message} (fail-open)`);
    process.exit(0);
  });
  req.on('timeout', () => {
    logErr(`boundary POST ${phase} timed out (fail-open)`);
    try { req.destroy(); } catch (_) { /* ignore */ }
    process.exit(0);
  });

  req.write(payload);
  req.end();
}

main();
