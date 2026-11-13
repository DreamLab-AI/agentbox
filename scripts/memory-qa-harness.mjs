#!/usr/bin/env node
// scripts/memory-qa-harness.mjs
//
// End-to-end memory fixture (ADR-2201 clause 5). The recall harness measures
// retrieval geometry: does a row survive in its own top-10. This measures the
// thing that matters one level up: does an agent ANSWER a question correctly
// from memory, and does the way it reads change that.
//
// Four arms answer the same frozen questions over the live store:
//
//   closed_book   no memory at all (the control: questions must need memory)
//   one_shot      one memory_search, answer from the five snippets
//   iterative     search / retrieve / answer in steps
//   consolidated  iterative, with consolidated topic entries added to the
//                 searchable set, each citing the dated notes it summarises
//
// The topic entries are an OVERLAY held in the fixture. Nothing is written to
// the store: the harness connects read-only (as ruvector_reader when its
// password is in the environment) and reads through the governed memSearch /
// memRetrieve paths. Read counters are forced off for the harness.
//
// Registration discipline. The questions, parameters, prompts, judge and
// floors are fixed before the first run and a floor is never moved afterwards:
//
//   --build      sample the store, have the model write questions and topic
//                entries, write the fixture. The fixture holds private memory
//                content, so it lives under the gitignored data dir.
//   --register   write scripts/recall-fixtures/memory-qa-registration.v1.json:
//                the fixture digest, the digest of the protocol module, the
//                parameters and the floors. Commit it. It is never overwritten.
//   --run        refuses unless the registration is committed and unmodified,
//                the protocol module matches its registered digest and the
//                fixture matches its registered digest.
//   --smoke N    build and run a throwaway N-per-stratum fixture under another
//                seed, to prove the plumbing. Never a registered result.
//
// Environment: the governed RUVECTOR_PG_* connection, XINFERENCE_ENDPOINT,
// EMBEDDING_MODEL, plus MEMORY_QA_MODEL_URL (an OpenAI-compatible base URL,
// ending /v1) and MEMORY_QA_MODEL. Keep the model local: every prompt carries
// private memory content.

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from './lib/memory-qa-protocol.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = join(__dirname, '..');
const PROTOCOL_FILE = join(__dirname, 'lib', 'memory-qa-protocol.mjs');
const REGISTRATION_REL = join('scripts', 'recall-fixtures', `memory-qa-registration.v${P.PROTOCOL_VERSION}.json`);
const REGISTRATION = join(REPO_DIR, REGISTRATION_REL);

function log(msg) { process.stderr.write(`[${new Date().toISOString()}] [memory-qa] ${msg}\n`); }
function die(msg) { log(`ERROR ${msg}`); process.exit(1); }

function parseArgs(argv) {
  const a = { mode: null, dataDir: join(REPO_DIR, 'backups', 'ruvector-sidecar'), smoke: 0, resume: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--build' || v === '--register' || v === '--run') a.mode = v.slice(2);
    else if (v === '--smoke') { a.mode = 'smoke'; a.smoke = Math.max(1, parseInt(argv[++i], 10) || 2); }
    else if (v === '--data-dir') a.dataDir = argv[++i];
    else if (v === '--resume') a.resume = argv[++i];
    else die(`unknown argument: ${v}`);
  }
  if (!a.mode) die('one of --build, --register, --run, --smoke N is required');
  if (a.resume && a.mode !== 'run') die('--resume applies to --run only');
  return a;
}

// ── store access (read-only) ─────────────────────────────────────────────────
function loadPg() {
  const candidates = [
    '/opt/agentbox/management-api/node_modules/pg',
    join(REPO_DIR, 'management-api', 'node_modules', 'pg'),
    ...(process.env.AGENTBOX_PG_NODE_PATH ? [join(process.env.AGENTBOX_PG_NODE_PATH, 'pg')] : []),
    'pg',
  ];
  for (const c of candidates) { try { return require(c); } catch { /* next */ } }
  throw new Error(`pg module not found: ${candidates.join(', ')}`);
}

