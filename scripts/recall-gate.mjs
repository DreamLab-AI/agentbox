#!/usr/bin/env node
// scripts/recall-gate.mjs
//
// The RELEASE GATE that consumes the recall harness receipt (ADR-2018 closeout,
// 2026-09-05).
//
// The harness already produced a PASS/FAIL. That is not sufficient on its own:
// a receipt is only evidence for the exact model, preprocessing, corpus/index
// revision, fixture and filters it was measured against. The estate review's
// finding was precisely that the harness's existence was being read as evidence
// about a corpus and model nobody had checked it against.
//
// So this gate refuses unless ALL of the following hold:
//
//   1. a receipt exists and its `receipt_hash` still covers its contents;
//   2. its verdict is PASS;
//   3. it is not stale (--max-age-hours, default 24);
//   4. it was not measured in a DEGRADED state (xinference down → the
//      exact-token class cannot pass honestly);
//   5. its embedding-model identity is not `rejected`, and — unless
//      --skip-live-probe — the CURRENTLY deployed model fingerprint still
//      matches the one the receipt was bound to;
//   6. the checked-in fixture hash still matches the one measured;
//   7. the retrieval-consumer gates now in force match those observed during
//      the run (a recall number measured with a consumer off is not evidence
//      for the same corpus with it on).
//
// Usage:
//   node scripts/recall-gate.mjs                     # full gate, live probe
//   node scripts/recall-gate.mjs --skip-live-probe   # offline (CI without xinference)
//   node scripts/recall-gate.mjs --max-age-hours 72
//   node scripts/recall-gate.mjs --json
//
// Exit code 0 = release permitted; non-zero = refused, with the reasons named.

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = join(__dirname, '..');

const RECEIPT_PATH = join(REPO_DIR, 'backups', 'ruvector-sidecar', 'recall-runs', 'latest-receipt.json');
const FIXTURE_PATH = join(REPO_DIR, 'scripts', 'recall-fixtures', 'recall-fixture.v1.json');

const XINFERENCE_URL = process.env.XINFERENCE_ENDPOINT || 'http://xinference:9997';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'bge-small-en-v1.5';

function sha12(s) { return createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 12); }

function parseArgs(argv) {
  const o = { maxAgeHours: 24, skipLiveProbe: false, json: false, receipt: RECEIPT_PATH };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--skip-live-probe') o.skipLiveProbe = true;
    else if (a === '--json') o.json = true;
    else if (a === '--max-age-hours') o.maxAgeHours = Math.max(1, parseInt(argv[++i], 10) || 24);
    else if (a === '--receipt') o.receipt = argv[++i];
    else if (a === '-h' || a === '--help') o.help = true;
    else { process.stderr.write(`unknown option: ${a}\n`); process.exit(64); }
  }
  return o;
}

