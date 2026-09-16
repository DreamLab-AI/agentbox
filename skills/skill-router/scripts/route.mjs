#!/usr/bin/env node
// route.mjs — the /route slash command's dispatcher (ADR-2091).
//
//   node route.mjs "<describe the task>"          → ranked picks, or a fallback line
//   node route.mjs --json "<task>"                → the raw outcome object
//   node route.mjs --router table "<task>"        → force the pre-2091 path
//   node route.mjs --eval items.json [--reps 3]   → accuracy of THIS runtime path
//                                                   (candidate exclusions + `none`)
//
// Shares config/hooks/lib/skill-route.cjs with the UserPromptSubmit hook, so the
// wire shape, the candidate map and the fail-open rules live in one place. Exit
// code is 0 whenever a decision was reached, including "fall back to the table":
// a fallback is the normal path when the judge is slow or off, not an error.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Baked layout first (/opt/agentbox/config/hooks/lib), then the repo checkout
// relative to skills/skill-router/scripts, then an explicit override.
const LIB_CANDIDATES = [
  process.env.AGENTBOX_HOOKS_DIR && resolve(process.env.AGENTBOX_HOOKS_DIR, 'lib', 'skill-route.cjs'),
  '/opt/agentbox/config/hooks/lib/skill-route.cjs',
  resolve(HERE, '..', '..', '..', 'config', 'hooks', 'lib', 'skill-route.cjs'),
].filter(Boolean);
const libPath = LIB_CANDIDATES.find((p) => existsSync(p));
if (!libPath) {
  console.log('router: table (fallback: skill-route library not found) — read references/routing-table.md');
  process.exit(0);
}
const lib = require(libPath);

const argv = process.argv.slice(2);
const flag = (k) => { const i = argv.indexOf(k); if (i === -1) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const has = (k) => { const i = argv.indexOf(k); if (i === -1) return false; argv.splice(i, 1); return true; };
const asJson = has('--json');
const forced = flag('--router');
const evalPath = flag('--eval');
const reps = Number(flag('--reps') || 1);

const env = { ...process.env };
if (forced) env.AGENTBOX_SKILL_ROUTER = forced;
// Running from a repo checkout with no baked tree: route over the checkout.
const repoSkills = resolve(HERE, '..', '..');
if (!env.AGENTBOX_SKILL_ROUTE_SKILLS_DIR && existsSync(resolve(repoSkills, 'skill-router', 'SKILL.md'))
    && !existsSync('/opt/agentbox/skills/skill-router/SKILL.md')) env.AGENTBOX_SKILL_ROUTE_SKILLS_DIR = repoSkills;
// An unbooted shell (no AGENTBOX_SKILL_ROUTER in env) reads the manifest directly.
const tomlFallback = [env.AGENTBOX_CONFIG, resolve(HERE, '..', '..', '..', 'agentbox.toml'), '/etc/agentbox.toml']
  .find((p) => p && existsSync(p));
const cfg = lib.config(env, { fallbackToml: tomlFallback });

const fmtUsd = (u) => `$${u.toFixed(6)}`;

if (evalPath) {
  // Runtime-path eval: same items file as the measurement rig, but through THIS
  // candidate map (exclusions applied, `none` present). Reported separately from
  // the rig's number on purpose — they answer different questions.
  const items = JSON.parse(readFileSync(evalPath, 'utf8')).items;
  const candidates = lib.loadCandidates(cfg.skillsDir);
  let hits = 0, none = 0, failed = 0, usd = 0, ms = 0, calls = 0;
  const misses = [];
  for (const it of items) {
    let h = 0;
    for (let r = 0; r < reps; r++) {
      const a = await lib.route(it.prompt, cfg, { retries: 2, candidates });
      calls++;
      if (a.outcome !== 'routed') { failed++; continue; }
      usd += a.usd; ms += a.ms;
      if (a.choice === it.truth) h++; else if (a.none) none++;
      if (a.choice !== it.truth && r === 0) misses.push(`${it.truth} → ${a.choice} (p=${(a.ranked[0] || [0, 0])[1].toFixed(2)}) "${it.prompt.slice(0, 80)}…"`);
    }
    hits += h / reps;
  }
  console.log(`runtime route eval: ${Object.keys(candidates).length} candidates + none · ${items.length} items · reps ${reps}`);
  console.log(`  soft accuracy ${hits.toFixed(1)}/${items.length} (${(100 * hits / items.length).toFixed(0)}%) · none-picks ${none} · failed calls ${failed}/${calls}`);
  console.log(`  ${(ms / Math.max(1, calls - failed)).toFixed(0)} ms/call · ${fmtUsd(usd)} total · ${fmtUsd(usd / Math.max(1, calls - failed))}/call`);
  if (misses.length) { console.log('  misses (first rep):'); for (const m of misses) console.log(`    ${m}`); }
  process.exit(0);
}

const task = argv.join(' ').trim();
if (!task) {
  console.log('usage: route.mjs "<describe the task>"  (no argument → the skill shows its menu)');
  process.exit(0);
}

const r = await lib.route(task, cfg, { retries: 2 });
lib.appendLog(cfg, { ...r, consumer: 'cli' });
if (asJson) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }

if (r.outcome !== 'routed') {
  const why = r.outcome === 'skipped' ? `${r.reason}${r.router ? ` (router=${r.router})` : ''}` : `judge ${r.reason}`;
  console.log(`router: table (fallback: ${why}) — classify against references/routing-table.md`);
  process.exit(0);
}
const top = r.ranked.filter(([k]) => k !== lib.NONE).slice(0, 5);
console.log(`router: jev (${r.model}) · ${r.ms} ms · ${r.usage.input_tokens} input tokens (${fmtUsd(r.usd)}) · ${r.candidates} candidates`);
top.forEach(([k, v], i) => console.log(`  ${i + 1}. ${k.padEnd(34)} ${v.toFixed(2)}`));
if (r.none) console.log(`dispatch: none (p=${(r.ranked.find(([k]) => k === lib.NONE) || [0, 0])[1].toFixed(2)}) — answer directly, or read the routing table if that seems wrong`);
else console.log(`dispatch: ${r.choice}`);
