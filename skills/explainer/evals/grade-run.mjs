#!/usr/bin/env node
// Measure one eval run objectively, before any model grades it. Reads a run directory
// written by run-case.sh and reports what a script can settle: which skills were loaded,
// whether anything went to a cloud model, what the run produced, whether every source
// link it wrote resolves, its lint result, and its hand-up record. Judgement questions
// (does the prose teach, is the diagram right) are left to the grader agent.
//
//   grade-run.mjs --run DIR [--repo DIR] [--json]
//
// Exit codes: 0 measured, 1 the run directory is unusable, 2 usage.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, relative, extname, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = (() => { const a = {}; const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) { if (!v[i].startsWith('--')) continue; const k = v[i].slice(2), n = v[i + 1]; a[k] = n === undefined || n.startsWith('--') ? true : (i++, n); } return a; })();
if (!args.run) { console.error('usage: grade-run.mjs --run DIR [--repo DIR] [--json]'); process.exit(2); }
const run = resolve(args.run);
const transcriptPath = join(run, 'transcript.jsonl');
if (!existsSync(transcriptPath)) { console.error(`grade-run: no transcript at ${transcriptPath}`); process.exit(1); }
const timing = existsSync(join(run, 'timing.json')) ? JSON.parse(readFileSync(join(run, 'timing.json'), 'utf8')) : null;
const repo = resolve(args.repo ?? timing?.target ?? process.cwd());

const walk = (d, out = []) => { if (!existsSync(d)) return out;
  for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p, out); else out.push(p); } return out; };

// --- transcript
const rows = [];
for (const line of readFileSync(transcriptPath, 'utf8').split('\n')) { if (!line.trim()) continue; try { rows.push(JSON.parse(line)); } catch { /* partial line */ } }
const tools = {}, skillsLoaded = [], providers = new Set();
let steps = 0, lastTokens = null, finishReasons = {}, toolErrors = 0, lastText = '';
for (const r of rows) {
  const p = r.part ?? {};
  if (r.type === 'tool_use') {
    const name = p.tool ?? 'unknown';
    tools[name] = (tools[name] ?? 0) + 1;
    if (p.state?.status === 'error') toolErrors++;
    if (name === 'skill' && p.state?.input?.name) skillsLoaded.push(p.state.input.name);
  }
  if (r.type === 'text') lastText = p.text ?? lastText;
  if (r.type === 'step_finish') { steps++; lastTokens = p.tokens ?? lastTokens; finishReasons[p.reason ?? '?'] = (finishReasons[p.reason ?? '?'] ?? 0) + 1; }
  if (p.providerID) providers.add(p.providerID);
}
const pinned = timing?.profile?.split('/')[0] ?? null;
const offProfile = [...providers].filter((p) => pinned && p !== pinned);

// --- what the run produced
const produced = walk(join(run, 'outputs')).concat(walk(join(run, 'target-after')));
const byExt = {};
for (const f of produced) { const e = (extname(f) || 'none').toLowerCase(); byExt[e] = (byExt[e] ?? 0) + 1; }
const chapters = produced.filter((f) => /\/chapters\/.*\.md$/.test(f));
const media = { images: produced.filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).length,
  video: produced.filter((f) => /\.(mp4|webm|mov)$/i.test(f)).length,
  audio: produced.filter((f) => /\.(wav|mp3|m4a|opus)$/i.test(f)).length,
  captions: produced.filter((f) => /\.(vtt|srt)$/i.test(f)).length,
  diagram_sources: produced.filter((f) => /\.(mmd|puml|dot|d2)$/i.test(f)).length,
  rendered_diagrams: produced.filter((f) => /diagram.*\.svg$|\.svg$/i.test(f)).length };
// --- media the run did not make: a produced file that is byte-identical to one already in
// the repository outside the deliverable was imported, not produced. One run passed every
// count by copying a neighbouring pack's clips (2026-09-10), and nothing mechanical caught it.
const MEDIA = /\.(png|jpe?g|webp|gif|mp4|webm|mov|wav|mp3|m4a|opus|svg|vtt|srt)$/i;
const producedMedia = produced.filter((f) => MEDIA.test(f));
const importedMedia = [];
if (producedMedia.length && existsSync(repo)) {
  const wanted = new Map();
  for (const f of producedMedia) { const h = createHash('sha256').update(readFileSync(f)).digest('hex'); wanted.set(h, (wanted.get(h) ?? []).concat(relative(run, f))); }
  const skip = new Set(['node_modules', '.git', '.next', 'dist', 'build']);
  const scan = (d) => {
    let entries; try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (skip.has(e.name) || e.name.startsWith('.')) continue;
      const p2 = join(d, e.name);
      if (p2.startsWith(run)) continue;
      if (e.isDirectory()) { scan(p2); continue; }
      if (!MEDIA.test(e.name)) continue;
      let h; try { h = createHash('sha256').update(readFileSync(p2)).digest('hex'); } catch { continue; }
      if (wanted.has(h)) for (const w of wanted.get(h)) if (!importedMedia.some((m) => m.produced === w)) importedMedia.push({ produced: w, identical_to: relative(repo, p2) });
    }
  };
  scan(repo);
}

const receipts = produced.filter((f) => /receipt|manifest|narration|render/i.test(f) && f.endsWith('.json')).map((f) => relative(run, f));

