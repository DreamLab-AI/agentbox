#!/usr/bin/env node
// Refuse a visual asset before it reaches a video, on the three grounds a machine can
// actually settle. Every media failure measured on 2026-09-11 was one of these, and every
// mechanical check in the pipeline passed anyway: the file existed, played, matched its
// narration to the frame, and showed a broken product behind an illegible drawing.
//
//   asset-gate.mjs --assets DIR [--frame 1920x1080] [--json] [--min-ink 0.55]
//                  [--allow-text "phrase"]... [--quiet]
//
// What it checks, per image:
//   FAILING    the page in the frame is failing. Reads the text off it and looks for a
//              status code, "failed", "error", a loading placeholder or an empty-state
//              phrase. A picture of the product failing is not a picture of the product.
//   EMPTY      how much of the frame the content actually occupies, measured by trimming
//              the uniform border away. A drawing scaled into a frame it was not composed
//              for leaves most of the picture blank, and the dimensions still read 1920x1080.
//   SHRUNK     what the frame does to the asset's own text. An SVG declares its font
//              sizes; scaled to fit the target frame those become a measurable height, and
//              under about 20px nobody can read them on a laptop.
//
// It cannot tell you whether the diagram is right, whether the capture shows what its name
// claims, or whether the prose is any good. Those need eyes: attach the frames to a session
// that can see them (`evals/run-chaptered.sh` takes an `attach` list per work item).
//
// Exit codes: 0 every asset passed, 1 at least one failed, 2 usage or a missing tool.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, mkdtempSync } from 'node:fs';
import { join, extname, basename, relative } from 'node:path';
import { tmpdir } from 'node:os';

const args = (() => { const a = { allow: [] }; const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    if (!v[i].startsWith('--')) continue;
    const k = v[i].slice(2), n = v[i + 1];
    const val = n === undefined || n.startsWith('--') ? true : (i++, n);
    if (k === 'allow-text') a.allow.push(String(val)); else a[k] = val;
  }
  return a; })();
if (!args.assets) { console.error('usage: asset-gate.mjs --assets DIR [--frame 1920x1080] [--json]'); process.exit(2); }
const root = args.assets;
if (!existsSync(root)) { console.error(`asset-gate: not found: ${root}`); process.exit(2); }
const [fw, fh] = String(args.frame ?? '1920x1080').split('x').map(Number);
const minInk = Number(args['min-ink'] ?? 0.55);
const have = (cmd) => { try { execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'pipe' }); return true; } catch { return false; } };

// Phrases that mean the thing in the picture is not working. Kept narrow on purpose: a
// product may legitimately use the word "error" in its own copy, so an engagement adds its
// own vocabulary with --allow-text rather than the list growing until it matches nothing.
const FAILING = [
  /\b(4\d{2}|5\d{2})\b(?=[^%]*$)/m,
  /\bfetch failed\b/i, /\bfailed to (load|fetch|connect)\b/i, /\brequest failed\b/i,
  /\b(unreachable|not responding|connection refused|timed out)\b/i,
  /\bloading\b\s*(the\b[\w\s]{0,20})?\.\.\./i, /\bplease wait\b/i,
  /\b(something went wrong|an error occurred|internal server error)\b/i,
  /\bno (data|results|items|records) (found|yet|to show)\b/i,
];

const walk = (d, out = []) => { for (const e of readdirSync(d, { withFileTypes: true })) {
  const p = join(d, e.name); if (e.isDirectory()) walk(p, out); else out.push(p); } return out; };
const images = walk(root).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
const vectors = walk(root).filter((f) => /\.svg$/i.test(f));

const tmp = mkdtempSync(join(tmpdir(), 'asset-gate-'));
const results = [];

const ocr = (f) => {
  if (!have('tesseract')) return null;
  try { return execFileSync('tesseract', [f, join(tmp, 'out'), '--psm', '6'], { stdio: 'pipe' }) &&
    readFileSync(join(tmp, 'out.txt'), 'utf8'); } catch { return null; }
};

// How much of the frame carries content: trim the uniform border away and compare what is
// left to the whole. A screenshot with a third of its height in blank page, or a drawing
// centred in a frame it was not composed for, shows up here and nowhere else. (Measuring
// edge density instead reads near zero for every image, dense or empty, which is why this
// is a trim rather than a mean.)
const ink = (f) => {
  if (!have('magick') && !have('convert')) return null;
  const bin = have('magick') ? 'magick' : 'convert';
  try {
    const whole = execFileSync(bin, [f, '-format', '%[fx:w*h]', 'info:'], { encoding: 'utf8', stdio: 'pipe' });
    const trimmed = execFileSync(bin, [f, '-fuzz', '2%', '-trim', '+repage', '-format', '%[fx:w*h]', 'info:'], { encoding: 'utf8', stdio: 'pipe' });
    const a = Number(whole.trim()), b = Number(trimmed.trim());
    return a > 0 ? b / a : null;
  } catch { return null; }
};

