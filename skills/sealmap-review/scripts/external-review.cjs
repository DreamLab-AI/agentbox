#!/usr/bin/env node
'use strict';
/**
 * WHAT THIS IS
 *   The external review for a diagrams-as-code corpus. It packs the topic files (diagrams and
 *   prose only, never the code), sends the pack in one shot to a Gemini model with high
 *   thinking, once per review lens, and writes each review plus a findings list for triage.
 *   Zero dependencies, Node >= 18.
 *
 *     node external-review.cjs <corpus> [--provider gemini|codex] [--lens critical,premortem]
 *          [--only <substr>] [--files-from <file listing topic paths, one per line>]
 *          [--register include|strip] [--count 15] [--out <dir>] [--dry-run]
 *
 *   Two transports. `--provider gemini` (the default, for a manual run) is a Gemini REST call and
 *   needs GEMINI_API_KEY. `--provider codex` runs the Codex CLI the codex consultant wraps
 *   (`codex exec`, the pack on stdin) and is what the scheduled audit (review-cadence.cjs
 *   audit-codex, ADR-2131 as amended 2026-11-16) uses; it needs OPENAI_API_KEY or a `codex login`.
 *
 * WHY IT IS THIS WAY
 *   The corpus is the distillation; the point is an efficient outside read of a project too
 *   large to hand over as code. An open "what do you think" prompt returns praise, so the
 *   lenses forbid scores and compliments and demand ranked, evidenced findings in a fixed
 *   shape. Findings are hypotheses: a false alarm costs one test in triage, a missed defect
 *   costs an incident, so the lenses ask the reviewer to report when in doubt. The pack goes
 *   first and the lens last so Gemini's implicit cache serves the pack to every lens after the
 *   first. The key is read from the environment only and never written anywhere.
 *
 * WHAT IT MEANS FOR THE CLIENT
 *   A second, independent model family reads the whole map of your system and lists what it
 *   would worry about before running it in production. Nothing it says is acted on until an
 *   engineer has reproduced it against the code.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { reviewContext } = require('./review-context.cjs');
const http = require('node:http');
const https = require('node:https');
const { execFileSync, spawn } = require('node:child_process');

// Mirrors diagrams-as-code's diagram-index-gen.cjs so the review reads exactly the files that gate checks.
const DEFAULT_SKIP_DIRS = ['rendered', 'tools', 'scripts', 'hero', 'archive', 'src', 'assets', 'node_modules'];
const SKIP_FILES = new Set(['README.md', 'COVERAGE.md', 'REGISTER.md', 'DECISIONS-TIMELINE.md', 'CONTRIBUTING.md']);
const LENS_DIR = path.join(__dirname, '..', 'assets', 'lenses');
const API = 'https://generativelanguage.googleapis.com/v1beta/models';
// Gemini 3.8 Flash accepts 1,048,576 input tokens; leave room for the lens and the reply.
const TOKEN_BUDGET = 1_000_000;
// One call on a 140k-220k token pack with high thinking can run well past five minutes
// before the first byte. Built-in fetch (undici) gives up after 300 s of silence, which
// surfaced as a bare "fetch failed"; node:https has no such limit, so this is the only one.
const DEFAULT_TIMEOUT_MS = 1_800_000;
// The model the codex consultant uses (mcp/consultants/codex/server.js); overridable by env.
const CODEX_DEFAULT_MODEL = 'gpt-6-astra';
// Codex is an agent that can run commands and read files; the review is of the pack alone.
const CODEX_PREAMBLE = 'Answer from the material below only. Do not run commands, open files or browse; the diagrams are the whole input, and the code is deliberately not part of this review.';
// Includes thinking tokens; the scheduled runner reserves this maximum for each lens.
const MAX_OUTPUT_TOKENS = 30000;

// The authors' own problem markers. Invariants are kept: they state what the code
// guarantees, not what is wrong with it.
const MARKER_PARA = /\*\*(Tension|Debt|Drift|Open)\b[^*\n]*:\*\*/;
const MARKER_WORD = /\b(Tension|Debt|Drift)s?\b/;
const MARKER_LINE = /\b(TENSION|DEBT|DRIFT|OPEN)\b/;

