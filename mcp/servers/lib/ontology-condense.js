'use strict';
// ontology-condense.js — config-driven cheap-LLM condensation of ontology class
// records (PRD-020 WS-2 / ADR-113). Replaces the one-off Haiku mesh with a
// pluggable local-LLM step: for each class record emitted by
// ontology-index-build.js, ask a cheap LLM for ONE retrieval-optimised sentence
// + a synonym list, producing the ONTOLOGY_ALIASES map that index-build folds
// into the PUSH Class-Summary cache (and the condensed records the re-index
// orchestration stores in RuVector ns:ontology-classes for semantic recall).
//
// The endpoint is OPERATOR-SUPPLIED (vanilla agentbox ships this OFF). Config
// comes from env, derived at boot from [skills.ontology.condense] in
// agentbox.toml. Two request styles:
//   - openai : POST {endpoint}/chat/completions  (DiffusionGemma, vLLM, LM Studio…)
//   - ollama : POST {endpoint}/api/chat
//
// DiffusionGemma constraint (DiffusionGemma-INTEGRATION.md): the server holds a
// single model context and SERIALISES requests — concurrency MUST be 1, never
// fan out. Its "thinking" can also leak into message.content prefixed with a
// `<|channel>thought` marker; stripThinking() removes it. Sampling knobs
// (temperature/top_p) are ignored by the diffusion sampler; n_blocks sizes the
// answer (256 tok/block).
//
// CLI: node ontology-condense.js [classesJson] [outAliasesJson] [outCondensedJson]
//   classesJson      defaults to /tmp/onto-classes.json (ontology-index-build out)
//   outAliasesJson   defaults to $ONTOLOGY_ALIASES or /tmp/onto-aliases.json
//   outCondensedJson defaults to /tmp/onto-condensed.json
// Fail-soft per class: a class that errors keeps its deterministic terms (no
// aliases added) so a partial run still improves the cache monotonically.

const fs = require('fs');

// ---------- config ----------
function readConfig(env = process.env) {
  const style = (env.ONTOLOGY_CONDENSE_STYLE || 'openai').toLowerCase();
  return {
    enabled: /^(1|true|yes)$/i.test(String(env.ONTOLOGY_CONDENSE_ENABLED || '')),
    endpoint: (env.ONTOLOGY_CONDENSE_ENDPOINT || '').replace(/\/+$/, ''),
    model: env.ONTOLOGY_CONDENSE_MODEL || '',
    style: style === 'ollama' ? 'ollama' : 'openai',
    nBlocks: parseInt(env.ONTOLOGY_CONDENSE_N_BLOCKS || '2', 10),
    concurrency: Math.max(1, parseInt(env.ONTOLOGY_CONDENSE_CONCURRENCY || '1', 10)),
    timeoutMs: parseInt(env.ONTOLOGY_CONDENSE_TIMEOUT_MS || '60000', 10),
    maxSynonyms: parseInt(env.ONTOLOGY_CONDENSE_MAX_SYNONYMS || '12', 10),
  };
}

// ---------- prompt ----------
const SYSTEM_PROMPT =
  'You condense a knowledge-graph class into search-optimised text. Output ONLY ' +
  'the final answer — no preamble, no reasoning, no markdown. Exactly two lines:\n' +
  'Line 1: one tight sentence (<=30 words) capturing what the class IS, for retrieval.\n' +
  'Line 2: "SYNONYMS: " then a comma-separated list of alternative terms, acronyms, ' +
  'and closely-related search phrases (lowercase, no duplicates of the label).';

function buildUserPrompt(rec) {
  const rels = (rec.relations || []).slice(0, 10).map((r) => `${r.type} ${r.label}`).join('; ');
  const parents = (rec.parents || []).join(', ');
  return [
    `Class: ${rec.label || rec.slug || rec.iri}`,
    rec.domain ? `Domain: ${rec.domain}` : '',
    parents ? `Parent(s): ${parents}` : '',
    rec.definition ? `Definition: ${rec.definition}` : '',
    rels ? `Relations: ${rels}` : '',
  ].filter(Boolean).join('\n');
}

