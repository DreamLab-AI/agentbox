#!/usr/bin/env node
// Hand-up packets: escalate a red gate from the production tier (T0) to a stronger
// tier (T1 controller, T2 user) without sharing the session. See references/handup.md.
//
//   handup.mjs attempt  --record DIR --chapter PATH --gate NAME --changed TEXT [--result TEXT] [--cap N]
//   handup.mjs write    --record DIR --id ID --reason R --ask A --question Q --gate NAME --chapter PATH
//                       [--gate-output PATH] [--artifact k=v]... [--blocks PATH]... [--session ID]
//                       [--model ID] [--profile provider/model] [--harness opencode] [--tokens N] [--wall N] [--tier T1|T2]
//   handup.mjs list     --record DIR [--all] [--json]
//   handup.mjs reply    --record DIR --id ID --verdict V [--note TEXT] [--guidance TEXT] [--file PATH]...
//                       [--lesson TEXT] [--by TIER] [--tokens N]
//   handup.mjs resume   --record DIR --id ID [--cwd DIR] [--dry-run]
//   handup.mjs validate --record DIR
//   handup.mjs stats    --record DIR [--json]
//
// Exit codes: 0 ok · 1 usage/validation error · 2 attempt cap reached (hand up) ·
// 3 identical retry refused (hand up with reason=stall). Node ≥ 18, no dependencies.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const REASONS = ['lint-cap', 'build-cap', 'checker-cap', 'gate-b', 'needs-evidence', 'specialist', 'stall', 'product-defect', 'budget'];
const ASKS = ['fix', 'decide', 'unblock', 'judge'];
const VERDICTS = ['resolved', 'guidance', 'override', 'blocked'];
const TIERS = ['T1', 'T2'];
const T2_REASONS = new Set(['product-defect', 'budget']);
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    const val = next === undefined || next.startsWith('--') ? true : (i++, next);
    if (key in out) out[key] = [].concat(out[key], val); else out[key] = val;
  }
  return out;
}
const list = (v) => (v === undefined ? [] : [].concat(v));
const fail = (msg, code = 1) => { console.error(`handup: ${msg}`); process.exit(code); };
const need = (args, k) => { if (args[k] === undefined || args[k] === true) fail(`--${k} is required`); return args[k]; };
const slug = (p) => p.replace(/\.[a-z]+$/i, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, o) => writeFileSync(p, JSON.stringify(o, null, 2) + '\n');

function record(args) {
  const dir = resolve(need(args, 'record'));
  if (!existsSync(dir)) fail(`production record not found: ${dir}`);
  const hu = join(dir, 'handup');
  mkdirSync(join(hu, 'attempts'), { recursive: true });
  return { dir, hu };
}
const packetPath = (hu, id) => join(hu, `${id}.json`);
const replyPath = (hu, id) => join(hu, `${id}.reply.json`);
const packetIds = (hu) => readdirSync(hu).filter((f) => /^[a-z0-9-]+\.json$/.test(f) && !f.endsWith('.reply.json')).map((f) => f.slice(0, -5)).sort();

// ---------------------------------------------------------------- attempt
function cmdAttempt(args) {
  const { dir, hu } = record(args);
  const chapter = need(args, 'chapter');
  const gate = need(args, 'gate');
  const changed = need(args, 'changed');
  const chapterAbs = resolve(dir, chapter);
  if (!existsSync(chapterAbs)) fail(`chapter not found: ${chapterAbs}`);
  const defaultCap = /checker/i.test(gate) ? 2 : 3;
  const cap = Number(args.cap ?? defaultCap);
  const file = join(hu, 'attempts', `${slug(chapter)}.json`);
  const state = existsSync(file) ? readJson(file) : { chapter, attempts: [] };
  const hash = sha(readFileSync(chapterAbs));
  const sameGate = state.attempts.filter((a) => a.gate === gate);
  const last = sameGate[sameGate.length - 1];
  if (last && last.sha256 === hash) {
    console.error(`handup: identical retry refused for ${chapter} at gate ${gate}: chapter unchanged since attempt ${last.n}. Hand up with --reason stall.`);
    process.exit(3);
  }
  if (sameGate.length >= cap) {
    console.error(`handup: cap ${cap} reached for ${chapter} at gate ${gate}. Hand up with --reason ${/checker/i.test(gate) ? 'checker-cap' : /lint/i.test(gate) ? 'lint-cap' : 'build-cap'}.`);
    process.exit(2);
  }
  const n = sameGate.length + 1;
  state.attempts.push({ n, gate, changed, result: args.result ?? null, sha256: hash, at: now() });
  writeJson(file, state);
  console.log(`attempt ${n}/${cap} recorded for ${chapter} at ${gate}`);
}