const geometry = (f) => {
  if (!have('magick') && !have('convert')) return null;
  const bin = have('magick') ? 'magick' : 'convert';
  try { const out = execFileSync(bin, [f, '-format', '%w %h', 'info:'], { encoding: 'utf8', stdio: 'pipe' });
    const [w, h] = out.trim().split(/\s+/).map(Number); return { w, h }; } catch { return null; }
};

for (const f of images) {
  const r = { file: relative(root, f), kind: 'raster', problems: [], notes: [] };
  const g = geometry(f);
  if (g) { r.width = g.w; r.height = g.h; }

  const text = ocr(f);
  if (text === null) r.notes.push('no OCR available; failing-state check skipped');
  else {
    const cleaned = args.allow.reduce((s, phrase) => s.split(phrase).join(' '), text);
    const hits = FAILING.map((re) => (cleaned.match(re) ?? [])[0]).filter(Boolean);
    if (hits.length) r.problems.push({ code: 'FAILING', detail: `the page is failing or unloaded: ${[...new Set(hits)].slice(0, 4).join(', ')}` });
  }

  const coverage = ink(f);
  if (coverage === null) r.notes.push('no ImageMagick; emptiness check skipped');
  else {
    r.ink = Number(coverage.toFixed(4));
    if (coverage < minInk) r.problems.push({ code: 'EMPTY', detail: `content occupies only ${(coverage * 100).toFixed(1)}% of the frame; the rest is blank border (floor ${(minInk * 100).toFixed(0)}%)` });
  }

  if (g && fw && fh) {
    const scale = Math.min(fw / g.w, fh / g.h);
    const used = (g.w * scale * g.h * scale) / (fw * fh);
    r.frame_fill = Number(used.toFixed(3));
    if (used < 0.55) r.problems.push({ code: 'SHRUNK', detail: `fills only ${(used * 100).toFixed(0)}% of a ${fw}x${fh} frame; lay the content along the frame's long axis or split it across scenes` });
  }
  results.push(r);
}

for (const f of vectors) {
  const r = { file: relative(root, f), kind: 'vector', problems: [], notes: [] };
  const svg = readFileSync(f, 'utf8');
  const rootTag = (svg.match(/<svg\b[^>]*>/i) ?? [''])[0];
  let w = Number((rootTag.match(/\bwidth="([\d.]+)(?!%)/) ?? [])[1]);
  let h = Number((rootTag.match(/\bheight="([\d.]+)(?!%)/) ?? [])[1]);
  if (!w || !h) {
    // A percentage width is normal in a responsive export; the viewBox carries the real shape.
    const vb = (rootTag.match(/viewBox="([-\d.\s]+)"/i) ?? [])[1];
    if (vb) { const parts = vb.trim().split(/\s+/).map(Number); if (parts.length === 4) { w = parts[2]; h = parts[3]; } }
  }
  if (w && h) {
    r.width = w; r.height = h;
    const sizes = [...svg.matchAll(/font-size\s*[:=]\s*"?([\d.]+)/g)].map((m) => Number(m[1])).filter(Boolean);
    const scale = fw && fh ? Math.min(fw / w, fh / h) : 1;
    r.scale_to_frame = Number(scale.toFixed(2));
    if (sizes.length) {
      const smallest = Math.min(...sizes);
      r.smallest_text_px_in_frame = Number((smallest * scale).toFixed(1));
      if (smallest * scale < 20) r.problems.push({ code: 'SHRUNK', detail: `smallest label renders at ${(smallest * scale).toFixed(1)}px in a ${fw}x${fh} frame; under 20px it cannot be read` });
    } else r.notes.push('no font-size declared; text legibility not measurable');
    const used = (w * scale * h * scale) / (fw * fh);
    r.frame_fill = Number(used.toFixed(3));
    if (fw && used < 0.55) r.problems.push({ code: 'SHRUNK', detail: `fills only ${(used * 100).toFixed(0)}% of the frame; a portrait drawing in a landscape frame leaves the rest blank` });
  } else r.notes.push('no width/height on the root element; geometry not measurable');
  results.push(r);
}

const failed = results.filter((r) => r.problems.length);
if (args.json) { console.log(JSON.stringify({ frame: `${fw}x${fh}`, assets: results.length, failed: failed.length, results }, null, 2)); }
else if (!args.quiet) {
  console.log(`asset gate: ${results.length} asset(s) against a ${fw}x${fh} frame\n`);
  for (const r of results) {
    const mark = r.problems.length ? '✗' : '✓';
    const size = r.width ? ` ${r.width}x${r.height}` : '';
    console.log(`${mark} ${r.file}${size}${r.ink !== undefined ? ` · content ${(r.ink * 100).toFixed(0)}%` : ''}${r.frame_fill !== undefined ? ` · fills ${(r.frame_fill * 100).toFixed(0)}%` : ''}`);
    for (const p of r.problems) console.log(`    ${p.code}: ${p.detail}`);
    for (const n of r.notes) console.log(`    note: ${n}`);
  }
  console.log(`\n${failed.length} of ${results.length} asset(s) rejected.`);
  if (failed.length) console.log('This gate settles only what a machine can see. Whether each asset shows what its name\nclaims still needs a session that can look at it.');
}
process.exit(failed.length ? 1 : 0);
