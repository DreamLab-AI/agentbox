#!/usr/bin/env node
'use strict';
/**
 * WHAT THIS IS
 *   The external review for a diagrams-as-code corpus. It packs the topic files (diagrams and
 *   prose only, never the code), sends the pack in one shot to a Gemini model with high
 *   thinking, once per review lens, and writes each review plus a findings list for triage.
 *   Zero dependencies, Node >= 18.
 *
 *     node external-review.cjs <corpus> [--lens critical,premortem] [--only <substr>]
 *          [--register include|strip] [--count 15] [--out <dir>] [--dry-run]
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
const { execFileSync } = require('node:child_process');

// Mirrors diagrams-as-code's diagram-index-gen.cjs so the review reads exactly the files that gate checks.
const DEFAULT_SKIP_DIRS = ['rendered', 'tools', 'scripts', 'hero', 'archive', 'src', 'assets', 'node_modules'];
const SKIP_FILES = new Set(['README.md', 'COVERAGE.md', 'REGISTER.md', 'DECISIONS-TIMELINE.md', 'CONTRIBUTING.md']);
const LENS_DIR = path.join(__dirname, '..', 'assets', 'lenses');
const API = 'https://generativelanguage.googleapis.com/v1beta/models';
// Gemini 3.8 Flash accepts 1,048,576 input tokens; leave room for the lens and the reply.
const TOKEN_BUDGET = 1_000_000;

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
    const field = (name) => (body.match(new RegExp(`^- ${name}:\\s*(.+)$`, 'mi')) || [])[1]?.trim() ?? null;
    findings.push({
      id: `${lens}:${m[1]}`,
      kind: m[1].startsWith('R') ? 'root-cause' : 'finding',
      title: m[2].trim(),
      topics: field('Topics'),
      evidence: field('Evidence'),
      failure: field('Failure') ?? field('Chain of events'),
      confidence: field('Confidence'),
      marked_by_authors: field('Marked by authors'),
      status: 'unverified',
    });
  });
  return findings;
}

function parseArgs(argv) {
  const opts = { lens: ['critical', 'premortem'], register: 'include', count: 15, dryRun: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--lens') opts.lens = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--only') opts.only = next();
    else if (a === '--register') opts.register = next();
    else if (a === '--count') opts.count = Number(next());
    else if (a === '--out') opts.out = next();
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else rest.push(a);
  }
  if (rest.length !== 1) throw new Error('give exactly one corpus directory');
  if (!['include', 'strip'].includes(opts.register)) throw new Error('--register is include or strip');
  if (!Number.isInteger(opts.count) || opts.count < 1) throw new Error('--count is a positive integer');
  opts.corpus = path.resolve(rest[0]);
  return opts;
}

async function gemini(method, model, key, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}/${model}:${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Number(process.env.DIAGRAM_REVIEW_TIMEOUT_MS || 600_000)),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return json;
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      continue;
    }
    throw new Error(`${method} ${res.status}: ${JSON.stringify(json.error ?? json).slice(0, 400)}`);
  }
}

function gitRev(dir) {
  try { return execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

async function main(argv) {
  const opts = parseArgs(argv);
  const cfgPath = path.join(opts.corpus, 'diagrams.config.json');
  const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
  const files = listTopics(opts.corpus, { only: opts.only, skipDirs: cfg.skipDirs });
  if (files.length === 0) throw new Error(`no topic files under ${opts.corpus}${opts.only ? ` matching '${opts.only}'` : ''}`);
  const lenses = opts.lens.map((name) => ({ name, text: loadLens(name, opts.count) }));
  const pack = buildPack(opts.corpus, files, opts);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.resolve(opts.out || path.join('.diagram-review', stamp));
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'pack.txt'), pack);
  const manifest = {
    corpus: opts.corpus, revision: gitRev(opts.corpus), topics: files.length, only: opts.only ?? null,
    register: opts.register, pack_bytes: Buffer.byteLength(pack),
    pack_sha256: crypto.createHash('sha256').update(pack).digest('hex'), lenses: [],
  };
  console.log(`packed ${files.length} topics, ${manifest.pack_bytes} bytes (register ${opts.register}) -> ${out}`);

  if (opts.dryRun) {
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`dry run: about ${Math.round(manifest.pack_bytes / 3.3)} tokens; nothing sent`);
    return 0;
  }
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
  if (!key) throw new Error('set GEMINI_API_KEY (or GOOGLE_GEMINI_API_KEY) in the environment');
  const model = process.env.DIAGRAM_REVIEW_MODEL || 'gemini-3.8-flash';
  manifest.model = model;

  const contentsFor = (lensText) => [{ role: 'user', parts: [{ text: pack }, { text: lensText }] }];
  const { totalTokens } = await gemini('countTokens', model, key, { contents: contentsFor(lenses[0].text) });
  manifest.pack_tokens = totalTokens;
  if (totalTokens > TOKEN_BUDGET) {
    const areas = [...new Set(files.map((f) => f.split('/')[0]))].join(', ');
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    throw new Error(`pack is ${totalTokens} tokens, over the ${TOKEN_BUDGET} budget; review one area at a time with --only (areas: ${areas})`);
  }
  console.log(`pack ${totalTokens} tokens on ${model}`);

  const findings = [];
  for (const lens of lenses) { // sequential: each lens after the first reads the pack from cache
    const started = Date.now();
    const res = await gemini('generateContent', model, key, {
      contents: contentsFor(lens.text),
      generationConfig: { thinkingConfig: { thinkingLevel: process.env.DIAGRAM_REVIEW_THINKING || 'high' }, temperature: 0 },
    });
    const text = res.candidates?.[0]?.content?.parts?.filter((p) => p.text && !p.thought).map((p) => p.text).join('') ?? '';
    if (!text) throw new Error(`lens ${lens.name}: empty reply (finishReason ${res.candidates?.[0]?.finishReason ?? 'none'})`);
    fs.writeFileSync(path.join(out, `${lens.name}.md`), text.endsWith('\n') ? text : `${text}\n`);
    const parsed = parseFindings(text, lens.name);
    findings.push(...parsed);
    const u = res.usageMetadata || {};
    manifest.lenses.push({
      name: lens.name, seconds: Math.round((Date.now() - started) / 100) / 10, findings: parsed.length,
      prompt_tokens: u.promptTokenCount, cached_tokens: u.cachedContentTokenCount ?? 0,
      thinking_tokens: u.thoughtsTokenCount, output_tokens: u.candidatesTokenCount,
    });
    console.log(`${lens.name}: ${parsed.length} findings, ${manifest.lenses.at(-1).seconds} s, ${u.cachedContentTokenCount ?? 0} tokens from cache`);
  }
  fs.writeFileSync(path.join(out, 'findings.json'), JSON.stringify(findings, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote ${findings.length} unverified findings to ${path.join(out, 'findings.json')}`);
  return 0;
}

module.exports = { listTopics, stripRegister, buildPack, loadLens, parseFindings, parseArgs };

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
    console.error(`external-review: ${err.message}`);
    process.exit(/needs a value|unknown option|give exactly|is include|positive integer|unknown lens/.test(err.message) ? 2 : 1);
  });
}