function makePool() {
  const { pgPoolConfig } = require(join(REPO_DIR, 'management-api', 'lib', 'pg-config.js'));
  const base = pgPoolConfig();
  // Invariant 13: a read-only consumer does not hold the owner role when the
  // reader role is available. Either way the session itself is read-only.
  const reader = process.env.RUVECTOR_READER_PASSWORD
    ? { user: process.env.RUVECTOR_READER_USER || 'ruvector_reader', password: process.env.RUVECTOR_READER_PASSWORD }
    : {};
  const Pg = loadPg();
  return {
    pool: new Pg.Pool({ ...base, ...reader, options: '-c default_transaction_read_only=on', max: 4, idleTimeoutMillis: 10000, connectionTimeoutMillis: 5000 }),
    role: reader.user || base.user,
  };
}

const XINFERENCE_URL = process.env.XINFERENCE_ENDPOINT || 'http://xinference:9997';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'bge-small-en-v1.5';
async function getEmbedding(text) {
  const res = await fetch(`${XINFERENCE_URL}/v1/embeddings`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }), signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`embedding HTTP ${res.status}`);
  const j = await res.json();
  const v = j && j.data && j.data[0] && j.data[0].embedding;
  if (!Array.isArray(v) || v.length !== 384) throw new Error('embedding malformed');
  return v;
}

function makeMemoryTools(pool) {
  delete process.env.RUVECTOR_READ_COUNTS;       // the harness must not count its own reads
  delete process.env.RUVECTOR_ATTENTION_RERANK;  // baseline cosine order
  const { createMemoryTools, shapeSearchResponse } = require(join(REPO_DIR, 'mcp', 'servers', 'lib', 'memory-tools.js'));
  const tools = createMemoryTools({ backend: 'external-pg', deps: {
    pool, getPgOk: () => true, getEmbedding, xinfEnsure: async () => true,
    vecToSql: (arr) => `[${arr.join(',')}]`,
    entryId: (ns, key) => `agentbox:${ns}:${key}`,
    parseVal: (v) => { if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } } return v; },
    notifyMemoryFlash: () => {}, notifyMemoryFlashBatch: () => {},
    log: (lvl, m) => { if (lvl !== 'INFO') log(`${lvl} ${m}`); },
    writeSourceType: 'agentbox',
  } });
  return { tools, shapeSearchResponse };
}