function listTopics(corpus, { only, skipDirs = [] } = {}) {
  const skip = new Set([...DEFAULT_SKIP_DIRS, ...skipDirs]);
  const out = [];
  (function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (skip.has(ent.name) || ent.name.startsWith('.')) continue;
        walk(path.join(dir, ent.name));
      } else if (ent.isFile() && ent.name.endsWith('.md') && dir !== corpus && !SKIP_FILES.has(ent.name)) {
        out.push(path.relative(corpus, path.join(dir, ent.name)).split(path.sep).join('/'));
      }
    }
  })(corpus);
  return out.filter((rel) => !only || rel.includes(only)).sort();
}

/** Remove the authors' Tension/Debt/Drift/Open paragraphs, and marker lines inside diagrams,
 *  so a review shows what the diagrams alone let a reader find. */
function stripRegister(text) {
  return text.split('\n\n').flatMap((para) => {
    const fenced = para.includes('```');
    if (!fenced && (MARKER_PARA.test(para) || MARKER_WORD.test(para))) return [];
    return [para.split('\n').filter((l) => !MARKER_LINE.test(l) && !(fenced && MARKER_PARA.test(l))).join('\n')];
  }).join('\n\n');
}

function buildPack(corpus, files, { register = 'include' } = {}) {
  return files.map((rel) => {
    const text = fs.readFileSync(path.join(corpus, rel), 'utf8');
    return `\n=== FILE: ${rel} ===\n${register === 'strip' ? stripRegister(text) : text}`;
  }).join('');
}

function loadLens(name, count) {
  const file = path.join(LENS_DIR, `${name}.md`);
  if (!fs.existsSync(file)) {
    const known = fs.readdirSync(LENS_DIR).map((f) => f.replace(/\.md$/, '')).join(', ');
    throw new Error(`unknown lens '${name}' (known: ${known})`);
  }
  return fs.readFileSync(file, 'utf8').replaceAll('{{COUNT}}', String(count));
}

/** Pull `### F-01 — title` / `### R-1 — title` blocks out of a review into records. */
function parseFindings(markdown, lens) {
  const findings = [];
  const re = /^### ([FR]-\d+)\s*[—–-]\s*(.+)$/gm;
  const heads = [...markdown.matchAll(re)];
  heads.forEach((m, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].index : markdown.length;
    const body = markdown.slice(m.index + m[0].length, end).split(/^#{1,2} /m)[0];
    // `- Evidence: x`, `- **Evidence**: x`, `* **Evidence:** x`, `- __Evidence__: x`, `- *Evidence*: x`.
    const field = (name) => (body.match(new RegExp(
      `^[ \\t]*[-*+][ \\t]+(?:[*_]{1,2})?${name}(?:[*_]{1,2})?[ \\t]*:[ \\t]*(?:[*_]{1,2}(?=[ \\t]))?[ \\t]*(.+)$`, 'mi',
    )) || [])[1]?.trim() ?? null;
    findings.push({
      id: `${lens}:${m[1]}`,
      kind: m[1].startsWith('R') ? 'root-cause' : 'finding',
      title: m[2].trim(),
      topics: field('Topics'),
      evidence: field('Evidence'),
      failure: field('Failure') ?? field('Chain of events'),
      confidence: field('Confidence'),
      severity: field('Severity'),
      marked_by_authors: field('Marked by authors'),
      status: 'unverified',
    });
  });
  return findings;
}

