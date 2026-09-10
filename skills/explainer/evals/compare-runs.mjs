#!/usr/bin/env node
// Compare two eval runs side by side on what a script can settle, and refuse the comparison
// when the two runs were not given the same task. Reads each run through grade-run.mjs.
//
//   compare-runs.mjs --a DIR --b DIR [--repo DIR] [--json] [--force]
//
// Exit codes: 0 comparable, 1 the runs differ in inputs (use --force to compare anyway), 2 usage.
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const args = (() => { const a = {}; const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) { if (!v[i].startsWith('--')) continue; const k = v[i].slice(2), n = v[i + 1]; a[k] = n === undefined || n.startsWith('--') ? true : (i++, n); } return a; })();
if (!args.a || !args.b) { console.error('usage: compare-runs.mjs --a DIR --b DIR [--repo DIR] [--json] [--force]'); process.exit(2); }
const grader = join(dirname(new URL(import.meta.url).pathname), 'grade-run.mjs');
const measure = (d) => {
  const out = execFileSync('node', [grader, '--run', resolve(d), ...(args.repo ? ['--repo', resolve(args.repo)] : []), '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out);
};
const A = measure(args.a), B = measure(args.b);

// The comparison is only meaningful when the task was identical. Skill root must differ.
const timing = (m) => ({ prompt: m.prompt_sha256 ?? null, root: m.skills_root_hash ?? null });
const warnings = [];
const rd = (m, k) => m[k] ?? null;
if (A.prompt_sha256 && B.prompt_sha256 && A.prompt_sha256 !== B.prompt_sha256) warnings.push(`different prompts (${A.prompt_sha256} vs ${B.prompt_sha256})`);
if (A.skills_root_hash && A.skills_root_hash === B.skills_root_hash) warnings.push('same skill root in both runs — this compares nothing');
for (const m of [A, B]) { if (!m.completed) warnings.push(`${m.variant ?? m.run} did not reach a stop`); if (m.off_profile_providers?.length) warnings.push(`${m.variant ?? m.run} used off-profile providers: ${m.off_profile_providers.join(', ')}`); }

const rows = [
  ['wall seconds', (m) => m.wall_seconds],
  ['reached a stop', (m) => (m.completed ? 'yes' : 'NO')],
  ['steps', (m) => m.steps],
  ['tool calls', (m) => Object.values(m.tool_calls ?? {}).reduce((a, b) => a + b, 0)],
  ['tool errors', (m) => m.tool_errors],
  ['skills loaded', (m) => (m.skills_loaded ?? []).join(',') || 'none'],
  ['chapters', (m) => (m.chapters ?? []).length],
  ['source links', (m) => m.source_links],
  ['bad source links', (m) => (m.bad_source_links ?? []).length],
  ['lint hits', (m) => m.lint?.hits ?? 'n/a'],
  ['media files', (m) => m.media_files ?? 0],
  ['imported media', (m) => (m.imported_media ?? []).length],
  ['video / captions', (m) => `${m.media?.video ?? 0} / ${m.media?.captions ?? 0}`],
  ['diagrams src/render', (m) => `${m.media?.diagram_sources ?? 0} / ${m.media?.rendered_diagrams ?? 0}`],
  ['receipts', (m) => (m.receipts ?? []).length],
  ['hand-ups', (m) => (m.handups ?? []).length],
  ['hand-up reasons', (m) => (m.handups ?? []).map((h) => h.reason).join(',') || 'none'],
];
const comparison = { a: { run: A.run, variant: A.variant, root: A.skills_root_hash }, b: { run: B.run, variant: B.variant, root: B.skills_root_hash },
  warnings, measures: Object.fromEntries(rows.map(([label, f]) => [label, { a: f(A), b: f(B) }])) };

if (args.json) { console.log(JSON.stringify(comparison, null, 2)); }
else {
  const w = Math.max(...rows.map(([l]) => l.length));
  const av = rows.map(([, f]) => String(f(A))), bv = rows.map(([, f]) => String(f(B)));
  const aw = Math.max(A.variant?.length ?? 1, ...av.map((s) => s.length));
  console.log(`${''.padEnd(w)}  ${(A.variant ?? 'A').padEnd(aw)}  ${B.variant ?? 'B'}`);
  rows.forEach(([label], i) => console.log(`${label.padEnd(w)}  ${av[i].padEnd(aw)}  ${bv[i]}`));
  if (warnings.length) { console.log('\nwarnings:'); for (const x of warnings) console.log(`  ! ${x}`); }
}
if (args.out) writeFileSync(args.out, JSON.stringify(comparison, null, 2));
process.exit(warnings.some((w) => w.startsWith('different prompts') || w.startsWith('same skill root')) && !args.force ? 1 : 0);