// ── model ────────────────────────────────────────────────────────────────────
function modelConfig() {
  const url = process.env.MEMORY_QA_MODEL_URL, model = process.env.MEMORY_QA_MODEL;
  if (!url || !model) die('MEMORY_QA_MODEL_URL and MEMORY_QA_MODEL must be set (use a local model: prompts carry private memory)');
  return { url: url.replace(/\/+$/, ''), model };
}
let modelCalls = 0;
async function chat(cfg, messages) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${cfg.url}/chat/completions`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: cfg.model, temperature: P.PARAMS.temperature, max_tokens: P.PARAMS.max_tokens, messages }),
        signal: AbortSignal.timeout(300000),
      });
      if (!res.ok) throw new Error(`model HTTP ${res.status}`);
      const j = await res.json();
      modelCalls++;
      return String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '');
    } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); }
  }
  throw new Error(`model call failed after 3 attempts: ${lastErr && lastErr.message}`);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) { const i = next++; if (i >= items.length) return; out[i] = await fn(items[i], i); }
  }));
  return out;
}
// Default 1: a local model server usually has one slot, and queued requests only time out.
const CONCURRENCY = Math.max(1, parseInt(process.env.MEMORY_QA_CONCURRENCY || '1', 10) || 1);

// ── build ────────────────────────────────────────────────────────────────────
const md5 = (s) => createHash('md5').update(s).digest('hex');
const cut = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
function unit(v) { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return Float32Array.from(v, (x) => x / n); }
function dot(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d; }

async function loadNotes(pool, namespace) {
  const res = await pool.query(
    `SELECT key, value #>> '{}' AS text, created_at, embedding::text AS emb
       FROM memory_entries
      WHERE namespace = $1 AND embedding IS NOT NULL AND jsonb_typeof(value) = 'string'`, [namespace]);
  return res.rows
    .filter((r) => r.text && r.text.length >= P.PARAMS.note_min_chars)
    .map((r) => ({ key: r.key, text: r.text, created: new Date(r.created_at).toISOString(), vec: unit(JSON.parse(r.emb.replace(/^\(/, '[').replace(/\)$/, ']'))) }));
}

function clusterNotes(notes) {
  const assigned = new Set();
  const clusters = [];
  for (const leader of notes) {
    if (assigned.has(leader.key)) continue;
    const members = notes.filter((n) => !assigned.has(n.key) && dot(leader.vec, n.vec) >= P.PARAMS.cluster_min_cosine);
    const days = new Set(members.map((m) => m.created.slice(0, 10)));
    if (members.length >= P.PARAMS.cluster_min_members && days.size >= 2) {
      members.sort((a, b) => a.created.localeCompare(b.created));
      const kept = members.slice(-P.PARAMS.cluster_max_members);
      for (const m of members) assigned.add(m.key);
      clusters.push(kept);
    }
  }
  return clusters;
}

async function writeQuestion(cfg, system, user, ctx) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const qa = P.extractJson(await chat(cfg, [{ role: 'system', content: system }, { role: 'user', content: user }]));
    if (qa && P.questionDefects(qa, ctx).length === 0) return { question: qa.question.trim(), gold: qa.answer.trim() };
  }
  return null;
}

async function build(args, { perStratum, seed, fixturePath }) {
  if (existsSync(fixturePath)) die(`fixture already exists: ${fixturePath} (a fixture is never rebuilt in place)`);
  const cfg = modelConfig();
  const { pool, role } = makePool();
  try {
    const ns = P.PARAMS.namespace;
    const notes = (await loadNotes(pool, ns)).sort((a, b) => md5(seed + a.key).localeCompare(md5(seed + b.key)));
    log(`loaded ${notes.length} notes from ${ns} as ${role}`);
    const clusters = clusterNotes(notes);
    log(`${clusters.length} clusters of >= ${P.PARAMS.cluster_min_members} notes at cosine >= ${P.PARAMS.cluster_min_cosine}`);

    const questions = [];
    const topics = [];
    const used = new Set();
    const show = (n) => `KEY: ${n.key}\nDATE: ${n.created.slice(0, 10)}\n${cut(n.text, P.PARAMS.note_max_chars)}`;

    // latest-state stratum: one question and one topic entry per cluster.
    let tried = 0;
    for (let i = 0; i < clusters.length && topics.length < perStratum; i += CONCURRENCY) {
      const batch = clusters.slice(i, i + CONCURRENCY);
      const made = await mapLimit(batch, CONCURRENCY, async (members) => {
        const latest = members[members.length - 1];
        const older = members.slice(0, -1);
        const qa = await writeQuestion(cfg, P.PROMPTS.question_latest,
          `LATEST NOTE\n${show(latest)}\n\nOLDER NOTES\n${older.map(show).join('\n\n')}`,
          { source: latest.text, older: older.map((o) => o.text) });
        if (!qa) return null;
        // The topic writer never sees the question.
        const text = (await chat(cfg, [{ role: 'system', content: P.PROMPTS.topic }, { role: 'user', content: members.map(show).join('\n\n') }])).trim();
        if (!text) return null;
        return { members, latest, qa, topic: text.slice(0, P.PARAMS.topic_max_chars) };
      });
      tried += batch.length;
      for (const m of made) {
        if (!m || topics.length >= perStratum) continue;
        const n = topics.length + 1;
        const topicKey = `topic:${String(n).padStart(3, '0')}`;
        topics.push({ key: topicKey, value: m.topic, evidence: m.members.map((x) => ({ kind: 'memory', namespace: ns, key: x.key, event_time: x.created })) });
        questions.push({ id: `L${String(n).padStart(3, '0')}`, stratum: 'latest_state', question: m.qa.question, gold: m.qa.gold, source_key: m.latest.key, topic_key: topicKey });
        for (const x of m.members) used.add(x.key);
      }
      log(`latest-state: ${topics.length}/${perStratum} after ${tried} clusters`);
    }
    if (topics.length < perStratum) die(`only ${topics.length} usable clusters; need ${perStratum}`);

    // single-note stratum: notes outside every used cluster.
    const singles = notes.filter((n) => !used.has(n.key));
    let s = 0;
    for (let i = 0; i < singles.length && s < perStratum; i += CONCURRENCY) {
      const batch = singles.slice(i, i + CONCURRENCY);
      const made = await mapLimit(batch, CONCURRENCY, async (note) => {
        const qa = await writeQuestion(cfg, P.PROMPTS.question_single, `NOTE\n${show(note)}`, { source: note.text });
        return qa ? { note, qa } : null;
      });
      for (const m of made) {
        if (!m || s >= perStratum) continue;
        s++;
        questions.push({ id: `S${String(s).padStart(3, '0')}`, stratum: 'single_note', question: m.qa.question, gold: m.qa.gold, source_key: m.note.key });
      }
      log(`single-note: ${s}/${perStratum}`);
    }
    if (s < perStratum) die(`only ${s} usable single notes; need ${perStratum}`);

    const fixture = {
      protocol_version: P.PROTOCOL_VERSION, built_at: new Date().toISOString(), seed, namespace: ns,
      writer_model: cfg.model, embedding_model: EMBEDDING_MODEL,
      corpus: { notes: notes.length, clusters: clusters.length, latest_created: notes.map((n) => n.created).sort().pop() },
      questions, topics,
    };
    mkdirSync(dirname(fixturePath), { recursive: true });
    writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 1)}\n`, { mode: 0o600 });
    log(`fixture written: ${fixturePath} (${questions.length} questions, ${topics.length} topics, ${modelCalls} model calls)`);
    return fixture;
  } finally { await pool.end(); }
}

