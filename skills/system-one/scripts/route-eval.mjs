#!/usr/bin/env node
// route-eval.mjs — measure how well skill DESCRIPTIONS discriminate, using a
// System One Choice over the skill fleet as the instrument (ADR pending).
//
// This is a MEASUREMENT RIG, not a runtime router. It sends only this repo's own
// skill descriptions plus the labelled prompts in the item file — public content
// by the classification in ../references/data-boundary.md. It never sees a real
// user turn. Keep it that way: pointing this at live session prompts is the
// egress decision that file says must be made explicitly.
//
//   node route-eval.mjs --items items.json [--desc-max N] [--reps N]
//                       [--only a,b,c] [--json out.json] [--override skill=file]
//
// Zero dependency, Node >= 18 (global fetch). Reads TYPESAFE_API_KEY.
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS = resolve(HERE, '..', '..');
const API = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i === -1 ? d : argv[i + 1]; };
const itemsPath = arg('--items', join(HERE, 'items.json'));
const descMax = Number(arg('--desc-max', 0)) || 0;
const reps = Number(arg('--reps', 1));
const only = arg('--only', '') ? arg('--only').split(',') : null;
const jsonOut = arg('--json', '');
const overrides = argv.filter((a, i) => argv[i - 1] === '--override').map(s => s.split('='));

const key = process.env.TYPESAFE_API_KEY;
if (!key) { console.error('TYPESAFE_API_KEY not set — refusing to run.'); process.exit(2); }

/** Frontmatter `description`, folded block or quoted scalar. */
function description(md) {
  const folded = md.match(/^description:\s*(?:>-|>|\|)\s*\n((?:[ \t]+.*\n)+)/m);
  if (folded) return folded[1].split('\n').map(l => l.trim()).filter(Boolean).join(' ');
  const scalar = md.match(/^description:\s*"([\s\S]*?)"\s*$/m) || md.match(/^description:\s*(.+)$/m);
  return scalar ? scalar[1].trim() : null;
}

const criteria = {};
for (const d of readdirSync(SKILLS, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  const p = join(SKILLS, d.name, 'SKILL.md');
  if (!existsSync(p)) continue;
  if (only && !only.includes(d.name)) continue;
  const md = readFileSync(p, 'utf8');
  let desc = description(md);
  if (!desc) continue;
  // Availability is part of the contract (frontmatter `status`), but it lives outside
  // the description text. Compose it in at the point of use rather than baking a status
  // sentence into every skill's prose — one source, rendered per consumer.
  const st = (md.match(/^status:\s*(.+)$/m) || [, 'live'])[1].trim();
  const rep = (md.match(/^replacement:\s*(.+)$/m) || [, ''])[1].trim();
  if (st !== 'live' && st !== 'foundation') {
    const note = { superseded: `SUPERSEDED${rep ? ` by \`${rep}\`` : ''} — do not choose for new work.`,
                   deprecated: `DEPRECATED${rep ? ` — use \`${rep}\`` : ''}. Do not choose.`,
                   'not-installed': 'NOT INSTALLED in this environment — do not choose unless the user has installed it.',
                   'router-only': 'ROUTER ONLY — dispatches to another skill rather than doing the work.',
                   gated: 'GATED OFF by default in this environment — do not choose unless its manifest gate is enabled.' }[st];
    if (note) desc = `${note} ${desc}`;
  }
  if (descMax && desc.length > descMax) desc = desc.slice(0, descMax) + ' …';
  criteria[d.name] = desc;
}
for (const [name, file] of overrides) criteria[name] = readFileSync(file, 'utf8').trim();

const items = JSON.parse(readFileSync(itemsPath, 'utf8')).items;
const missing = [...new Set(items.map(i => i.truth))].filter(t => !(t in criteria));
if (missing.length) { console.error('items reference skills absent from candidates:', missing.join(', ')); process.exit(2); }

const INSTRUCTIONS =
  'Which skill should handle `user_request`? Choose the single best fit, honouring each option\'s stated when-NOT-to-use boundaries.';

async function ask(prompt) {
  const body = { state: { user_request: prompt }, model: MODEL,
    questions: { skill: { type: 'choice', instructions: INSTRUCTIONS, criteria } } };
  for (let attempt = 0; attempt < 4; attempt++) {
    const t0 = Date.now();
    const res = await fetch(API, { method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body) });
    if (res.status === 429 || res.status === 529) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json();
    return { ...j.answers.skill, ms: Date.now() - t0, usage: j.usage };
  }
  throw new Error('exhausted retries (429/529)');
}

const results = [];
let tin = 0, tout = 0, wall = 0, calls = 0;
for (const it of items) {
  const picks = [];
  for (let r = 0; r < reps; r++) {
    const a = await ask(it.prompt);
    picks.push({ pick: a.choice, conf: a.confidence, probs: a.probabilities });
    tin += a.usage.input_tokens; tout += a.usage.output_tokens; wall += a.ms; calls++;
  }
  const hits = picks.filter(p => p.pick === it.truth).length;
  results.push({ ...it, picks, hits, soft: hits / reps, majority: picks[0].pick });
}

const tiers = [...new Set(items.map(i => i.tier))].sort();
const pct = (n, d) => d ? `${(100 * n / d).toFixed(0)}%` : '—';
console.log(`candidates: ${Object.keys(criteria).length}  items: ${items.length}  reps: ${reps}` +
            (descMax ? `  desc-max: ${descMax}` : '  desc: full'));
console.log('');
for (const t of tiers) {
  const rs = results.filter(r => r.tier === t);
  const soft = rs.reduce((a, r) => a + r.soft, 0);
  console.log(`  tier ${t.padEnd(26)} ${soft.toFixed(1)}/${rs.length}  ${pct(soft, rs.length)}`);
}
const softAll = results.reduce((a, r) => a + r.soft, 0);
console.log(`  ${'OVERALL'.padEnd(31)} ${softAll.toFixed(1)}/${results.length}  ${pct(softAll, results.length)}`);
console.log(`\n  ${(tin / calls).toFixed(0)} input tok/call · ${(tout / calls).toFixed(0)} output · ` +
            `${(wall / calls).toFixed(0)} ms/call · ${calls} calls · ${tin} input tokens total`);

const bad = results.filter(r => r.soft < 1);
if (bad.length) {
  console.log(`\n  misses (${bad.length}):`);
  for (const r of bad) {
    const top = Object.entries(r.picks[0].probs).sort((a, b) => b[1] - a[1]).slice(0, 2);
    console.log(`    [${r.tier}] ${r.truth} → ${r.majority} (${r.soft.toFixed(2)} soft) ` +
                `| top: ${top.map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')}`);
    console.log(`        "${r.prompt.slice(0, 96)}${r.prompt.length > 96 ? '…' : ''}"`);
  }
}
if (jsonOut) { writeFileSync(jsonOut, JSON.stringify({ descMax, reps, candidates: Object.keys(criteria).length, results }, null, 2)); console.log(`\n  wrote ${jsonOut}`); }