/** A malformed response is inconclusive, never a clean zero-finding review. */
function checkedFindings(markdown, lens) {
  const findings = parseFindings(markdown, lens);
  const heads = [...markdown.matchAll(/^#{1,6}\s+[FR]-\d+\b/gm)];
  const trimmed = markdown.trim();
  const explicitEmpty = /^NO_FINDINGS(?:\r?\n\s*## Not judgeable from this material(?:\r?\n|$)[\s\S]*)?$/.test(trimmed);
  if ((!findings.length && !explicitEmpty) || (findings.length && explicitEmpty) || heads.length !== findings.length
      || new Set(findings.map((f) => f.id)).size !== findings.length
      || findings.some((f) => !f.topics || !f.evidence || !f.failure)) {
    throw new Error(`lens ${lens}: inconclusive response; expected complete findings or explicit NO_FINDINGS`);
  }
  return findings;
}

function parseArgs(argv) {
  const opts = { lens: ['critical', 'premortem'], register: 'include', count: 15, dryRun: false, provider: 'gemini' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--lens') opts.lens = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--provider') opts.provider = next();
    else if (a === '--only') opts.only = next();
    else if (a === '--files-from') opts.filesFrom = next();
    else if (a === '--register') opts.register = next();
    else if (a === '--count') opts.count = Number(next());
    else if (a === '--out') opts.out = next();
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else rest.push(a);
  }
  if (rest.length !== 1) throw new Error('give exactly one corpus directory');
  if (!['include', 'strip'].includes(opts.register)) throw new Error('--register is include or strip');
  if (!['gemini', 'codex'].includes(opts.provider)) throw new Error('--provider is gemini or codex');
  if (!Number.isInteger(opts.count) || opts.count < 1) throw new Error('--count is a positive integer');
  opts.corpus = path.resolve(rest[0]);
  return opts;
}

function timeoutFromEnv(env = process.env) {
  const raw = env.DIAGRAM_REVIEW_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_TIMEOUT_MS;
  const ms = Number(raw);
  if (!Number.isInteger(ms) || ms < 1) throw new Error(`DIAGRAM_REVIEW_TIMEOUT_MS is a positive integer (got '${raw}')`);
  return ms;
}

/** One POST over node:http(s) with a single overall deadline. Resolves { status, json }.
 *  No socket idle timeout and no headers timeout: a thinking model sends nothing until it
 *  has finished, so the only limit that means anything is the total wall clock. */
function postJson(url, headers, body, timeoutMs) {
  const u = new URL(url);
  const lib = u.protocol === 'http:' ? http : https;
  const payload = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    const req = lib.request(u, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json', 'content-length': payload.length },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', (e) => finish(reject, e));
      res.on('end', () => {
        let json = {};
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* non-JSON error page */ }
        finish(resolve, { status: res.statusCode, json });
      });
    });
    const timer = setTimeout(() => {
      const err = new Error(`timed out after ${timeoutMs / 1000} s`);
      err.code = 'DEADLINE';
      finish(reject, err);
      req.destroy(err);
    }, timeoutMs);
    req.on('error', (e) => finish(reject, e));
    req.end(payload);
  });
}

/** A Gemini REST call. Only a retry that cannot double-bill is made: 429 (rejected before
 *  any work), and 5xx on countTokens (free). A 5xx, a timeout or a dropped connection on
 *  generateContent may follow a billed generation, so it fails at once for a human to rerun. */
async function gemini(method, model, key, body, opts = {}) {
  const api = opts.api ?? API;
  const timeoutMs = opts.timeoutMs ?? timeoutFromEnv();
  const retryDelayMs = opts.retryDelayMs ?? 5000;
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    let res;
    try {
      res = await postJson(`${api}/${model}:${method}`, { 'x-goog-api-key': key }, body, timeoutMs);
    } catch (err) {
      const secs = Math.round((Date.now() - started) / 1000);
      throw new Error(`${method}: ${err.message} (after ${secs} s; not retried${method === 'generateContent' ? ', it may already be billed' : ''})`);
    }
    if (res.status >= 200 && res.status < 300) return res.json;
    const retryable = res.status === 429 || (method === 'countTokens' && res.status >= 500);
    if (retryable && attempt < 2) {
      await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
      continue;
    }
    throw new Error(`${method} ${res.status}: ${JSON.stringify(res.json.error ?? res.json).slice(0, 400)}`);
  }
}