// ── register ─────────────────────────────────────────────────────────────────
function protocolDigest() { return P.sha256Hex(readFileSync(PROTOCOL_FILE, 'utf8')); }

// Everything in the repository that decides an outcome, by digest: the
// protocol, this harness (search shaping, the topic overlay, the retrieve
// cut-off) and the store's read path.
const CODE_FILES = Object.freeze({
  protocol_sha256: PROTOCOL_FILE,
  harness_sha256: fileURLToPath(import.meta.url),
  memory_tools_sha256: join(REPO_DIR, 'mcp', 'servers', 'lib', 'memory-tools.js'),
});
function codeDigests() {
  return Object.fromEntries(Object.entries(CODE_FILES).map(([k, f]) => [k, P.sha256Hex(readFileSync(f, 'utf8'))]));
}

/**
 * What a partial-results file must have been written under to be resumed.
 * Returns the reasons it may not be; empty when it may.
 */
function partialHeaderProblems(header, expected) {
  if (!header || header.header !== true) return ['the file has no header line'];
  const problems = [];
  for (const k of ['fixture_sha256', 'protocol_sha256', 'harness_sha256', 'memory_tools_sha256', 'answer_model', 'registered']) {
    if (header[k] !== expected[k]) problems.push(`${k} differs`);
  }
  return problems;
}