// ---------------------------------------------------------------- write
function cmdWrite(args) {
  const { dir, hu } = record(args);
  const id = need(args, 'id');
  if (!ID_RE.test(id)) fail(`bad id ${id}: lowercase letters, digits, hyphens`);
  const reason = need(args, 'reason');
  if (!REASONS.includes(reason)) fail(`reason must be one of ${REASONS.join(', ')}`);
  const ask = need(args, 'ask');
  if (!ASKS.includes(ask)) fail(`ask must be one of ${ASKS.join(', ')}`);
  const question = need(args, 'question');
  if (question.split(/\s+/).length > 60) fail('question must be one sentence (≤ 60 words); put detail in artifacts');
  const gate = need(args, 'gate');
  const chapter = need(args, 'chapter');
  const tier = args.tier ?? (T2_REASONS.has(reason) ? 'T2' : 'T1');
  if (!TIERS.includes(tier)) fail(`tier must be T1 or T2`);
  if (T2_REASONS.has(reason) && tier !== 'T2') fail(`${reason} always goes to T2`);
  const p = packetPath(hu, id);
  if (existsSync(p)) fail(`packet ${id} already exists; packets are immutable, choose a new id`);
  const artifacts = { chapter };
  for (const kv of list(args.artifact)) {
    const m = /^([a-z_]+)=(.+)$/.exec(kv);
    if (!m) fail(`--artifact expects key=path, got ${kv}`);
    artifacts[m[1]] = m[2];
  }
  const rel = (p) => relative(dir, resolve(dir, p));
  for (const [k, v] of Object.entries(artifacts)) {
    if (!existsSync(resolve(dir, v))) fail(`artifact ${k} not found under the record: ${v}`);
    if (rel(v).startsWith('..')) fail(`artifact ${k} must live under the production record`);
  }
  if (args['gate-output'] && !existsSync(resolve(dir, args['gate-output']))) fail(`gate output not found: ${args['gate-output']}`);
  const attemptsFile = join(hu, 'attempts', `${slug(chapter)}.json`);
  const attempts = existsSync(attemptsFile) ? readJson(attemptsFile).attempts.map(({ n, gate: g, changed, result }) => ({ n, gate: g, changed, result })) : [];
  const packet = {
    id, written: now(), tier_requested: tier, reason, ask, question,
    gate: { name: gate, output: args['gate-output'] ?? null },
    artifacts, attempts,
    resume: { harness: args.harness ?? 'opencode', session: args.session ?? null, model: args.model ?? null, profile: args.profile ?? null },
    budget_spent: { tokens: Number(args.tokens ?? 0), wall_seconds: Number(args.wall ?? 0) },
    blocks: list(args.blocks),
  };
  writeJson(p, packet);
  console.log(`packet ${id} → ${tier} (${reason}, ask=${ask}) written to ${relative(process.cwd(), p)}`);
}

// ---------------------------------------------------------------- list
function cmdList(args) {
  const { hu } = record(args);
  const rows = packetIds(hu).map((id) => {
    const pk = readJson(packetPath(hu, id));
    const rp = existsSync(replyPath(hu, id)) ? readJson(replyPath(hu, id)) : null;
    return { id, tier: pk.tier_requested, reason: pk.reason, ask: pk.ask, chapter: pk.artifacts.chapter, written: pk.written, verdict: rp?.verdict ?? null, question: pk.question };
  }).filter((r) => args.all || r.verdict === null);
  if (args.json) { console.log(JSON.stringify(rows, null, 2)); return; }
  if (!rows.length) { console.log(args.all ? 'no packets' : 'no pending packets'); return; }
  for (const r of rows) console.log(`${r.id}\t${r.tier}\t${r.reason}\t${r.ask}\t${r.chapter}\t${r.verdict ?? 'PENDING'}\t${r.question}`);
}