// --- every source link the run wrote must resolve, and stay inside its file
const links = [];
for (const f of chapters) {
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(/src:([^\s)#]+)(?:#L(\d+)(?:-L?(\d+))?)?/g)) {
    const [, path, a, b] = m;
    const abs = join(repo, path);
    const ok = existsSync(abs) && statSync(abs).isFile();
    const lines = ok ? readFileSync(abs, 'utf8').split('\n').length : null;
    const start = a ? Number(a) : null, end = b ? Number(b) : start;
    links.push({ chapter: relative(run, f), path, start, end, exists: ok,
      in_range: ok && (start === null || (start >= 1 && end <= lines)), file_lines: lines });
  }
}
const badLinks = links.filter((l) => !l.exists || !l.in_range);

// --- lint, when the skill's lint is reachable
const lintScript = join(dirname(new URL(import.meta.url).pathname), '..', 'scripts', 'voice-lint.sh');
let lint = null;
if (chapters.length && existsSync(lintScript)) {
  try { const out = execFileSync('bash', [lintScript, ...chapters], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    lint = { ran: true, hits: [...out.matchAll(/hits=(\d+)/g)].reduce((n, m) => n + Number(m[1]), 0), output: out.trim().split('\n').slice(-6) };
  } catch (e) { lint = { ran: true, failed: true, hits: [...String(e.stdout ?? '').matchAll(/hits=(\d+)/g)].reduce((n, m) => n + Number(m[1]), 0), output: String(e.stdout ?? e.message).trim().split('\n').slice(-6) }; }
}

// --- hand-ups
const handupDir = join(run, 'outputs', 'handup');
const packets = existsSync(handupDir) ? readdirSync(handupDir).filter((f) => f.endsWith('.json') && !f.endsWith('.reply.json')) : [];
const handups = packets.map((f) => { const d = JSON.parse(readFileSync(join(handupDir, f), 'utf8'));
  const reply = existsSync(join(handupDir, `${d.id}.reply.json`)) ? JSON.parse(readFileSync(join(handupDir, `${d.id}.reply.json`), 'utf8')) : null;
  return { id: d.id, tier: d.tier_requested, reason: d.reason, ask: d.ask, attempts: d.attempts?.length ?? 0, verdict: reply?.verdict ?? null }; });

const result = {
  run: relative(process.cwd(), run), variant: timing?.variant ?? null, iteration: timing?.iteration ?? null,
  skills_root_hash: timing?.skills_root_hash ?? null, prompt_sha256: timing?.prompt_sha256 ?? null, wall_seconds: timing?.wall_seconds ?? null,
  exit_status: timing?.exit_status ?? null, launches: timing?.launches?.length ?? null,
  completed: (finishReasons.stop ?? 0) > 0 || (timing?.exit_status === 0 && !Object.keys(finishReasons).includes('tool-calls')),
  steps, finish_reasons: finishReasons, tokens: lastTokens, tool_calls: tools, tool_errors: toolErrors,
  skills_loaded: [...new Set(skillsLoaded)], providers: [...providers], off_profile_providers: offProfile,
  produced_files: produced.length, by_extension: byExt, chapters: chapters.map((f) => relative(run, f)),
  media, media_files: producedMedia.length, imported_media: importedMedia, receipts, source_links: links.length, bad_source_links: badLinks, lint, handups,
  last_text: lastText.trim().slice(0, 300),
};
if (args.json) { console.log(JSON.stringify(result, null, 2)); process.exit(0); }
console.log(`${result.variant ?? 'run'} · ${result.wall_seconds ?? '?'}s · ${steps} steps · exit ${result.exit_status ?? '?'} · ${result.launches ?? '?'} launch(es) · ${result.completed ? 'ran to a stop' : 'did NOT reach a stop'}`);
console.log(`skills loaded: ${result.skills_loaded.join(', ') || 'none'}${offProfile.length ? ` · OFF-PROFILE PROVIDERS: ${offProfile.join(', ')}` : ' · no off-profile provider'}`);
console.log(`tools: ${Object.entries(tools).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'}${toolErrors ? ` · ${toolErrors} tool error(s)` : ''}`);
console.log(`produced ${result.produced_files} files: ${Object.entries(byExt).map(([k, v]) => `${k} ${v}`).join(' ')}`);
console.log(`chapters ${chapters.length} · diagrams ${media.diagram_sources}/${media.rendered_diagrams} · images ${media.images} · video ${media.video} · audio ${media.audio} · captions ${media.captions} · receipts ${receipts.length}`);
console.log(`source links ${links.length}, ${badLinks.length} unresolved or out of range${badLinks.length ? ': ' + badLinks.slice(0, 4).map((l) => `${l.path}#L${l.start}-L${l.end}${l.exists ? ` (file has ${l.file_lines})` : ' (missing)'}`).join(', ') : ''}`);
console.log(`imported media: ${importedMedia.length} of ${producedMedia.length} media files are byte-identical to existing repository media${importedMedia.length ? ' — e.g. ' + importedMedia.slice(0, 3).map((m) => `${m.produced} == ${m.identical_to}`).join('; ') : ''}`);
console.log(`lint: ${lint ? `${lint.hits} hit(s)${lint.failed ? ' (non-zero exit)' : ''}` : 'not run'}`);
console.log(`hand-ups ${handups.length}${handups.length ? ': ' + handups.map((h) => `${h.id}/${h.reason}/${h.tier}${h.verdict ? '→' + h.verdict : ' pending'}`).join(', ') : ''}`);