function register(fixturePath) {
  if (existsSync(REGISTRATION)) die(`registration already exists: ${REGISTRATION_REL} (never overwritten; a change is a new protocol version)`);
  const fx = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const problems = P.fixtureProblems(fx);
  if (problems.length) die(`fixture is not registrable:\n  ${problems.join('\n  ')}`);
  const reg = {
    protocol_version: P.PROTOCOL_VERSION,
    adr: 'ADR-2201 clause 5',
    registered_at: new Date().toISOString(),
    ...codeDigests(),
    fixture_sha256: P.fixtureDigest(fx),
    fixture: { built_at: fx.built_at, namespace: fx.namespace, questions: fx.questions.length, topics: fx.topics.length, notes_sampled_from: fx.corpus.notes, writer_model: fx.writer_model },
    arms: P.ARMS, strata: P.STRATA, params: P.PARAMS, floors: P.FLOORS,
    judge: 'deterministic: normalised gold string contained in the normalised answer (no model judge)',
    answer_model: modelConfig().model,
    runs: 'one run at temperature 0; the fixture itself is private and is not in this repository',
    limits: [
      'questions and topic entries were written by the same local model that answers',
      'topic entries exist only for the clusters the latest-state questions come from, so the consolidated comparison is an upper bound on what consolidation can give',
      'a correct paraphrase of a gold string is scored wrong, equally in every arm',
      'the consolidated arm also gets one extra prompt sentence and the evidence keys of a retrieved topic',
      'two comparisons are tested at alpha 0.05 each, with no correction for there being two',
      'the store is live: entries written after the fixture was built are searchable during the run, and the run artefact records how many',
    ],
  };
  writeFileSync(REGISTRATION, `${JSON.stringify(reg, null, 2)}\n`);
  log(`registration written: ${REGISTRATION_REL} — commit it before --run`);
}