// ---------------------------------------------------------------- reply
function cmdReply(args) {
  const { dir, hu } = record(args);
  const id = need(args, 'id');
  const p = packetPath(hu, id);
  if (!existsSync(p)) fail(`no packet ${id}`);
  const rp = replyPath(hu, id);
  if (existsSync(rp)) fail(`packet ${id} already answered; a second opinion is a new packet`);
  const verdict = need(args, 'verdict');
  if (!VERDICTS.includes(verdict)) fail(`verdict must be one of ${VERDICTS.join(', ')}`);
  const packet = readJson(p);
  const by = args.by ?? packet.tier_requested;
  if (!TIERS.includes(by)) fail('--by must be T1 or T2');
  if (verdict === 'guidance' && !args.guidance) fail('guidance verdict needs --guidance TEXT');
  if (verdict === 'override' && !args.note) fail('override needs --note giving the reason the bar was wrong here');
  const files = list(args.file);
  if (verdict === 'resolved' && !files.length) fail('resolved needs at least one --file that was changed');
  for (const f of files) if (!existsSync(resolve(dir, f))) fail(`changed file not found under the record: ${f}`);
  const reply = { id, answered: now(), by, verdict, note: args.note ?? null, guidance: args.guidance ?? null, files, lesson: args.lesson ?? null, tokens: Number(args.tokens ?? 0) };
  writeJson(rp, reply);
  console.log(`reply ${verdict} by ${by} written for ${id}`);
}