// ---------- response cleaning ----------
// DiffusionGemma sometimes emits its scratch-thinking into content prefixed with
// a channel marker, e.g. "<|channel>thought ... <|channel>final ...". Take the
// text after the LAST channel marker; strip any leading bullet/think scaffold.
function stripThinking(text) {
  if (!text) return '';
  let t = String(text);
  // If channel markers exist, keep only the final channel's content.
  const markers = [...t.matchAll(/<\|channel\|?>?\s*\w+/gi)];
  if (markers.length) {
    const last = markers[markers.length - 1];
    t = t.slice(last.index + last[0].length);
  }
  // Drop common reasoning scaffolding lines.
  t = t.replace(/^\s*(thought|thinking|reasoning|analysis|final)\b[:>]?/i, '');
  return t.trim();
}

// Parse the cleaned two-line answer into { summary, synonyms[] }.
const ECHO_LINE = /^(class|domain|parent|parents|relation|relations|subclass|maturity)(\([^)]*\))?\s*[:\-]/i;
function parseCondensed(text, maxSynonyms = 12) {
  const clean = stripThinking(text);
  const lines = clean.split('\n')
    .map((l) => l.trim().replace(/^[*_>\s-]+/, '').replace(/[`*_]/g, '').trim())
    .filter(Boolean)
    .filter((l) => !ECHO_LINE.test(l)); // drop echoed input headers (Class:, Domain:, …)
  let summary = '';
  let synonyms = [];
  for (const ln of lines) {
    const m = ln.match(/^syn(?:onyms?)?\s*[:\-]\s*(.+)$/i);
    if (m) {
      synonyms = m[1]
        .split(/[,;]/)
        .map((s) => s.replace(/^[-*\s]+/, '').trim().toLowerCase())
        .filter((s) => s && s.length > 1);
    } else if (!summary) {
      summary = ln.replace(/^[-*\s]+/, '').replace(/^(summary|definition)\s*[:\-]\s*/i, '').trim();
    }
  }
  // Dedup synonyms, drop ones identical to the summary, cap.
  const seen = new Set();
  synonyms = synonyms.filter((s) => (seen.has(s) ? false : (seen.add(s), true))).slice(0, maxSynonyms);
  return { summary, synonyms };
}

// ---------- transport ----------
function buildRequest(cfg, rec) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(rec) },
  ];
  if (cfg.style === 'ollama') {
    return {
      path: '/api/chat',
      body: { model: cfg.model || undefined, messages, stream: false, options: { temperature: 0 } },
      pick: (j) => (j && j.message && j.message.content) || '',
    };
  }
  // openai-compatible (DiffusionGemma honours n_blocks; others ignore it)
  return {
    path: '/chat/completions',
    body: { model: cfg.model || undefined, messages, n_blocks: cfg.nBlocks, seed: 0, stream: false, temperature: 0 },
    pick: (j) => {
      const m = j && j.choices && j.choices[0] && j.choices[0].message;
      return (m && m.content) || '';
    },
  };
}

async function condenseOne(rec, cfg, fetchImpl = fetch) {
  const req = buildRequest(cfg, rec);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetchImpl(`${cfg.endpoint}${req.path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { iri: rec.iri, error: `http_${res.status}`, detail: t.slice(0, 200) };
    }
    const json = await res.json();
    const raw = req.pick(json);
    const { summary, synonyms } = parseCondensed(raw, cfg.maxSynonyms);
    if (!summary && !synonyms.length) return { iri: rec.iri, error: 'empty_condensation' };
    return { iri: rec.iri, label: rec.label, domain: rec.domain, maturity: rec.maturity, summary, synonyms };
  } catch (err) {
    return { iri: rec.iri, error: err.name === 'AbortError' ? 'timeout' : 'unreachable', detail: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Condense an array of class records, serialised per `concurrency` (1 for a
 * single-context diffusion server). Returns { condensed:[], aliases:{iri:[...]},
 * ok, failed }. `onProgress(done,total,rec)` is optional.
 */
async function condenseAll(records, opts = {}) {
  const cfg = { ...readConfig(opts.env || process.env), ...(opts.cfg || {}) };
  const fetchImpl = opts.fetchImpl || fetch;
  const onProgress = opts.onProgress || (() => {});
  const condensed = [];
  const aliases = {};
  let ok = 0, failed = 0, done = 0;
  const total = records.length;

  const queue = records.slice();
  async function worker() {
    for (;;) {
      const rec = queue.shift();
      if (!rec) return;
      const r = await condenseOne(rec, cfg, fetchImpl);
      done++;
      if (r.error) { failed++; }
      else {
        ok++;
        condensed.push(r);
        if (r.synonyms && r.synonyms.length) aliases[r.iri] = r.synonyms;
      }
      onProgress(done, total, r);
    }
  }
  const lanes = Math.max(1, Math.min(cfg.concurrency, total || 1));
  await Promise.all(Array.from({ length: lanes }, () => worker()));
  return { condensed, aliases, ok, failed, total };
}

// ---------- CLI ----------
async function main() {
  const cfg = readConfig();
  if (!cfg.enabled) {
    console.error('[ontology-condense] disabled (ONTOLOGY_CONDENSE_ENABLED not set) — no-op.');
    process.exit(0);
  }
  if (!cfg.endpoint) {
    console.error('[ontology-condense] ONTOLOGY_CONDENSE_ENDPOINT is required when enabled.');
    process.exit(2);
  }
  const classesPath = process.argv[2] || '/tmp/onto-classes.json';
  const outAliases = process.argv[3] || process.env.ONTOLOGY_ALIASES || '/tmp/onto-aliases.json';
  const outCondensed = process.argv[4] || '/tmp/onto-condensed.json';
  const limit = parseInt(process.env.ONTOLOGY_CONDENSE_LIMIT || '0', 10); // 0 = all

  let records = JSON.parse(fs.readFileSync(classesPath, 'utf8'));
  if (!Array.isArray(records)) records = records.classes || [];
  if (limit > 0) records = records.slice(0, limit);

  // Resume: a 7k-class run is hours long, so reload any prior condensed output
  // and skip IRIs already done (idempotent, crash-safe, monotonic).
  const condensedByIri = new Map();
  try {
    for (const c of JSON.parse(fs.readFileSync(outCondensed, 'utf8'))) condensedByIri.set(c.iri, c);
  } catch { /* no checkpoint yet */ }
  const before = condensedByIri.size;
  const todo = records.filter((r) => !condensedByIri.has(r.iri));

  const flush = () => {
    const condensed = [...condensedByIri.values()];
    const aliases = {};
    for (const c of condensed) if (c.synonyms && c.synonyms.length) aliases[c.iri] = c.synonyms;
    fs.writeFileSync(outCondensed, JSON.stringify(condensed));
    fs.writeFileSync(outAliases, JSON.stringify(aliases));
    return { condensed, aliases };
  };

  const t0 = Date.now();
  console.error(`[ontology-condense] ${records.length} classes (${before} already done, ${todo.length} to do) via ${cfg.style} ${cfg.endpoint} model=${cfg.model || '(default)'} concurrency=${cfg.concurrency}`);
  let liveOk = 0, liveFail = 0;
  await condenseAll(todo, {
    cfg,
    onProgress: (done, tot, r) => {
      if (r && r.error) { liveFail++; }
      else { liveOk++; condensedByIri.set(r.iri, r); }
      if (done % 50 === 0 || done === tot) {
        const rate = done / Math.max(1, (Date.now() - t0) / 1000);
        const eta = rate > 0 ? Math.round((tot - done) / rate) : 0;
        process.stderr.write(`\r  ${done}/${tot}  ok=${liveOk} fail=${liveFail}  ${rate.toFixed(2)}/s  eta=${Math.floor(eta / 60)}m   `);
        flush(); // checkpoint
      }
    },
  });
  process.stderr.write('\n');
  const { aliases } = flush();
  console.error(JSON.stringify({
    total: records.length, condensed_total: condensedByIri.size,
    new_ok: liveOk, new_failed: liveFail, resumed_from: before,
    aliases_classes: Object.keys(aliases).length,
    out_aliases: outAliases, out_condensed: outCondensed,
    elapsed_s: Math.round((Date.now() - t0) / 1000),
  }, null, 2));
}

if (require.main === module) {
  main().catch((e) => { console.error('[ontology-condense] fatal:', e.message); process.exit(1); });
}

module.exports = {
  readConfig, buildUserPrompt, buildRequest, stripThinking, parseCondensed,
  condenseOne, condenseAll, SYSTEM_PROMPT,
};
