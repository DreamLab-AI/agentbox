#!/usr/bin/env node
'use strict';
// nb-generate.cjs — zero-dependency Nano Banana image generator (REST).
// Fallback to generate-image.ts for environments without bun/@google/genai.
// Most-performant default for text-heavy infographics/heroes: gemini-3-pro-image
// (Nano Banana Pro, GA). Use gemini-3.1-flash-image for cheap 512px previews.
//
//   node nb-generate.cjs --prompt "…" --out /path.png [--model gemini-3-pro-image]
//                        [--size 4K|2K|1K|512px] [--aspect 16:9] [--ref /img.png]
//
// Reads GOOGLE_API_KEY from env or ~/.claude/.env. Requires Node 18+ (global fetch).

const fs = require('fs');
const path = require('path');

function loadKey() {
  if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY;
  try {
    const envPath = path.join(process.env.HOME || '/home/devuser', '.claude/.env');
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*GOOGLE_API_KEY\s*=\s*(.+)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    }
  } catch { /* fall through */ }
  return '';
}

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

async function main() {
  const prompt = arg('prompt');
  const out = arg('out', '/tmp/nb-out.png');
  const model = arg('model', 'gemini-3-pro-image');
  const size = arg('size', '4K');
  const aspect = arg('aspect', '16:9');
  const ref = arg('ref');
  if (!prompt) { console.error('ERROR: --prompt required'); process.exit(2); }
  const key = loadKey();
  if (!key) { console.error('ERROR: no GOOGLE_API_KEY (env or ~/.claude/.env)'); process.exit(2); }

  const parts = [{ text: prompt }];
  if (ref) {
    const buf = fs.readFileSync(ref);
    const ext = path.extname(ref).slice(1).toLowerCase();
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
    parts.push({ inlineData: { mimeType: mime, data: buf.toString('base64') } });
  }
  const body = {
    contents: [{ parts }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: aspect, imageSize: size } },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const t0 = Date.now();
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.error(`HTTP ${res.status}: ${t.slice(0, 400)}`);
    process.exit(1);
  }
  const j = await res.json();
  const cand = (j.candidates || [])[0];
  const imgPart = ((cand && cand.content && cand.content.parts) || []).find((p) => p.inlineData && p.inlineData.data);
  if (!imgPart) {
    const txt = ((cand && cand.content && cand.content.parts) || []).map((p) => p.text).filter(Boolean).join(' ');
    console.error('No image in response. Text/finish: ' + (txt || cand && cand.finishReason || 'unknown').slice(0, 300));
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(imgPart.inlineData.data, 'base64'));
  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log(JSON.stringify({ ok: true, model, size, aspect, out, kb, latency_ms: Date.now() - t0 }));
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