// ---------------------------------------------------------------- resume
function cmdResume(args) {
  const { dir, hu } = record(args);
  const id = need(args, 'id');
  const p = packetPath(hu, id), rp = replyPath(hu, id);
  if (!existsSync(p)) fail(`no packet ${id}`);
  if (!existsSync(rp)) fail(`packet ${id} has no reply yet`);
  const packet = readJson(p), reply = readJson(rp);
  if (reply.verdict !== 'guidance' && reply.verdict !== 'resolved') fail(`nothing to resume for verdict ${reply.verdict}`);
  const { harness, session, profile } = packet.resume;
  if (harness !== 'opencode') fail(`resume is implemented for opencode only (packet says ${harness})`);
  if (!session) fail('packet carries no session id');
  const message = reply.verdict === 'guidance'
    ? `Hand-up ${id} answered with guidance. Apply it on the next attempt and re-run the gate.\n\n${reply.guidance}`
    : `Hand-up ${id} resolved by ${reply.by}: the following files were changed (${reply.files.join(', ')}). ${reply.note ?? ''}\nRe-run the gate on the edited chapter and continue.`;
  const cmd = ['opencode', 'run', '--session', session, '--format', 'json', ...(profile ? ['-m', profile] : []), message];
  if (args['dry-run']) { console.log(cmd.map((c) => (/\s/.test(c) ? JSON.stringify(c) : c)).join(' ')); return; }
  const cwd = args.cwd ? resolve(args.cwd) : dir;
  const res = spawnSync(cmd[0], cmd.slice(1), { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  appendFileSync(join(hu, `${id}.resume.jsonl`), (res.stdout ?? '') + (res.stderr ? `\n{"stderr":${JSON.stringify(res.stderr)}}\n` : ''));
  if (res.status !== 0) fail(`opencode exited ${res.status}; see handup/${id}.resume.jsonl`, 1);
  console.log(`resumed session ${session} for ${id}; events in handup/${id}.resume.jsonl`);
}

// ---------------------------------------------------------------- validate
function cmdValidate(args) {
  const { dir, hu } = record(args);
  const problems = [];
  for (const id of packetIds(hu)) {
    let pk; try { pk = readJson(packetPath(hu, id)); } catch (e) { problems.push(`${id}: unreadable packet (${e.message})`); continue; }
    if (pk.id !== id) problems.push(`${id}: id field mismatch`);
    if (!REASONS.includes(pk.reason)) problems.push(`${id}: bad reason ${pk.reason}`);
    if (!ASKS.includes(pk.ask)) problems.push(`${id}: bad ask ${pk.ask}`);
    if (!TIERS.includes(pk.tier_requested)) problems.push(`${id}: bad tier`);
    if (T2_REASONS.has(pk.reason) && pk.tier_requested !== 'T2') problems.push(`${id}: ${pk.reason} must target T2`);
    if (typeof pk.question !== 'string' || !pk.question.trim()) problems.push(`${id}: empty question`);
    for (const [k, v] of Object.entries(pk.artifacts ?? {})) if (!existsSync(resolve(dir, v))) problems.push(`${id}: artifact ${k} missing (${v})`);
    if (pk.gate?.output && !existsSync(resolve(dir, pk.gate.output))) problems.push(`${id}: gate output missing`);
    const rp = replyPath(hu, id);
    if (existsSync(rp)) {
      let r; try { r = readJson(rp); } catch (e) { problems.push(`${id}: unreadable reply`); continue; }
      if (!VERDICTS.includes(r.verdict)) problems.push(`${id}: bad verdict ${r.verdict}`);
      if (r.verdict === 'guidance' && !r.guidance) problems.push(`${id}: guidance reply without guidance`);
      if (r.verdict === 'resolved' && !(r.files ?? []).length) problems.push(`${id}: resolved reply lists no files`);
      if (r.verdict === 'override' && !r.note) problems.push(`${id}: override without a note`);
    }
  }
  if (problems.length) { for (const p of problems) console.error(`✗ ${p}`); process.exit(1); }
  console.log(`✓ ${packetIds(hu).length} packet(s) valid`);
}

// ---------------------------------------------------------------- stats
function cmdStats(args) {
  const { hu } = record(args);
  const s = { packets: 0, pending: 0, by_chapter: {}, by_reason: {}, by_tier: {}, verdicts: {}, tokens: { T0: 0, T1: 0, T2: 0 }, wall_seconds_T0: 0, first_handup_attempt: null };
  for (const id of packetIds(hu)) {
    const pk = readJson(packetPath(hu, id));
    s.packets++;
    const ch = pk.artifacts.chapter;
    s.by_chapter[ch] = (s.by_chapter[ch] ?? 0) + 1;
    s.by_reason[pk.reason] = (s.by_reason[pk.reason] ?? 0) + 1;
    s.by_tier[pk.tier_requested] = (s.by_tier[pk.tier_requested] ?? 0) + 1;
    s.tokens.T0 += pk.budget_spent?.tokens ?? 0;
    s.wall_seconds_T0 += pk.budget_spent?.wall_seconds ?? 0;
    const n = pk.attempts?.length ?? 0;
    if (s.first_handup_attempt === null || n < s.first_handup_attempt) s.first_handup_attempt = n;
    const rp = replyPath(hu, id);
    if (existsSync(rp)) { const r = readJson(rp); s.verdicts[r.verdict] = (s.verdicts[r.verdict] ?? 0) + 1; s.tokens[r.by] += r.tokens ?? 0; } else s.pending++;
  }
  if (args.json) { console.log(JSON.stringify(s, null, 2)); return; }
  console.log(`packets ${s.packets} (pending ${s.pending}); tiers ${JSON.stringify(s.by_tier)}; reasons ${JSON.stringify(s.by_reason)}`);
  console.log(`per chapter ${JSON.stringify(s.by_chapter)}; verdicts ${JSON.stringify(s.verdicts)}`);
  console.log(`tokens T0 ${s.tokens.T0} · T1 ${s.tokens.T1} · T2 ${s.tokens.T2}; attempts before first hand-up ${s.first_handup_attempt ?? 'n/a'}`);
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
const commands = { attempt: cmdAttempt, write: cmdWrite, list: cmdList, reply: cmdReply, resume: cmdResume, validate: cmdValidate, stats: cmdStats };
if (!commands[cmd]) { console.error(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 16).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(1); }
commands[cmd](args);