// Probe the live embedding transport for its effective identity fingerprint.
function getEmbedding(text) {
  const body = JSON.stringify({ model: EMBEDDING_MODEL, input: text });
  return new Promise((resolve, reject) => {
    const url = new URL(XINFERENCE_URL + '/v1/embeddings');
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const emb = j && j.data && j.data[0] && j.data[0].embedding;
          if (Array.isArray(emb)) resolve(emb);
          else reject(new Error(`unexpected response: ${data.slice(0, 160)}`));
        } catch (e) { reject(new Error(`parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// The gate's own view of the retrieval-consumer gates. Only the ones that change
// what a query RETURNS matter here; connection settings do not.
const GEOMETRY_GATES = [
  'RUVECTOR_FEED_RETRIEVAL',
  'RUVECTOR_FEED_ROUTING',
  'RUVECTOR_HYBRID_SEARCH',
  'RUVECTOR_ATTENTION_RERANK',
  'RUVECTOR_SONA_APPLY_ENABLED',
  'RUVECTOR_PARAM_TUNING_ENABLED',
];

async function gate(opts) {
  const refusals = [];
  const notes = [];

  if (!existsSync(opts.receipt)) {
    return {
      permitted: false,
      refusals: [`no recall receipt at ${opts.receipt} — run the harness (\`agentbox.sh ruvector recall\`) before releasing a retrieval-geometry change`],
      notes, receipt: null,
    };
  }

  let receipt;
  try { receipt = JSON.parse(readFileSync(opts.receipt, 'utf8')); }
  catch (e) { return { permitted: false, refusals: [`receipt is unreadable: ${e.message}`], notes, receipt: null }; }

  // 1. integrity
  if (receipt.schema !== 'ruvector-recall-harness/receipt@1') {
    refusals.push(`unknown receipt schema "${receipt.schema}"`);
  }
  const claimed = receipt.receipt_hash;
  const { receipt_hash, ...body } = receipt;
  const recomputed = 'sha256-12-' + sha12(JSON.stringify(body));
  if (claimed !== recomputed) {
    refusals.push(`receipt_hash mismatch (claimed ${claimed}, recomputed ${recomputed}) — the receipt was edited after the run`);
  }

  // 2. verdict
  if (receipt.verdict !== 'PASS') {
    refusals.push(`recall verdict is ${receipt.verdict}${receipt.reasons && receipt.reasons.length ? `: ${receipt.reasons.join('; ')}` : ''}`);
  }

  // 2b. protocol — a single run is NOT the median-of-3 verdict the band was
  // calibrated for. Accepting one lucky run is precisely what the median-of-3
  // protocol exists to prevent, so a receipt from fewer runs is not evidence.
  const medianOf = (receipt.band && receipt.band.median_of) || 3;
  if (!(Number(receipt.runs) >= medianOf)) {
    refusals.push(`receipt records ${receipt.runs} run(s) but the band is calibrated on the median of ${medianOf} — re-run with --runs ${medianOf}`);
  }

  // 3. freshness
  const ranAt = Date.parse(receipt.ran_at);
  if (!Number.isFinite(ranAt)) {
    refusals.push('receipt has no parseable ran_at');
  } else {
    const ageHours = (Date.now() - ranAt) / 3600000;
    if (ageHours > opts.maxAgeHours) {
      refusals.push(`receipt is ${ageHours.toFixed(1)}h old, older than the ${opts.maxAgeHours}h bound`);
    } else {
      notes.push(`receipt age ${ageHours.toFixed(1)}h (bound ${opts.maxAgeHours}h)`);
    }
  }

  // 4. degraded measurement
  if (receipt.degraded) {
    refusals.push('the run was DEGRADED (xinference down) — the exact-token class cannot pass honestly in that state');
  }

  const bound = receipt.bound_to || {};

  // 5. model identity
  if (receipt.identity_ok === false || (bound.model && bound.model.identity_state === 'rejected')) {
    refusals.push('the run\'s embedding identity was REJECTED against the pin (ADR-2019)');
  }
  if (bound.model && bound.model.identity_state === 'unpinned') {
    notes.push('embedding identity was UNPINNED at run time — freeze config/embedding-identity.json to make this checkable');
  }
  if (!opts.skipLiveProbe) {
    try {
      const ident = require(join(REPO_DIR, 'mcp', 'servers', 'lib', 'embedding-identity.js'));
      const vec = await getEmbedding(ident.PROBE_TEXT);
      const live = ident.fingerprintVector(vec);
      if (bound.model && bound.model.fingerprint && live !== bound.model.fingerprint) {
        refusals.push(
          `the deployed embedding model has CHANGED since the run: live ${live} vs receipt ${bound.model.fingerprint}. ` +
          'The receipt is not evidence for this model — re-run the harness.');
      } else if (bound.model && bound.model.fingerprint) {
        notes.push(`live embedding fingerprint ${live} matches the receipt`);
      } else {
        notes.push(`live embedding fingerprint ${live}; receipt carried none to compare`);
      }
    } catch (e) {
      refusals.push(`could not probe the live embedding model (${e.message}) — pass --skip-live-probe to gate offline, accepting that the deployed identity is unverified`);
    }
  } else {
    notes.push('live model probe SKIPPED — the deployed identity is unverified by this gate');
  }

  // 6. fixture
  if (existsSync(FIXTURE_PATH)) {
    try {
      const fx = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
      if (bound.fixture && bound.fixture.hash && fx.fixture_hash !== bound.fixture.hash) {
        refusals.push(`the checked-in fixture (${fx.fixture_hash}) is not the one measured (${bound.fixture.hash})`);
      }
    } catch (e) { refusals.push(`fixture unreadable: ${e.message}`); }
  }
  if (bound.fixture && bound.fixture.hash_ok === false) {
    refusals.push('the fixture failed its own integrity hash during the run');
  }

  // 7. gate parity — the configuration the number was measured under
  const observed = (bound.gates || {});
  const drifted = [];
  for (const g of GEOMETRY_GATES) {
    const now = process.env[g] === undefined ? undefined : String(process.env[g]);
    const then = observed[g] === undefined ? undefined : String(observed[g]);
    const norm = (v) => (v === undefined || v === '' ? 'off' : (v === '1' || v === 'true' ? 'on' : 'off'));
    if (norm(now) !== norm(then)) drifted.push(`${g}: run=${norm(then)} now=${norm(now)}`);
  }
  if (drifted.length) {
    refusals.push(`retrieval-geometry gates changed since the run (${drifted.join(', ')}) — the receipt measured a different configuration`);
  }

  // Corpus drift is reported, not refused: rows are added continuously and a
  // stale-by-one-write receipt is not a regression. A gate that refused on it
  // would be unusable and would train people to bypass it.
  if (bound.corpus) {
    notes.push(`corpus revision at run: ${bound.corpus.revision} (${bound.corpus.embedded}/${bound.corpus.memory_entries} embedded, ${bound.corpus.pending_embeddings} pending repair)`);
    if (bound.corpus.pending_embeddings > 0) {
      notes.push(`WARNING: ${bound.corpus.pending_embeddings} row(s) were awaiting ADR-2014 embedding repair and are invisible to every recall class`);
    }
  }

  return { permitted: refusals.length === 0, refusals, notes, receipt };
}

const HELP = `recall-gate.mjs — the release gate that consumes the recall receipt (ADR-2018)

  --max-age-hours N   maximum receipt age (default 24)
  --skip-live-probe   do not probe the deployed embedding model (offline CI)
  --receipt PATH      read a different receipt
  --json              machine-readable result
  -h, --help          this help

Exit 0 = release permitted; non-zero = refused with reasons.`;

const opts = parseArgs(process.argv.slice(2));
if (opts.help) { process.stdout.write(HELP + '\n'); process.exit(0); }

const result = await gate(opts);
if (opts.json) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} else {
  process.stdout.write(`\nRecall release gate — ${result.permitted ? 'PERMITTED' : 'REFUSED'}\n`);
  for (const n of result.notes) process.stdout.write(`  note:    ${n}\n`);
  for (const r of result.refusals) process.stdout.write(`  REFUSE:  ${r}\n`);
  process.stdout.write('\n');
}
process.exit(result.permitted ? 0 : 3);
