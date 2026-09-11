#!/usr/bin/env node
// Draft explainer sections on the LAN model (the connected node, Qwen3.8-27B) through the Ontology Loom
// façade, with the scaffold declined per request (ADR-139: `loom_options.scaffold=false`).
// The façade is the estate's stable model door; the option makes it a plain proxy for a
// subject the ontology does not cover. Without it, verbatim mode answered a packet about
// `pnpm verify` with the blockchain 'Node' class (2026-09-09). The direct model port on the
// 25G rail remains a fallback for hosts that can reach it (EXPLAINER_MODEL_BASE).
// Long-running, sequential, resumable: meant to run in the background (nohup / tmux) so
// the expensive session model only orients, checks and decides.
//
//   node loom-draft.mjs --packet p.json [--out p.out.json]           one section
//   node loom-draft.mjs --batch packets/ --out-dir drafts/            every *.json, skips done
//   options: --base <url> (env EXPLAINER_MODEL_BASE, else LOOM_BASE_URL, else the
//            sidecar default below; a directly reachable model port also works)  --model <id or auto>  --max-tokens 1400
//            --system <file>  --template <file>  --review <draft.json>  --timeout 900
//
// A packet is the JSON described in ../references/microsite/qwen-prompting.md. The
// response must be one JSON object with status/reader_text/claims/requests; a truncated
// answer (finish_reason=length) is retried with a larger budget, never accepted.
// Zero dependencies. Node 18+.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const base = (opt('base', process.env.EXPLAINER_MODEL_BASE || process.env.LOOM_BASE_URL || 'http://loom:8080/v1')).replace(/\/$/, '');
const systemText = readFileSync(opt('system', join(here, '../references/microsite/prompts/qwen-system.txt')), 'utf8');
const templateText = readFileSync(opt('template', join(here, opt('review') ? '../references/microsite/prompts/qwen-review.txt' : '../references/microsite/prompts/qwen-section.txt')), 'utf8');
const timeoutMs = Number(opt('timeout', 900)) * 1000;
let maxTokens = Number(opt('max-tokens', 1400));

async function modelId() {
  const m = opt('model', 'auto');
  if (m !== 'auto') return m;
  const r = await fetch(base + '/models'); const j = await r.json();
  return j.data?.[0]?.id || j.models?.[0]?.name;
}

function fill(template, packet, draft) {
  return template
    .replace('{{evidence_packet}}', JSON.stringify(packet, null, 2))
    .replace('{{draft_json}}', draft ? JSON.stringify(draft, null, 2) : '')
    .replace('{{review_notes}}', packet.review_notes ? JSON.stringify(packet.review_notes, null, 2) : 'none');
}

function parseJson(text) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = t.indexOf('{'); const end = t.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('no JSON object in response');
  const obj = JSON.parse(t.slice(start, end + 1));
  for (const k of ['status', 'reader_text', 'claims']) if (!(k in obj)) throw new Error(`response lacks ${k}`);
  if (!['needs_evidence', 'draft', 'blocked'].includes(obj.status)) throw new Error(`bad status ${obj.status}`);
  return obj;
}

async function draftOne(packetPath, outPath, model) {
  const packet = JSON.parse(readFileSync(packetPath, 'utf8'));
  const draft = opt('review') ? JSON.parse(readFileSync(opt('review'), 'utf8')) : null;
  const user = fill(templateText, packet, draft);
  if (/\{\{[a-z_]+\}\}/.test(user)) throw new Error('unresolved template field');
  let budget = maxTokens;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = Date.now();
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(base + '/chat/completions', {
        method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, temperature: 0, max_tokens: budget, stream: false,
          // The Loom strips this before delegating; a bare llama.cpp server ignores it.
          loom_options: { scaffold: false, verbatim: false },
          chat_template_kwargs: { enable_thinking: false },
          messages: [{ role: 'system', content: systemText }, { role: 'user', content: user }] }),
      });
    } finally { clearTimeout(timer); }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = await res.json();
    const choice = body.choices?.[0];
    const ms = Date.now() - started;
    const usage = body.usage || {};
    if (choice?.finish_reason === 'length') {
      console.error(`${basename(packetPath)}: truncated at ${budget} tokens (${ms} ms), retrying with ${budget * 2}`);
      budget *= 2; continue;
    }
    let result;
    try { result = parseJson(choice.message.content); }
    catch (e) { writeFileSync(outPath.replace(/\.json$/, '.raw.json'), JSON.stringify(body, null, 2)); throw new Error(`${e.message}; raw response saved beside the output`); }
    const receipt = { packet: basename(packetPath), model: body.model || model, base, attempt, max_tokens: budget,
      finish_reason: choice.finish_reason, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens,
      ms, loom: body.loom ? { served_mode: body.loom.served_mode, grounding_status: body.loom.grounding?.status } : undefined };
    if (body.loom && body.loom.served_mode !== 'passthrough') {
      throw new Error(`the façade did not pass the request through (served_mode=${body.loom.served_mode}); it needs the ADR-139 build`);
    }
    writeFileSync(outPath, JSON.stringify({ result, receipt }, null, 2) + '\n');
    console.log(`${basename(packetPath)}: ${result.status}, ${result.claims.length} claims, ${usage.completion_tokens ?? '?'} tokens, ${(ms / 1000).toFixed(1)} s → ${outPath}`);
    return result;
  }
  throw new Error(`${basename(packetPath)}: still truncated after 3 attempts`);
}

const model = await modelId();
if (opt('batch')) {
  const dir = opt('batch'); const outDir = opt('out-dir', join(dir, 'drafts')); mkdirSync(outDir, { recursive: true });
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  let done = 0, failed = 0;
  for (const f of files) {
    const out = join(outDir, f.replace(/\.json$/, '.out.json'));
    if (existsSync(out)) { console.log(`${f}: exists, skipped`); continue; }
    try { await draftOne(join(dir, f), out, model); done++; }
    catch (e) { failed++; console.error(`${f}: FAILED ${e.message}`); }
  }
  console.log(`batch complete: ${done} drafted, ${failed} failed, model ${model}`);
  process.exit(failed ? 1 : 0);
} else if (opt('packet')) {
  await draftOne(opt('packet'), opt('out', opt('packet').replace(/\.json$/, '.out.json')), model);
} else {
  console.error('usage: --packet p.json | --batch dir'); process.exit(2);
}
