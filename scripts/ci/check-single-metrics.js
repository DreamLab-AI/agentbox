#!/usr/bin/env node
// check-single-metrics.js — Invariant: exactly one collectDefaultMetrics( CALL
// exists across management-api/**/*.js (excluding node_modules and comments).
// Multiple prom-client default-metrics registrations on one registry throw at
// runtime ("already registered"); the sprint consolidated to a single call.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BASE = path.join(ROOT, 'management-api');

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && e.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// Strip // line comments and /* */ block comments so commented references are
// not counted. Simple state machine; good enough for this assertion.
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let state = 'code'; // code | line | block | sq | dq | tpl
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
      if (c === "'") { state = 'sq'; out += c; i++; continue; }
      if (c === '"') { state = 'dq'; out += c; i++; continue; }
      if (c === '`') { state = 'tpl'; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c; }
      i++; continue;
    }
    if (state === 'block') {
      if (c === '*' && d === '/') { state = 'code'; i += 2; continue; }
      i++; continue;
    }
    // string states: copy verbatim, honour escapes, exit on matching quote.
    out += c;
    if (c === '\\') { if (i + 1 < n) { out += src[i + 1]; i += 2; continue; } }
    if (state === 'sq' && c === "'") state = 'code';
    else if (state === 'dq' && c === '"') state = 'code';
    else if (state === 'tpl' && c === '`') state = 'code';
    i++;
  }
  return out;
}

const files = walk(BASE, []);
const hits = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const code = stripComments(src);
  const re = /collectDefaultMetrics\s*\(/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    hits.push(f);
  }
}

if (hits.length !== 1) {
  console.error('FAIL (check-single-metrics): expected exactly 1 ' +
    'collectDefaultMetrics( call in management-api, found ' + hits.length + ':');
  for (const h of hits) console.error('  ' + path.relative(ROOT, h));
  if (hits.length === 0) {
    console.error('  (metrics registration removed? a single prom-client default ' +
      'registration is required)');
  } else {
    console.error('  (multiple registrations on one registry throw at runtime)');
  }
  process.exit(1);
}

console.log('PASS (check-single-metrics): exactly one collectDefaultMetrics( call: ' +
  path.relative(ROOT, hits[0]));