/** Read the Codex CLI's `--json` event stream the way mcp/consultants/codex/server.js does:
 *  `item.completed` agent messages are the reply, `turn.completed.usage` the token counts. */
function parseCodexStream(stdout) {
  const messages = [];
  let usage = null;
  let completed = false;
  for (const line of String(stdout).split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let obj;
    try { obj = JSON.parse(t); } catch { continue; }
    if (obj.type === 'item.completed' && obj.item && obj.item.type === 'agent_message' && obj.item.text) messages.push(obj.item.text);
    else if (obj.type === 'turn.completed') { completed = true; if (obj.usage) usage = obj.usage; }
  }
  return { text: messages.join('\n\n'), usage, completed };
}

/** Where the Codex login lives for this process: the consultant's AGENTBOX_CODEX_HOME if set,
 *  otherwise CODEX_HOME, the runner's own ~/.codex, then the legacy pseudo-user directory.
 *  Returns the first directory holding auth.json, or null (an OPENAI_API_KEY may still do). */
function codexHome(env = process.env) {
  const dirs = env.AGENTBOX_CODEX_HOME
    ? [env.AGENTBOX_CODEX_HOME]
    : [env.CODEX_HOME, env.HOME && path.join(env.HOME, '.codex'), '/home/openai-user/.codex'];
  return dirs.filter(Boolean).find((d) => fs.existsSync(path.join(d, 'auth.json'))) ?? null;
}

function codexBin(env = process.env) {
  return env.AGENTBOX_CODEX_BIN || (fs.existsSync('/usr/local/bin/codex') ? '/usr/local/bin/codex' : 'codex');
}

/** One `codex exec` call with the prompt on stdin (a pack is far over the argv limit). Resolves
 *  { text, usage, completed }. One deadline for the whole call; a timeout, a non-zero exit or a
 *  stream with no completed turn is an error, and the caller books it as possibly billed. */
function codex(model, prompt, opts = {}) {
  const bin = opts.bin ?? codexBin();
  const timeoutMs = opts.timeoutMs ?? timeoutFromEnv();
  const effort = opts.effort ?? process.env.DIAGRAM_REVIEW_THINKING ?? 'high';
  // `codex exec` is an agent, not a single completion. Contain it: an empty scratch working
  // directory, a read-only sandbox (no writes, no commands that change anything) and no session
  // file, so the private pack is not left under CODEX_HOME/sessions. It can still READ any file the
  // cron user can read; the instruction below is a prompt-level limit, not a technical one.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-audit-'));
  const args = ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '-C', scratch, '--model', model, '-c', `model_reasoning_effort="${effort}"`, '-'];
  const env = { ...process.env, AGENTBOX_AGENT_ID: 'diagram-review-audit' };
  const home = codexHome(process.env);
  if (home) env.CODEX_HOME = home;
  return new Promise((resolve, reject) => {
    let done = false;
    const out = [];
    const err = [];
    const child = (opts.spawn ?? spawn)(bin, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fs.rmSync(scratch, { recursive: true, force: true }); fn(v); } };
    const timer = setTimeout(() => {
      finish(reject, new Error(`codex exec timed out after ${timeoutMs / 1000} s (not retried, it may already be billed)`));
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (c) => out.push(c));
    child.stderr.on('data', (c) => err.push(c));
    child.on('error', (e) => finish(reject, new Error(`codex exec could not start: ${e.message}`)));
    child.on('close', (code) => {
      if (code !== 0) { finish(reject, new Error(`codex exec exited ${code}: ${Buffer.concat(err).toString('utf8').slice(0, 300)}`)); return; }
      const parsed = parseCodexStream(Buffer.concat(out).toString('utf8'));
      if (!parsed.completed) { finish(reject, new Error('codex exec ended without a completed turn')); return; }
      finish(resolve, parsed);
    });
    child.stdin.on('error', () => { /* the close handler reports the failure */ });
    child.stdin.end(prompt);
  });
}

