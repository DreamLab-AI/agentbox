#!/usr/bin/env node
'use strict';

/**
 * routing-label-recorder.cjs — teacher labels for the skill router (ADR-2110, proposed).
 *
 * Registered on Stop by the entrypoint only when [skills.routing].label_log = true.
 * At each Stop it scans the session transcript from a per-session watermark and, for
 * every real user turn, writes ONE row to `routing_labels` in the RuVector sidecar:
 *
 *   the turn's bge-small embedding (never its text), the skills the main model actually
 *   loaded before the next turn (the teacher label), and the router's own pick for that
 *   turn joined from ~/.claude/skill-route.jsonl — so the router can be scored against
 *   the teacher, and a probe can later be trained on (embedding → label).
 *
 * Transcript-driven at Stop, like trajectory-recorder.cjs, and for the same reason:
 * PostToolUse is not a reliable per-call signal on this Claude Code build.
 *
 * HARD RULES
 *   - DEFAULT-OFF: exit 0 silently unless AGENTBOX_ROUTING_LABELS=1.
 *   - FAIL-OPEN: any error → exit 0; never blocks or slows a turn beyond its budget.
 *   - NO PROMPT TEXT PERSISTED (ADR-2090): only the vector and the text's length.
 *   - TAINT FENCE: a turn that touched an email-gateway tool is never embedded or stored
 *     (the ADR-2093 operator condition, applied to this seam too).
 *   - LAN-ONLY EMBEDDING: the embeddings endpoint must be loopback/private; a public URL
 *     is refused, because embedding a prompt off-LAN is egress of the prompt.
 *   - WATERMARK FOLLOWS DURABILITY (ADR-2015): advanced only when nothing needed
 *     persisting or after a successful write; ids are content-addressed and inserts are
 *     ON CONFLICT DO NOTHING, so a retry is idempotent.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const L = require('./lib/routing-labels.cjs');
const route = require('./lib/skill-route.cjs');

function log(msg) {
  try { process.stderr.write(`[routing-labels] ${msg}\n`); } catch { /* ignore */ }
}

const PG_SEARCH_PATHS = [
  '/home/devuser/workspace/.claude-pg/node_modules/pg',
  '/opt/agentbox/management-api/node_modules/pg',
  path.resolve(__dirname, '..', '..', 'management-api', 'node_modules', 'pg'),
  'pg',
];
function loadPg() {
  for (const p of PG_SEARCH_PATHS) {
    try { return require(p); } catch { /* next */ }
  }
  return null;
}

function pgConfig() {
  const conninfo = process.env.RUVECTOR_PG_CONNINFO ||
    'host=ruvector-postgres port=5432 dbname=ruvector user=ruvector password=ruvector';
  const kv = {};
  for (const pair of conninfo.split(/\s+/)) {
    const eq = pair.indexOf('=');
    if (eq > 0) kv[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return {
    host: kv.host || 'ruvector-postgres', port: parseInt(kv.port || '5432', 10),
    database: kv.dbname || 'ruvector', user: kv.user || 'ruvector', password: kv.password || 'ruvector',
    connectionTimeoutMillis: 5000, query_timeout: 5000, statement_timeout: 5000,
  };
}

/**
 * The same rule as `isLocalEndpoint` in scripts/agentbox-config-validate.js (E075/E077), so
 * the manifest and the hook can never disagree about what counts as on-LAN: loopback,
 * RFC 1918, CGNAT, link-local, IPv6 ULA/link-local, *.local/*.internal, or a bare compose
 * service name. Anything else is egress of the prompt.
 */
function isLanUrl(endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1' || host.startsWith('127.')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;
  return !host.includes('.');
}

const TABLE = /^[a-z_][a-z0-9_]*$/.test(process.env.AGENTBOX_ROUTING_LABELS_TABLE || '')
  ? process.env.AGENTBOX_ROUTING_LABELS_TABLE : 'routing_labels';

const DDL = `CREATE TABLE IF NOT EXISTS ${TABLE} (
  id             text PRIMARY KEY,
  session_hash   text NOT NULL,
  turn_ts        timestamptz,
  embed_model    text NOT NULL,
  embedding      real[] NOT NULL,
  loaded         text[] NOT NULL,
  load_via       text[] NOT NULL,
  label          text NOT NULL,
  router_pick    text,
  router_model   text,
  router_cascade text,
  router_margin  double precision,
  prompt_chars   integer NOT NULL,
  recorded_at    timestamptz NOT NULL DEFAULT now()
)`;

async function embed(url, model, text) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Number(process.env.AGENTBOX_ROUTING_LABELS_EMBED_TIMEOUT_MS) || 4000);
  try {
    // One text per request: the estate's Xinference renumbers data[].index across
    // concurrently merged batches (verified 2026-09-20), so never batch here.
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: [text.slice(0, L.EMBED_CHARS)] }), signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`embeddings HTTP ${res.status}`);
    const j = await res.json();
    const v = j && j.data && j.data[0] && j.data[0].embedding;
    if (!Array.isArray(v) || !v.length) throw new Error('embeddings returned no vector');
    return v;
  } finally { clearTimeout(timer); }
}