function registeredOrDie(fixture, answerModel) {
  if (!existsSync(REGISTRATION)) die(`no registration at ${REGISTRATION_REL}; run --register and commit it`);
  let commits;
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', REGISTRATION_REL], { cwd: REPO_DIR, stdio: 'pipe' });
    execFileSync('git', ['diff', '--quiet', 'HEAD', '--', REGISTRATION_REL], { cwd: REPO_DIR, stdio: 'pipe' });
    commits = execFileSync('git', ['log', '--format=%H', '--', REGISTRATION_REL], { cwd: REPO_DIR, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch { die(`${REGISTRATION_REL} is not committed, or differs from HEAD: a run needs a registration fixed in history`); }
  // A registration is written once. A file that was deleted and re-added, or
  // edited, has more than one commit. (A commit amended before it was shared
  // still shows one: the digests quoted in docs/LEARNING-memory.md with the
  // result are the check against that.)
  if (commits.length !== 1) die(`${REGISTRATION_REL} has ${commits.length} commits in its history; a registration is committed exactly once`);
  const reg = JSON.parse(readFileSync(REGISTRATION, 'utf8'));
  const now = codeDigests();
  for (const k of Object.keys(now)) {
    if (reg[k] !== now[k]) die(`${k} changed after registration: refuse to run (register a new protocol version instead)`);
  }
  if (reg.fixture_sha256 !== P.fixtureDigest(fixture)) die('the fixture does not match its registered digest: refuse to run');
  if (reg.answer_model !== answerModel) die(`the answering model is ${answerModel}, the registration names ${reg.answer_model}: refuse to run`);
  return { reg, commit: commits[0] };
}

// ── run ──────────────────────────────────────────────────────────────────────
async function runArms(fixture, { runId, outDir, resume, registered }) {
  const cfg = modelConfig();
  const { pool, role } = makePool();
  const { tools, shapeSearchResponse } = makeMemoryTools(pool);
  const ns = fixture.namespace;
  const partial = resume || join(outDir, `${runId}.partial.jsonl`);
  mkdirSync(outDir, { recursive: true });

  // A partial file is bound to the fixture, the code and the model it was
  // written under, and a resumed record is re-judged from its stored answer:
  // the `correct` field of a file is never trusted.
  const expected = { fixture_sha256: P.fixtureDigest(fixture), ...codeDigests(), answer_model: cfg.model, registered };
  const goldOf = new Map(fixture.questions.map((q) => [q.id, q.gold]));
  const done = new Map();
  if (existsSync(partial)) {
    const lines = readFileSync(partial, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const problems = partialHeaderProblems(lines[0], expected);
    if (problems.length) die(`cannot resume from ${partial}: ${problems.join('; ')}`);
    for (const r of lines.slice(1)) {
      if (!P.ARMS.includes(r.arm) || !goldOf.has(r.id) || typeof r.answer !== 'string' || !Array.isArray(r.steps)) die(`cannot resume from ${partial}: malformed record`);
      done.set(`${r.arm}|${r.id}`, { ...r, correct: P.judge(r.answer, goldOf.get(r.id)) });
    }
    log(`resuming: ${done.size} results already recorded`);
  } else {
    writeFileSync(partial, `${JSON.stringify({ header: true, ...expected })}\n`, { mode: 0o600 });
  }

  const topicVecs = await mapLimit(fixture.topics, 4, async (t) => ({ ...t, vec: unit(await getEmbedding(t.value.slice(0, 2000))) }));
  const topicByKey = new Map(topicVecs.map((t) => [t.key, t]));
  // The store is live. Record how far it has moved since the fixture was built.
  const drift = (await pool.query(
    `SELECT count(*)::int AS entries, count(*) FILTER (WHERE created_at > $2)::int AS written_since_build
       FROM memory_entries WHERE namespace = $1`, [ns, fixture.built_at])).rows[0];
  const shape = (res) => shapeSearchResponse(res, { limit: P.PARAMS.search_limit, minScore: P.PARAMS.search_min_score, snippetChars: P.PARAMS.search_snippet_chars });

  async function search(query, withTopics) {
    const raw = await tools.memSearch(query, ns, P.PARAMS.search_limit);
    if (!raw.success) throw new Error(`memSearch failed: ${raw.error}`);
    if (raw.degraded) throw new Error('memSearch degraded to text match: the embedding service is down, refusing to measure');
    if (withTopics) {
      const qv = unit(await getEmbedding(query.substring(0, 2000)));
      raw.results = raw.results.concat(topicVecs.map((t) => ({ key: t.key, value: t.value, namespace: 'topics', source_type: 'overlay', score: dot(qv, t.vec) })));
    }
    return shape(raw).results.map((r) => ({ key: r.key, score: Math.round(r.score * 1000) / 1000, text: typeof r.value === 'string' ? r.value : JSON.stringify(r.value) }));
  }
  async function retrieve(key, withTopics) {
    if (withTopics && topicByKey.has(key)) {
      const t = topicByKey.get(key);
      return { found: true, value: t.value, evidence: t.evidence.map((e) => ({ key: e.key, date: e.event_time.slice(0, 10) })) };
    }
    const r = await tools.memRetrieve(key, ns);
    if (!r.found) return { found: false };
    const text = typeof r.value === 'string' ? r.value : JSON.stringify(r.value);
    return { found: true, value: cut(text, P.PARAMS.retrieve_max_chars) };
  }

  async function closedBook(q) {
    const o = P.extractJson(await chat(cfg, [{ role: 'system', content: P.PROMPTS.answer_closed_book }, { role: 'user', content: q.question }]));
    return { answer: o && typeof o.answer === 'string' ? o.answer : 'unknown', steps: [] };
  }
  async function oneShot(q) {
    const hits = await search(q.question, false);
    const o = P.extractJson(await chat(cfg, [
      { role: 'system', content: P.PROMPTS.answer_one_shot },
      { role: 'user', content: `QUESTION: ${q.question}\n\nMEMORY SEARCH RESULTS\n${JSON.stringify(hits)}` }]));
    return { answer: o && typeof o.answer === 'string' ? o.answer : 'unknown', steps: [{ action: 'search', keys: hits.map((h) => h.key) }] };
  }
  async function iterative(q, withTopics) {
    const system = withTopics ? `${P.PROMPTS.answer_iterative} ${P.PROMPTS.answer_consolidated_extra}` : P.PROMPTS.answer_iterative;
    const messages = [{ role: 'system', content: system }, { role: 'user', content: `QUESTION: ${q.question}` }];
    const steps = [];
    for (let i = 0; i < P.PARAMS.max_tool_steps; i++) {
      const reply = await chat(cfg, messages);
      const act = P.parseAction(reply);
      if (act.action === 'answer') return { answer: act.text, steps, malformed: act.malformed === true };
      let obs;
      if (P.isRepeat(steps, act)) { steps.push({ ...act, repeat: true }); obs = { note: P.PROMPTS.repeat_nudge }; }
      else if (act.action === 'search') { const hits = await search(act.query, withTopics); steps.push({ action: 'search', query: act.query, keys: hits.map((h) => h.key) }); obs = { results: hits }; }
      else { const r = await retrieve(act.key, withTopics); steps.push({ action: 'retrieve', key: act.key, found: r.found }); obs = r; }
      messages.push({ role: 'assistant', content: JSON.stringify(act) });
      messages.push({ role: 'user', content: `OBSERVATION: ${JSON.stringify(obs)}` });
    }
    messages.push({ role: 'user', content: 'Step limit reached. Reply now with {"action":"answer","text":"..."}.' });
    const act = P.parseAction(await chat(cfg, messages));
    return { answer: act.action === 'answer' ? act.text : 'unknown', steps, forced: true };
  }

  const runners = { closed_book: closedBook, one_shot: oneShot, iterative: (q) => iterative(q, false), consolidated: (q) => iterative(q, true) };
  const started = Date.now();
  try {
    for (const arm of P.ARMS) {
      const todo = fixture.questions.filter((q) => !done.has(`${arm}|${q.id}`));
      let n = 0;
      await mapLimit(todo, CONCURRENCY, async (q) => {
        const r = await runners[arm](q);
        const rec = { arm, id: q.id, answer: String(r.answer).slice(0, 400), correct: P.judge(r.answer, q.gold), steps: r.steps, forced: r.forced === true, malformed: r.malformed === true };
        done.set(`${arm}|${q.id}`, rec);
        appendFileSync(partial, `${JSON.stringify(rec)}\n`);
        if (++n % 10 === 0) log(`${arm}: ${n}/${todo.length}`);
      });
      const right = fixture.questions.filter((q) => done.get(`${arm}|${q.id}`).correct).length;
      log(`${arm}: ${right}/${fixture.questions.length} correct`);
    }
  } finally { await pool.end(); }

  const results = Object.fromEntries(P.ARMS.map((a) => [a, Object.fromEntries(fixture.questions.map((q) => [q.id, done.get(`${a}|${q.id}`).correct]))]));
  const v = P.verdict(results, fixture.questions);
  const stepStats = (arm) => {
    const rs = fixture.questions.map((q) => done.get(`${arm}|${q.id}`));
    const count = (kind) => rs.reduce((s, r) => s + r.steps.filter((x) => x.action === kind && !x.repeat).length, 0) / rs.length;
    return {
      mean_searches: Math.round(count('search') * 100) / 100, mean_retrieves: Math.round(count('retrieve') * 100) / 100,
      repeated_actions: rs.reduce((s, r) => s + r.steps.filter((x) => x.repeat).length, 0),
      forced_answers: rs.filter((r) => r.forced).length, malformed_replies: rs.filter((r) => r.malformed).length,
      retrieved_source_note: fixture.questions.filter((q) => done.get(`${arm}|${q.id}`).steps.some((s) => s.action === 'retrieve' && s.key === q.source_key)).length,
      retrieved_a_topic: rs.filter((r) => r.steps.some((s) => s.action === 'retrieve' && /^topic:/.test(s.key))).length,
    };
  };
  return {
    run_id: runId, registered, protocol_version: P.PROTOCOL_VERSION, answer_model: cfg.model, store_role: role,
    seconds: Math.round((Date.now() - started) / 1000), model_calls: modelCalls,
    corpus_at_run: drift,
    verdict: v, behaviour: { iterative: stepStats('iterative'), consolidated: stepStats('consolidated') },
    per_question: fixture.questions.map((q) => ({ id: q.id, stratum: q.stratum, ...Object.fromEntries(P.ARMS.map((a) => [a, done.get(`${a}|${q.id}`).correct])) })),
  };
}

function printSummary(out) {
  const pct = (x) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
  const v = out.verdict;
  const lines = [`memory-qa run ${out.run_id}${out.registered ? '' : '  ** NOT A REGISTERED RUN **'}`, 'arm            latest_state  single_note  all'];
  for (const arm of P.ARMS) lines.push(`${arm.padEnd(14)} ${pct(v.accuracy[arm].latest_state).padEnd(13)} ${pct(v.accuracy[arm].single_note).padEnd(12)} ${pct(v.accuracy[arm].all)}`);
  const c1 = v.iterative_over_one_shot, c2 = v.consolidated_over_iterative;
  lines.push(`control (closed book <= ${pct(v.control.max)}): ${pct(v.control.closed_book_accuracy)} → ${v.control.valid ? 'valid' : 'VOID'}`);
  lines.push(`iterative over one-shot (all, floor +${c1.min_points}): ${c1.diff_points >= 0 ? '+' : ''}${c1.diff_points} points, ${c1.a_only} vs ${c1.b_only} discordant, p=${c1.p.toFixed(4)} → ${c1.verdict.toUpperCase()}`);
  lines.push(`consolidated over iterative (latest_state, floor +${c2.min_points}): ${c2.diff_points >= 0 ? '+' : ''}${c2.diff_points} points, ${c2.a_only} vs ${c2.b_only} discordant, p=${c2.p.toFixed(4)}; single_note ${c2.single_note.diff_points >= 0 ? '+' : ''}${c2.single_note.diff_points} → ${c2.verdict.toUpperCase()}`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixtureDir = join(args.dataDir, 'qa-fixtures');
  const runDir = join(args.dataDir, 'qa-runs');
  const fixturePath = join(fixtureDir, `memory-qa.v${P.PROTOCOL_VERSION}.json`);
  const runId = new Date().toISOString().replace(/[:.]/g, '-');

  if (args.mode === 'build') { await build(args, { perStratum: P.PARAMS.questions_per_stratum, seed: P.PARAMS.build_seed, fixturePath }); return; }
  if (args.mode === 'register') { register(fixturePath); return; }
  if (args.mode === 'smoke') {
    const smokePath = join(fixtureDir, `memory-qa.smoke-${runId}.json`);
    const fx = await build(args, { perStratum: args.smoke, seed: `smoke-${runId}`, fixturePath: smokePath });
    const out = await runArms(fx, { runId: `smoke-${runId}`, outDir: runDir, resume: null, registered: false });
    writeFileSync(join(runDir, `smoke-${runId}.json`), `${JSON.stringify(out, null, 1)}\n`, { mode: 0o600 });
    printSummary(out);
    return;
  }
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const { reg, commit } = registeredOrDie(fixture, modelConfig().model);
  const out = await runArms(fixture, { runId, outDir: runDir, resume: args.resume, registered: true });
  out.registration = { commit, protocol_sha256: reg.protocol_sha256, harness_sha256: reg.harness_sha256, memory_tools_sha256: reg.memory_tools_sha256, fixture_sha256: reg.fixture_sha256, floors: reg.floors };
  const artifact = join(runDir, `${runId}.json`);
  writeFileSync(artifact, `${JSON.stringify(out, null, 1)}\n`, { mode: 0o600 });
  log(`run artifact: ${artifact}`);
  printSummary(out);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main().catch((e) => die(e && e.stack ? e.stack : String(e)));

export { clusterNotes, parseArgs, protocolDigest, codeDigests, partialHeaderProblems, REGISTRATION_REL };
