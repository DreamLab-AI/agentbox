'use strict';

// Static Pele rendering for files that leave the browser: committed SVG
// baselines, PDF embedding, the diagram corpus' rendered/ tree and its
// --report consumers. Pele colours everything through CSS custom properties
// (`var(--pele-fg,#1f1f1f)` and its own `--_fg` aliases); a browser resolves
// them, but a PDF embedder or image converter may not, which is the
// invisible-text defect the RES-b gate exists to stop. flatten() replaces every
// variable with the concrete value Pele itself declares as the default, so the
// SVG renders identically with no stylesheet at all.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

// PELE_VENDOR_DIR lets the Nix image point at its own fetchurl-pinned copy; the
// sha256 check against that directory's VERSION applies either way.
const VENDOR = process.env.PELE_VENDOR_DIR || path.join(__dirname, '..', 'vendor', 'pele');

// Options for a gate render: fixed pixel size and the authored direction, so a
// width is a property of the diagram, not of the viewport it happened to meet.
const GATE_OPTIONS = Object.freeze({ responsive: false, autoDirection: false });

let peleModule = null;

/** Import the vendored Pele build after checking it against VERSION's sha256. */
async function loadPele() {
  if (peleModule) return peleModule;
  const file = path.join(VENDOR, 'pele.js');
  const pinned = /^sha256\s+([0-9a-f]{64})$/m.exec(fs.readFileSync(path.join(VENDOR, 'VERSION'), 'utf8'));
  if (!pinned) throw new Error(`${VENDOR}/VERSION carries no sha256 line`);
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (actual !== pinned[1]) throw new Error(`vendored pele.js sha256 ${actual} does not match VERSION ${pinned[1]}`);
  peleModule = await import(pathToFileURL(file).href);
  return peleModule;
}

/** Replace every Pele CSS variable with its declared default. */
function flatten(svg, { background = null, palette = null } = {}) {
  // Only tag markup is rewritten: diagram text may legitimately read `var(...)`.
  const inTags = (s, fn) => s.replace(/<[^>]*>/g, fn);
  let out = inTags(svg, (tag) => tag.replace(/var\(--pele-([\w-]+),([^()]*?)\)/g, (_, name, fallback) => (palette && palette[name] ? palette[name] : fallback.trim())));
  const root = /^<svg\b[^>]*\bstyle="([^"]*)"/.exec(out);
  const local = new Map();
  if (root) for (const m of root[1].matchAll(/(--_[\w-]+):([^;]*)/g)) local.set(m[1], m[2].trim());
  for (let pass = 0; pass < 4; pass++) {
    out = inTags(out, (tag) => tag.replace(/var\((--_[\w-]+)\)/g, (whole, name) => (local.has(name) ? local.get(name) : whole)));
  }
  const left = (out.match(/<[^>]*>/g) || []).find((tag) => tag.includes('var(--'));
  if (left) throw new Error(`unresolved CSS variable left in SVG: ${/var\(--[^)]*\)/.exec(left)[0]}`);
  if (background) out = out.replace(/^(<svg\b[^>]*>)/, `$1<rect x="0" y="0" width="100%" height="100%" fill="${background}"/>`);
  return out;
}

/** Render one Mermaid source to a static SVG. Throws PeleError on bad source. */
function renderStatic(pele, source, { background = null, palette = null, options = {} } = {}) {
  const r = pele.render(source, { ...GATE_OPTIONS, ...options });
  return { svg: flatten(r.svg, { background, palette }), width: Math.round(r.width), height: Math.round(r.height), type: r.mermaidType };
}

/** One line for a render failure: the Mermaid line and its caret snippet. */
function describeError(e) {
  if (e && e.code) return `pele ${e.code}${e.line ? ` at mermaid line ${e.line}` : ''}: ${String(e.message).split('\n')[0]}${e.snippet ? ` | ${e.snippet.split('\n').join(' | ')}` : ''}`;
  return String(e && e.message || e);
}

// Dark palette for `--theme dark`: Pele variable name -> concrete value.
const DARK_PALETTE = Object.freeze({
  bg: '#100f0f', fg: '#cecdc3', muted: '#878580', line: '#878580', surface: '#1c1b1a',
  'surface-alt': '#282726', border: '#575653', accent: '#4385be', 'fg-on-light': '#1f1f1f', 'fg-on-dark': '#ffffff',
});

module.exports = { DARK_PALETTE, VENDOR, GATE_OPTIONS, loadPele, flatten, renderStatic, describeError };
