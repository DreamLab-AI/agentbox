#!/usr/bin/env node
'use strict';
/**
 * Insert missing "description" keys into schema/agentbox.toml.schema.json by
 * text splice (the schema is hand-formatted, so re-serialising it would
 * rewrite thousands of lines). Existing descriptions are never overwritten.
 *
 *   node scripts/schema-describe.cjs descriptions.json
 *
 * descriptions.json maps dotted property paths ("toolchains.rust") to text.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'schema', 'agentbox.toml.schema.json');
const text = fs.readFileSync(file, 'utf8');
const descs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

// Minimal JSON walker recording, for each object reached through "properties",
// the offset of its opening brace and whether it already has a description.
const found = new Map();
let i = 0;
const ws = () => { while (/\s/.test(text[i])) i++; };
function str() { const s = i; i++; while (text[i] !== '"') { if (text[i] === '\\') i++; i++; } i++; return JSON.parse(text.slice(s, i)); }
function value(p, inProps) {
  ws();
  const c = text[i];
  if (c === '{') {
    const start = i; i++;
    const keys = [];
    const kids = [];
    ws();
    while (text[i] !== '}') {
      ws(); const k = str(); ws(); i++; // colon
      keys.push(k);
      kids.push(k);
      value(k === 'properties' ? [...p, '\0props'] : [...p, k], false);
      ws(); if (text[i] === ',') i++; ws();
    }
    i++;
    if (inProps) found.set(p.filter(x => x !== '\0props').join('.'), { start, has: keys.includes('description') });
    return;
  }
  if (c === '[') { i++; ws(); while (text[i] !== ']') { value([...p, '\0arr'], false); ws(); if (text[i] === ',') i++; ws(); } i++; return; }
  if (c === '"') { str(); return; }
  while (!/[,\]}\s]/.test(text[i])) i++;
}
// Re-walk properly: property-map children are schema nodes.
function schemaNode(p) {
  ws();
  if (text[i] !== '{') { value(p, false); return; }
  const start = i; i++; ws();
  const keys = [];
  while (text[i] !== '}') {
    const k = str(); ws(); i++; keys.push(k);
    if (k === 'properties') {
      ws(); i++; ws();
      while (text[i] !== '}') {
        const pk = str(); ws(); i++;
        schemaNode([...p, pk]);
        ws(); if (text[i] === ',') i++; ws();
      }
      i++;
    } else value([], false);
    ws(); if (text[i] === ',') i++; ws();
  }
  i++;
  found.set(p.join('.'), { start, has: keys.includes('description') });
}
i = 0; schemaNode([]);

const edits = [];
for (const [p, d] of Object.entries(descs)) {
  const n = found.get(p);
  if (!n) throw new Error(`no schema node for ${p}`);
  if (n.has) continue;
  edits.push({ pos: n.start + 1, p, d });
}
let out = text;
for (const e of edits.sort((a, b) => b.pos - a.pos)) {
  const lineStart = out.lastIndexOf('\n', e.pos - 1) + 1;
  const indent = out.slice(lineStart).match(/^\s*/)[0];
  const rest = out.slice(e.pos, out.indexOf('\n', e.pos));
  const ins = rest.trim() === ''
    ? `\n${indent}  "description": ${JSON.stringify(e.d).replace(/[\u0080-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))},`
    : ` "description": ${JSON.stringify(e.d).replace(/[\u0080-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))},`;
  out = out.slice(0, e.pos) + ins + out.slice(e.pos);
}
JSON.parse(out);
fs.writeFileSync(file, out);
console.log(`inserted ${edits.length} descriptions`);