function gitRev(dir) {
  try { return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

function gitDirty(dir) {
  try { return Boolean(execFileSync('git', ['-C', dir, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); }
  catch { return null; }
}

async function main(argv, deps = {}) {
  const opts = parseArgs(argv);
  const cfgPath = path.join(opts.corpus, 'diagrams.config.json');
  const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
  const files = listTopics(opts.corpus, { only: opts.only, skipDirs: cfg.skipDirs });
  if (opts.filesFrom) { // one shard of a sharded corpus: exactly the topics listed, one per line
    const want = new Set(fs.readFileSync(opts.filesFrom, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean));
    files.splice(0, files.length, ...files.filter((f) => want.has(f)));
  }
  if (files.length === 0) throw new Error(`no topic files under ${opts.corpus}${opts.only ? ` matching '${opts.only}'` : ''}`);
  const lenses = opts.lens.map((name) => ({ name, text: loadLens(name, opts.count) }));
  const pack = buildPack(opts.corpus, files, opts);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.resolve(opts.out || path.join('.diagram-review', stamp));
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'pack.txt'), pack);
  const manifest = {
    schema: 1, run_id: crypto.randomUUID(), reviewed_at: new Date().toISOString(), complete: false,
    corpus: opts.corpus, revision: gitRev(opts.corpus), dirty: gitDirty(opts.corpus), topics: files.length, only: opts.only ?? null,
    register: opts.register, pack_bytes: Buffer.byteLength(pack),
    pack_sha256: crypto.createHash('sha256').update(pack).digest('hex'), lenses: [],
  };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`packed ${files.length} topics, ${manifest.pack_bytes} bytes (register ${opts.register}) -> ${out}`);

  if (opts.dryRun) {
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`dry run: about ${Math.round(manifest.pack_bytes / 3.3)} tokens; nothing sent`);
    return 0;
  }
  const isCodex = opts.provider === 'codex';
  const key = isCodex ? null : (process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY);
  if (!isCodex && !key) throw new Error('set GEMINI_API_KEY (or GOOGLE_GEMINI_API_KEY) in the environment');
  const model = isCodex
    ? (process.env.DIAGRAM_REVIEW_MODEL || process.env.AGENTBOX_CODEX_MODEL || CODEX_DEFAULT_MODEL)
    : (process.env.DIAGRAM_REVIEW_MODEL || 'gemini-3.8-flash');
  const timeoutMs = timeoutFromEnv();
  manifest.model = model;
  manifest.provider = opts.provider;
  manifest.timeout_ms = timeoutMs;
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  const contentsFor = (lensText) => [{ role: 'user', parts: [{ text: pack }, { text: lensText }] }];
  if (isCodex) {
    // No free token-count call: size is estimated from bytes, and the model refuses an
    // over-long prompt by itself. The scheduled runner keeps each shard well inside the window.
    manifest.pack_tokens = Math.round(manifest.pack_bytes / 3.3);
    console.log(`pack about ${manifest.pack_tokens} tokens on ${model} (codex)`);
  } else {
    const { totalTokens } = await gemini('countTokens', model, key, { contents: contentsFor(lenses[0].text) }, { timeoutMs });
    manifest.pack_tokens = totalTokens;
    if (totalTokens > TOKEN_BUDGET) {
      const areas = [...new Set(files.map((f) => f.split('/')[0]))].join(', ');
      fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
      throw new Error(`pack is ${totalTokens} tokens, over the ${TOKEN_BUDGET} budget; review one area at a time with --only (areas: ${areas})`);
    }
    console.log(`pack ${totalTokens} tokens on ${model}`);
  }

  const findings = [];
  for (const lens of lenses) { // sequential: each lens after the first reads the pack from cache
    const started = Date.now();
    let text; let usage; let finish;
    if (isCodex) {
      // The pack first and the lens last, as for Gemini, so a provider cache can serve the pack.
      const r = await (deps.codex ?? codex)(model, `${CODEX_PREAMBLE}\n\n${pack}\n\n${lens.text}`, { timeoutMs });
      text = r.text;
      usage = r.usage ? {
        prompt_tokens: r.usage.input_tokens, cached_tokens: r.usage.cached_input_tokens ?? 0,
        // OpenAI counts reasoning inside output_tokens; recorded for information, not added again.
        thinking_tokens: 0, output_tokens: r.usage.output_tokens, reasoning_tokens: r.usage.reasoning_output_tokens ?? 0,
      } : {};
      finish = r.completed ? 'STOP' : null;
      if (!text) throw new Error(`lens ${lens.name}: empty reply`);
      fs.writeFileSync(path.join(out, `${lens.name}.md`), text.endsWith('\n') ? text : `${text}\n`);
      fs.writeFileSync(path.join(out, `${lens.name}.completion.json`), JSON.stringify({ finish_reason: finish, usage: r.usage ?? null }, null, 2) + '\n');
      if (finish !== 'STOP') throw new Error(`lens ${lens.name}: inconclusive, no completed turn`);
    } else {
      const res = await gemini('generateContent', model, key, {
        contents: contentsFor(lens.text),
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, thinkingConfig: { thinkingLevel: process.env.DIAGRAM_REVIEW_THINKING || 'high' }, temperature: 0 },
      }, { timeoutMs });
      text = res.candidates?.[0]?.content?.parts?.filter((p) => p.text && !p.thought).map((p) => p.text).join('') ?? '';
      if (!text) throw new Error(`lens ${lens.name}: empty reply (finishReason ${res.candidates?.[0]?.finishReason ?? 'none'})`);
      fs.writeFileSync(path.join(out, `${lens.name}.md`), text.endsWith('\n') ? text : `${text}\n`);
      fs.writeFileSync(path.join(out, `${lens.name}.completion.json`), JSON.stringify({ finish_reason: res.candidates?.[0]?.finishReason ?? null, usage: res.usageMetadata ?? null }, null, 2) + '\n');
      if (res.candidates?.[0]?.finishReason !== 'STOP') throw new Error(`lens ${lens.name}: inconclusive finishReason ${res.candidates?.[0]?.finishReason ?? 'missing'}`);
      const u = res.usageMetadata || {};
      usage = { prompt_tokens: u.promptTokenCount, cached_tokens: u.cachedContentTokenCount ?? 0, thinking_tokens: u.thoughtsTokenCount, output_tokens: u.candidatesTokenCount };
    }
    const origin = reviewContext({ pack, files, model, provider: isCodex ? 'codex' : 'gemini', revision: manifest.revision, dirty: manifest.dirty, register: opts.register, lens: lens.name, prompt: lens.text, runId: manifest.run_id, reviewedAt: manifest.reviewed_at });
    const parsed = checkedFindings(text, lens.name);
    findings.push(...parsed.map((f) => ({ ...f, origin })));
    manifest.lenses.push({
      name: lens.name, seconds: Math.round((Date.now() - started) / 100) / 10, findings: parsed.length, ...usage,
    });
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`${lens.name}: ${parsed.length} findings, ${manifest.lenses.at(-1).seconds} s, ${usage.cached_tokens ?? 0} tokens from cache`);
  }
  manifest.complete = true;
  fs.writeFileSync(path.join(out, 'findings.json'), JSON.stringify(findings, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote ${findings.length} unverified findings to ${path.join(out, 'findings.json')}`);
  return 0;
}

module.exports = {
  listTopics, stripRegister, buildPack, loadLens, parseFindings, checkedFindings, gitRev, gitDirty, parseArgs, gemini, codex, codexHome, codexBin, parseCodexStream, main, postJson, timeoutFromEnv, DEFAULT_TIMEOUT_MS, MAX_OUTPUT_TOKENS,
};

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
    console.error(`external-review: ${err.message}`);
    process.exit(/needs a value|unknown option|give exactly|is include|positive integer|unknown lens/.test(err.message) ? 2 : 1);
  });
}