function stashPath(session) {
  return path.join(os.tmpdir(), `agentbox-routing-labels-${L.sha(session, 12)}.json`);
}
function readWatermark(session) {
  try { return Number(JSON.parse(fs.readFileSync(stashPath(session), 'utf8')).processedLines) || 0; } catch { return 0; }
}
function writeWatermark(session, n) {
  try {
    const p = stashPath(session), tmp = `${p}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ processedLines: n }), { mode: 0o600 });
    fs.renameSync(tmp, p);
  } catch (e) { log(`watermark write failed (non-fatal): ${e && e.message}`); }
}

function readRouteLog(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

async function main() {
  if (String(process.env.AGENTBOX_ROUTING_LABELS || '') !== '1') return;
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const c of process.stdin) input += c;
  let payload = {};
  try { payload = JSON.parse(input || '{}'); } catch { return; }

  const session = String(payload.session_id || '');
  const tpath = payload.transcript_path;
  if (!session || typeof tpath !== 'string') return;

  const embedUrl = process.env.AGENTBOX_ROUTING_LABELS_EMBED_URL || 'http://192.168.2.132:9997/v1/embeddings';
  const embedModel = process.env.AGENTBOX_ROUTING_LABELS_EMBED_MODEL || 'bge-small-en-v1.5';
  if (!isLanUrl(embedUrl)) { log(`refusing non-LAN embeddings endpoint ${embedUrl} — that would be prompt egress`); return; }

  let lines;
  try { lines = fs.readFileSync(tpath, 'utf8').split('\n'); } catch (e) { log(`transcript unreadable: ${e.message}`); return; }
  const from = readWatermark(session);
  const { turns, lineCount } = L.extractTurns(lines, from, {
    minChars: Number(process.env.AGENTBOX_SKILL_ROUTE_MIN_CHARS) || L.DEFAULT_MIN_CHARS,
  });
  const clean = turns.filter((t) => !t.tainted);
  if (!clean.length) { writeWatermark(session, lineCount); return; }

  const Pg = loadPg();
  if (!Pg) { log('pg module unavailable — watermark NOT advanced; retried on the next Stop'); return; }

  const cfg = route.config(process.env);
  const candidates = route.loadCandidates(cfg.skillsDir);
  const routeLines = readRouteLog(cfg.logPath);
  const sessionHash = L.sha(session, 12);

  const rows = [];
  for (const t of clean) {
    let vector;
    try { vector = await embed(embedUrl, embedModel, t.text); } catch (e) {
      log(`embedding failed — watermark NOT advanced; retried on the next Stop: ${e.message}`);
      return;
    }
    rows.push(L.rowFor(t, session, vector, embedModel, candidates, L.matchRoute(routeLines, sessionHash, t.ts)));
  }

  const client = new Pg.Client(pgConfig());
  try {
    await client.connect();
    await client.query(DDL);
    for (const r of rows) {
      await client.query(
        `INSERT INTO ${TABLE} (id, session_hash, turn_ts, embed_model, embedding, loaded, load_via, label,
           router_pick, router_model, router_cascade, router_margin, prompt_chars)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`,
        [r.id, r.session_hash, r.turn_ts, r.embed_model, r.embedding, r.loaded, r.load_via, r.label,
          r.router_pick, r.router_model, r.router_cascade, r.router_margin, r.prompt_chars]);
    }
    writeWatermark(session, lineCount);
  } catch (e) {
    log(`persist failed — watermark NOT advanced; retried on the next Stop: ${e && e.message}`);
  } finally {
    try { await client.end(); } catch { /* ignore */ }
  }
}

if (require.main === module) {
  main().catch((e) => log(`fail-open: ${e && e.message}`)).finally(() => process.exit(0));
}

module.exports = { isLanUrl, DDL };
