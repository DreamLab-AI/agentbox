#!/usr/bin/env node
// check-ports-loopback.mjs — Invariant: every published port across EVERY
// compose file binds to 127.0.0.1 (R-003), except the explicitly sanctioned LAN
// exposures listed in SANCTIONED below. Fails on any other publish in any
// docker-compose*.yml.
//
// ---------------------------------------------------------------------------
// ADR-2013 closeout (2026-09-05) — why this is a parser and no longer a walker.
//
// The previous gate was an awk line-walker over `ports:` blocks. The estate
// review reproduced the structural bypass it left open: a public port written
// as a BLOCK mapping was rejected, but the SAME port written as a nested
// service-flow mapping
//     services:
//       fixture: {image: "x", ports: ["0.0.0.0:45678:45678"]}
// or as JSON-flow ({"services": {"fixture": {"ports": [...]}}}) passed, because
// the walker only armed on a line whose FIRST non-space token was `ports:`.
// A `ports` key that does not begin a line was invisible to it.
//
// The fix is to stop pattern-matching lines and parse the document. This file
// carries a small, deliberately strict YAML reader covering the subset compose
// files actually use — block mappings and sequences, flow mappings and
// sequences (so JSON is parsed for free), single/double-quoted scalars, block
// scalars, multiple documents, anchors, aliases and merge keys — and REJECTS
// anything outside that subset (tags, tabs in indentation, unterminated flow
// collections) rather than skipping it. "Parse, or reliably reject" is the
// guarantee: there is no third outcome in which a construct is silently
// ignored, which is exactly what the old walker did.
//
// Because the document is parsed, long syntax is no longer banned-by-spelling:
// `{target: 80, published: 8080, host_ip: 0.0.0.0}` is normalised to the same
// tuple as "0.0.0.0:8080:80" and judged identically. Anchors and merge keys are
// resolved, so `ports: *public_ports` is audited on the value it resolves to.
//
// Still rejected as unauditable, in every syntax:
//   - environment interpolation in a port value (${HOST:-0.0.0.0})
//   - port ranges (8000-8005:8000-8005)
//   - bare container-only ports (- 80) — no host binding is stated
//   - non-loopback host_ip that is not on the SANCTIONED list
//   - IPv6 binds, including [::] and [::1]
//   - a `ports` value that is not a sequence
//
// NO DEPLOYMENT CLAIM. This gate audits the compose SOURCE files matched by the
// root glob. It does not resolve overlay order, `--env-file` interpolation,
// `extends`, `include:` or files outside the repository root, and it certifies
// nothing about a running deployment: a passing run means the checked-in files
// declare no unsanctioned door, not that no unsanctioned door is open.
//
// ---------------------------------------------------------------------------
// ADR-2062 (2026-09-05) — this is now a LISTENER gate as well as a publish gate.
//
// The publish rule above audits what compose exposes to the HOST. It cannot see
// what a supervised process BINDS inside the container, and a container-internal
// 0.0.0.0 bind on a shared docker network is reachable by every sibling
// container. The second half of this file therefore audits the generated
// supervisord `command=` / `environment=` lines in flake.nix for bind addresses
// and applies a listener rule alongside the `ports:` rule. See the ADR-2062
// section below for what it reads, how it resolves Nix interpolation, and the
// limits it does not overclaim past.
//
// The publish rule's OUTPUT FORMAT is unchanged and load-bearing (other tooling
// parses it); the listener rule adds its own clearly-prefixed lines after it.
//
// Usage: check-ports-loopback.mjs [root]      (default: the repository root)
// Exit:  0 pass, 1 violation (publish or listener), 2 unauditable input
//        (unparseable compose, or an unresolvable bind interpolation),
//        3 usage/no input found.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Sanctioned non-loopback publishes. Adding an entry here is a security
// decision — cite the governing record. Matching is on the NORMALISED tuple
// (host_ip, published, target, protocol), not on the source spelling, so a
// sanctioned mapping stays sanctioned however it is written and an unsanctioned
// one cannot smuggle itself in by re-spelling.
//
//   docker-compose.yml 9096                     — ADR-045 NIP-98 sovereign ingress
//   docker-compose.voice.yml 8443/8444          — voice cockpit TLS door (ADR-2013
//                                                 second LAN ingress, modelled not hidden)
//   docker-compose.browsercontainer.yml 5903/8931/9222
//                                               — sidecar VNC / MCP SSE / raw CDP
//                                                 for LAN operators + agents
//   docker-compose.gui-tools.yml 5905/9876/9877 — sidecar VNC / Blender-MCP / QGIS-MCP
//   docker-compose.xr-runtime.yml 5904          — sidecar VNC
//
// `host_ip: null` means the mapping states no host address, which Docker reads
// as every interface — the 9096 ingress is written that way today and is
// sanctioned in that exact form.
// ---------------------------------------------------------------------------
const SANCTIONED = [
  { file: 'docker-compose.yml', host_ip: null, published: 9096, target: 9096, protocol: 'tcp' },
  { file: 'docker-compose.voice.yml', host_ip: '0.0.0.0', published: 8443, target: 8443, protocol: 'tcp' },
  { file: 'docker-compose.voice.yml', host_ip: '0.0.0.0', published: 8444, target: 8444, protocol: 'tcp' },
  { file: 'docker-compose.browsercontainer.yml', host_ip: '0.0.0.0', published: 5903, target: 5903, protocol: 'tcp' },
  { file: 'docker-compose.browsercontainer.yml', host_ip: '0.0.0.0', published: 8931, target: 8931, protocol: 'tcp' },
  { file: 'docker-compose.browsercontainer.yml', host_ip: '0.0.0.0', published: 9222, target: 9223, protocol: 'tcp' },
  { file: 'docker-compose.gui-tools.yml', host_ip: '0.0.0.0', published: 5905, target: 5905, protocol: 'tcp' },
  { file: 'docker-compose.gui-tools.yml', host_ip: '0.0.0.0', published: 9876, target: 9876, protocol: 'tcp' },
  { file: 'docker-compose.gui-tools.yml', host_ip: '0.0.0.0', published: 9877, target: 9877, protocol: 'tcp' },
  { file: 'docker-compose.xr-runtime.yml', host_ip: '0.0.0.0', published: 5904, target: 5904, protocol: 'tcp' },
];

const LOOPBACK = '127.0.0.1';

// ===========================================================================
// YAML subset reader
// ===========================================================================
// Nodes are {kind, line, value}:
//   scalar  value = string | number | boolean | null
//   seq     value = Node[]
//   map     value = Array<[keyString, Node]>   (order preserved; duplicate keys
//                                               are a parse error, as in compose)
// A ParseError carries the file line so a rejection is actionable.

class ParseError extends Error {
  constructor(line, msg) { super(`line ${line}: ${msg}`); this.line = line; }
}

const scalar = (value, line) => ({ kind: 'scalar', value, line });
const seq = (value, line) => ({ kind: 'seq', value, line });
const map = (value, line) => ({ kind: 'map', value, line });

function mapGet(node, key) {
  if (!node || node.kind !== 'map') return undefined;
  const hit = node.value.find(([k]) => k === key);
  return hit ? hit[1] : undefined;
}

// --- scalar interpretation --------------------------------------------------
// Plain scalars are resolved to the YAML core types this gate cares about.
// Anything else stays a string; the port normaliser decides what is acceptable.
function interpretPlain(text) {
  if (text === '' || text === '~' || text === 'null' || text === 'Null' || text === 'NULL') return null;
  if (/^(true|True|TRUE)$/.test(text)) return true;
  if (/^(false|False|FALSE)$/.test(text)) return false;
  if (/^[+-]?\d+$/.test(text)) {
    const n = Number(text);
    return Number.isSafeInteger(n) ? n : text;
  }
  if (/^[+-]?(\d+\.\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) return Number(text);
  return text;
}

// Quoted-scalar reader. Returns [value, indexAfterClosingQuote].
function readQuoted(src, i, line) {
  const quote = src[i];
  let out = '';
  i++;
  while (i < src.length) {
    const c = src[i];
    if (quote === "'") {
      if (c === "'") {
        if (src[i + 1] === "'") { out += "'"; i += 2; continue; }
        return [out, i + 1];
      }
      out += c; i++; continue;
    }
    if (c === '\\') {
      const n = src[i + 1];
      if (n === undefined) throw new ParseError(line, 'unterminated escape in double-quoted scalar');
      const simple = { n: '\n', t: '\t', r: '\r', '0': '\0', '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f' };
      if (n in simple) { out += simple[n]; i += 2; continue; }
      if (n === 'u') {
        const hex = src.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new ParseError(line, 'malformed \\u escape');
        out += String.fromCharCode(parseInt(hex, 16)); i += 6; continue;
      }
      throw new ParseError(line, `unsupported escape \\${n}`);
    }
    if (c === quote) return [out, i + 1];
    out += c; i++;
  }
  throw new ParseError(line, 'unterminated quoted scalar');
}

// --- flow collections -------------------------------------------------------
// A complete recursive reader for [..] and {..}; JSON is a strict subset, so a
// JSON compose file parses here with no special case. Returns [node, indexAfter].
function readFlow(src, i, line, depth = 0) {
  if (depth > 32) throw new ParseError(line, 'flow collection nested too deeply');
  const open = src[i];
  const close = open === '[' ? ']' : '}';
  const items = [];
  i++;
  for (;;) {
    i = skipFlowSpace(src, i, line);
    if (i >= src.length) throw new ParseError(line, `unterminated flow ${open === '[' ? 'sequence' : 'mapping'}`);
    if (src[i] === close) return [open === '[' ? seq(items, line) : map(items, line), i + 1];
    if (src[i] === ',') { i++; continue; }

    if (open === '[') {
      const [node, next] = readFlowNode(src, i, line, depth);
      items.push(node); i = next;
    } else {
      // key
      let key, next;
      if (src[i] === '"' || src[i] === "'") { [key, next] = readQuoted(src, i, line); }
      else {
        const m = /^[^:,\[\]{}]+/.exec(src.slice(i));
        if (!m) throw new ParseError(line, 'malformed flow mapping key');
        key = m[0].trim(); next = i + m[0].length;
      }
      i = skipFlowSpace(src, next, line);
      if (src[i] !== ':') throw new ParseError(line, `flow mapping key ${JSON.stringify(key)} is not followed by ":"`);
      i = skipFlowSpace(src, i + 1, line);
      const [node, after] = readFlowNode(src, i, line, depth);
      if (items.some(([k]) => k === key)) throw new ParseError(line, `duplicate key ${JSON.stringify(key)} in flow mapping`);
      items.push([key, node]); i = after;
    }
  }
}

function skipFlowSpace(src, i, line) {
  for (;;) {
    while (i < src.length && (src[i] === ' ' || src[i] === '\t')) i++;
    if (src[i] === '#') throw new ParseError(line, 'comment inside a flow collection is not supported by this gate');
    return i;
  }
}

function readFlowNode(src, i, line, depth) {
  if (src[i] === '[' || src[i] === '{') return readFlow(src, i, line, depth + 1);
  if (src[i] === '"' || src[i] === "'") { const [v, n] = readQuoted(src, i, line); return [scalar(v, line), n]; }
  const m = /^[^,\[\]{}]*/.exec(src.slice(i));
  const text = (m ? m[0] : '').trim();
  if (text.startsWith('*') || text.startsWith('&') || text.startsWith('!')) {
    throw new ParseError(line, `anchors, aliases and tags are not supported inside flow collections (${text})`);
  }
  return [scalar(interpretPlain(text), line), i + (m ? m[0].length : 0)];
}

// --- line splitting ---------------------------------------------------------
// Strips a trailing comment that is genuinely outside quotes and outside a flow
// collection. Anything ambiguous is left alone and will fail later rather than
// being silently trimmed.
function stripComment(text, line) {
  let inQuote = null, flow = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (inQuote === '"' && c === '\\') { i++; continue; }
      if (c === inQuote) { if (inQuote === "'" && text[i + 1] === "'") { i++; continue; } inQuote = null; }
      continue;
    }
    if (c === '"' || c === "'") { inQuote = c; continue; }
    if (c === '[' || c === '{') { flow++; continue; }
    if (c === ']' || c === '}') { flow--; continue; }
    if (c === '#' && flow === 0 && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i);
  }
  if (inQuote) throw new ParseError(line, 'unterminated quote');
  return text;
}

// A flow collection may span lines — a whole-document JSON compose file is the
// common case, and `ports: [` continued on the next line is the other. Accumulate
// raw lines (comments already stripped) until the bracket depth returns to zero,
// so readFlow always sees a complete collection. An unbalanced collection at EOF
// is a parse error, never a silent truncation.
function scanFlowDepth(text, st) {
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (st.inQuote) {
      if (st.inQuote === '"' && c === '\\') { i++; continue; }
      if (c === st.inQuote) { if (st.inQuote === "'" && text[i + 1] === "'") { i++; continue; } st.inQuote = null; }
      continue;
    }
    if (c === '"' || c === "'") { st.inQuote = c; continue; }
    if (c === '[' || c === '{') { st.depth++; continue; }
    if (c === ']' || c === '}') { st.depth--; continue; }
  }
}

function gatherFlow(rd, body, line) {
  const st = { depth: 0, inQuote: null };
  let acc = body;
  scanFlowDepth(body, st);
  while (st.depth > 0) {
    if (rd.i >= rd.raw.length) throw new ParseError(line, 'unterminated flow collection');
    const raw = rd.raw[rd.i];
    const at = rd.i + 1;
    rd.i++;
    if (/^ *\t/.test(raw) || /^\t/.test(raw)) throw new ParseError(at, 'tab in indentation is illegal YAML and is rejected');
    const t = stripComment(raw, at).trim();
    acc += ' ' + t;
    scanFlowDepth(t, st);
  }
  if (st.inQuote) throw new ParseError(line, 'unterminated quote inside a flow collection');
  return acc;
}

// --- the block parser -------------------------------------------------------
class Reader {
  constructor(text) {
    this.raw = text.split('\n');
    this.i = 0;
    this.anchors = new Map();
  }
  get lineNo() { return this.i + 1; }
  // Next content line as {indent, text, line}, or null at EOF / document end.
  peek() {
    while (this.i < this.raw.length) {
      const raw = this.raw[this.i];
      const line = this.i + 1;
      if (/^\s*$/.test(raw)) { this.i++; continue; }
      if (/^\s*#/.test(raw)) { this.i++; continue; }
      if (/^\t/.test(raw) || /^ *\t/.test(raw)) throw new ParseError(line, 'tab in indentation is illegal YAML and is rejected');
      const text = stripComment(raw, line).replace(/\s+$/, '');
      if (text === '') { this.i++; continue; }
      const indent = text.length - text.replace(/^ +/, '').length;
      return { indent, text: text.slice(indent), line, raw };
    }
    return null;
  }
  next() { const p = this.peek(); if (p) this.i++; return p; }
}

// Consume a block scalar body (| or >) and return it as one string. The body is
// opaque to this gate — it only has to be consumed so it cannot be mistaken for
// structure.
function readBlockScalar(rd, parentIndent) {
  const parts = [];
  for (;;) {
    if (rd.i >= rd.raw.length) break;
    const raw = rd.raw[rd.i];
    if (/^\s*$/.test(raw)) { parts.push(''); rd.i++; continue; }
    const indent = raw.length - raw.replace(/^ +/, '').length;
    if (indent <= parentIndent) break;
    parts.push(raw.slice(parentIndent + 1));
    rd.i++;
  }
  return parts.join('\n');
}

// Parse the value written after `key:` or `- ` on the same line.
function inlineValue(rd, text, line, indent) {
  const t = text.trim();
  if (t === '') return null;                      // value is the nested block
  if (t.startsWith('#')) return null;
  if (t === '|' || t === '>' || /^[|>][-+]?\d*$/.test(t)) return scalar(readBlockScalar(rd, indent), line);
  if (t.startsWith('!')) throw new ParseError(line, `YAML tags are not supported by this gate (${t})`);
  if (t.startsWith('*')) {
    const name = t.slice(1).trim();
    if (!rd.anchors.has(name)) throw new ParseError(line, `alias *${name} refers to an undefined anchor`);
    return rd.anchors.get(name);
  }
  let anchor = null, body = t;
  const am = /^&([^\s]+)\s*(.*)$/.exec(t);
  if (am) { anchor = am[1]; body = am[2]; }
  let node;
  if (body === '') {
    node = null;                                  // anchored nested block; bound below
  } else if (body[0] === '[' || body[0] === '{') {
    const whole = gatherFlow(rd, body, line);
    const [n, after] = readFlow(whole, 0, line);
    if (whole.slice(after).trim() !== '') throw new ParseError(line, 'trailing content after a flow collection');
    node = n;
  } else if (body[0] === '"' || body[0] === "'") {
    const [v, after] = readQuoted(body, 0, line);
    if (body.slice(after).trim() !== '') throw new ParseError(line, 'trailing content after a quoted scalar');
    node = scalar(v, line);
  } else {
    node = scalar(interpretPlain(body), line);
  }
  if (anchor && node) rd.anchors.set(anchor, node);
  if (anchor && !node) return { __anchor: anchor };
  return node;
}

function parseBlock(rd, minIndent) {
  const first = rd.peek();
  if (!first || first.indent < minIndent) return scalar(null, first ? first.line : rd.lineNo);
  if (first.text[0] === '[' || first.text[0] === '{') {
    // A flow collection in block position: a whole-document JSON compose file
    // arrives here, and so does an operator's inline `{...}` service map.
    rd.next();
    const whole = gatherFlow(rd, first.text, first.line);
    const [node, after] = readFlow(whole, 0, first.line);
    if (whole.slice(after).trim() !== '') throw new ParseError(first.line, 'trailing content after a flow collection');
    return node;
  }
  return first.text.startsWith('- ') || first.text === '-'
    ? parseSeq(rd, first.indent)
    : parseMap(rd, first.indent);
}

function parseSeq(rd, indent) {
  const items = [];
  const startLine = rd.peek().line;
  for (;;) {
    const p = rd.peek();
    if (!p || p.indent < indent) break;
    if (p.indent > indent) throw new ParseError(p.line, 'unexpected indentation inside a block sequence');
    if (!(p.text === '-' || p.text.startsWith('- '))) break;
    rd.next();
    const rest = p.text === '-' ? '' : p.text.slice(2);
    if (rest.trim() === '') { items.push(parseBlock(rd, indent + 1)); continue; }
    // Compact nested mapping: "- key: value" on the sequence line.
    const kv = splitKey(rest, p.line);
    if (kv) {
      const entryIndent = indent + 2 + kv.leading;
      const entries = [];
      const v = inlineValue(rd, kv.rest, p.line, indent);
      entries.push([kv.key, v === null ? parseBlock(rd, entryIndent + 1) : resolvePending(rd, v, entryIndent + 1)]);
      collectMapEntries(rd, entryIndent, entries);
      items.push(map(entries, p.line));
      continue;
    }
    const v = inlineValue(rd, rest, p.line, indent);
    items.push(v === null ? parseBlock(rd, indent + 1) : resolvePending(rd, v, indent + 1));
  }
  return seq(items, startLine);
}

// Split "key: rest" honouring quotes and flow collections. Returns null when the
// line is not a mapping entry.
function splitKey(text, line) {
  let inQuote = null, flow = 0;
  const leading = text.length - text.replace(/^ +/, '').length;
  for (let i = leading; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (inQuote === '"' && c === '\\') { i++; continue; }
      if (c === inQuote) { if (inQuote === "'" && text[i + 1] === "'") { i++; continue; } inQuote = null; }
      continue;
    }
    if (c === '"' || c === "'") { inQuote = c; continue; }
    if (c === '[' || c === '{') { flow++; continue; }
    if (c === ']' || c === '}') { flow--; continue; }
    if (c === ':' && flow === 0 && (i + 1 === text.length || /[\s]/.test(text[i + 1]))) {
      let keyText = text.slice(leading, i).trim();
      if (keyText === '') return null;
      if ((keyText[0] === '"' || keyText[0] === "'")) {
        const [v, after] = readQuoted(keyText, 0, line);
        if (keyText.slice(after).trim() !== '') throw new ParseError(line, 'trailing content after a quoted key');
        keyText = v;
      }
      return { key: keyText, rest: text.slice(i + 1), leading };
    }
  }
  return null;
}

// An anchor written on a key with a nested block ("key: &a" then an indented
// block) binds once the block is read.
function resolvePending(rd, v, childIndent) {
  if (v && v.__anchor) {
    const node = parseBlock(rd, childIndent);
    rd.anchors.set(v.__anchor, node);
    return node;
  }
  return v;
}

function collectMapEntries(rd, indent, entries) {
  for (;;) {
    const p = rd.peek();
    if (!p || p.indent < indent) break;
    if (p.indent > indent) throw new ParseError(p.line, 'unexpected indentation inside a block mapping');
    if (p.text === '-' || p.text.startsWith('- ')) break;
    const kv = splitKey(p.text, p.line);
    if (!kv) throw new ParseError(p.line, `not a mapping entry: ${JSON.stringify(p.text)}`);
    rd.next();
    let value = inlineValue(rd, kv.rest, p.line, p.indent);
    value = value === null ? parseBlock(rd, indent + 1) : resolvePending(rd, value, indent + 1);
    if (kv.key === '<<') {
      // Merge key: fold the referenced mapping's entries in, without overriding
      // keys already stated explicitly on this mapping.
      const sources = value.kind === 'seq' ? value.value : [value];
      for (const src of sources) {
        if (!src || src.kind !== 'map') throw new ParseError(p.line, 'merge key << must reference a mapping');
        for (const [k, v] of src.value) if (!entries.some(([e]) => e === k)) entries.push([k, v]);
      }
      continue;
    }
    if (entries.some(([k]) => k === kv.key)) throw new ParseError(p.line, `duplicate key ${JSON.stringify(kv.key)}`);
    entries.push([kv.key, value]);
  }
}

function parseMap(rd, indent) {
  const entries = [];
  const startLine = rd.peek().line;
  collectMapEntries(rd, indent, entries);
  return map(entries, startLine);
}

// Parse a whole file into a list of documents. Throws ParseError on anything
// outside the supported subset.
export function parseComposeYaml(text) {
  const docs = [];
  // Split on document markers at column 0, keeping line numbers aligned.
  const lines = text.split('\n');
  let start = 0;
  const chunks = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^---(\s|$)/.test(l) || /^\.\.\.(\s|$)/.test(l)) {
      if (i > start) chunks.push({ from: start, body: lines.slice(start, i) });
      start = i + 1;
    }
  }
  chunks.push({ from: start, body: lines.slice(start) });
  for (const chunk of chunks) {
    if (chunk.body.every((l) => /^\s*(#.*)?$/.test(l))) continue;
    // Pad so reported line numbers match the original file.
    const rd = new Reader(new Array(chunk.from).fill('').concat(chunk.body).join('\n'));
    const doc = parseBlock(rd, 0);
    const leftover = rd.peek();
    if (leftover) throw new ParseError(leftover.line, `unparsed trailing content: ${JSON.stringify(leftover.text)}`);
    docs.push(doc);
  }
  return docs;
}

// ===========================================================================
// Port normalisation
// ===========================================================================
// Returns {ok:true, mapping} or {ok:false, why}. `mapping` is
// {host_ip, published, target, protocol} with host_ip null when unstated.

const PORT_RE = /^\d{1,5}$/;
const okPort = (s) => PORT_RE.test(s) && Number(s) >= 1 && Number(s) <= 65535;

export function normalisePort(node) {
  if (node.kind === 'map') return normaliseLongSyntax(node);
  if (node.kind === 'seq') return { ok: false, why: 'a ports entry is itself a sequence' };
  const v = node.value;
  if (v === null || v === undefined) return { ok: false, why: 'empty ports entry' };
  if (typeof v === 'number') {
    return { ok: false, why: `bare container port ${v} states no host binding` };
  }
  if (typeof v !== 'string') return { ok: false, why: `unsupported ports entry type ${typeof v}` };
  const text = v.trim();
  if (text === '') return { ok: false, why: 'empty ports entry' };
  if (text.includes('${') || text.includes('$(')) return { ok: false, why: `environment interpolation in ${JSON.stringify(text)} is unauditable` };
  if (text.includes('-') && /\d-\d/.test(text)) return { ok: false, why: `port range in ${JSON.stringify(text)} is unauditable` };

  let rest = text, protocol = 'tcp';
  const slash = rest.lastIndexOf('/');
  if (slash !== -1) {
    protocol = rest.slice(slash + 1).toLowerCase();
    rest = rest.slice(0, slash);
    if (protocol !== 'tcp' && protocol !== 'udp') return { ok: false, why: `unknown protocol ${JSON.stringify(protocol)}` };
  }

  // IPv6 host addresses are written [addr]:published:target and are rejected —
  // the invariant is a v4 loopback bind, and an unsanctioned [::] is a public door.
  if (rest.startsWith('[')) {
    const end = rest.indexOf(']');
    if (end === -1) return { ok: false, why: `malformed IPv6 host address in ${JSON.stringify(text)}` };
    return { ok: false, why: `IPv6 host bind ${JSON.stringify(rest.slice(0, end + 1))} is not a 127.0.0.1 bind` };
  }

  const parts = rest.split(':');
  if (parts.length === 1) {
    if (!okPort(parts[0])) return { ok: false, why: `unparseable ports entry ${JSON.stringify(text)}` };
    return { ok: false, why: `bare container port ${JSON.stringify(text)} states no host binding` };
  }
  if (parts.length === 2) {
    if (!okPort(parts[0]) || !okPort(parts[1])) return { ok: false, why: `unparseable ports entry ${JSON.stringify(text)}` };
    return { ok: true, mapping: { host_ip: null, published: Number(parts[0]), target: Number(parts[1]), protocol } };
  }
  if (parts.length === 3) {
    const [host, pub, tgt] = parts;
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return { ok: false, why: `unparseable host address ${JSON.stringify(host)} in ${JSON.stringify(text)}` };
    if (!okPort(pub) || !okPort(tgt)) return { ok: false, why: `unparseable ports entry ${JSON.stringify(text)}` };
    return { ok: true, mapping: { host_ip: host, published: Number(pub), target: Number(tgt), protocol } };
  }
  return { ok: false, why: `unparseable ports entry ${JSON.stringify(text)}` };
}

function normaliseLongSyntax(node) {
  const known = new Set(['target', 'published', 'host_ip', 'protocol', 'mode', 'name', 'app_protocol']);
  for (const [k] of node.value) {
    if (!known.has(k)) return { ok: false, why: `unknown long-syntax port key ${JSON.stringify(k)}` };
  }
  const val = (k) => { const n = mapGet(node, k); return n ? n.value : undefined; };
  const asPort = (raw, label) => {
    if (raw === undefined || raw === null) return { err: `long syntax is missing ${label}` };
    if (typeof raw === 'number') return okPort(String(raw)) ? { n: raw } : { err: `${label} ${raw} is out of range` };
    const s = String(raw).trim();
    if (s.includes('${') || s.includes('$(')) return { err: `environment interpolation in ${label} is unauditable` };
    if (/\d-\d/.test(s)) return { err: `port range in ${label} is unauditable` };
    return okPort(s) ? { n: Number(s) } : { err: `${label} ${JSON.stringify(s)} is not a port number` };
  };
  const t = asPort(val('target'), 'target');
  if (t.err) return { ok: false, why: t.err };
  const p = asPort(val('published'), 'published');
  if (p.err) return { ok: false, why: p.err };
  let host = val('host_ip');
  if (host === undefined) host = null;
  else {
    host = String(host).trim();
    if (host.includes('${') || host.includes('$(')) return { ok: false, why: 'environment interpolation in host_ip is unauditable' };
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return { ok: false, why: `host_ip ${JSON.stringify(host)} is not an IPv4 address` };
  }
  let protocol = val('protocol');
  protocol = protocol === undefined || protocol === null ? 'tcp' : String(protocol).toLowerCase();
  if (protocol !== 'tcp' && protocol !== 'udp') return { ok: false, why: `unknown protocol ${JSON.stringify(protocol)}` };
  return { ok: true, mapping: { host_ip: host, published: p.n, target: t.n, protocol } };
}

// ===========================================================================
// The gate
// ===========================================================================

// Collect every `ports` node anywhere in the document, with a readable path.
// Walking the whole tree (not only services/*/ports) is deliberate: an overlay
// or an x-extension that carries a ports list is still a door.
function collectPorts(node, trail, out) {
  if (!node) return;
  if (node.kind === 'map') {
    for (const [k, v] of node.value) {
      if (k === 'ports') out.push({ path: [...trail, k].join('.'), node: v });
      else collectPorts(v, [...trail, k], out);
    }
    return;
  }
  if (node.kind === 'seq') {
    node.value.forEach((v, i) => collectPorts(v, [...trail, `[${i}]`], out));
  }
}

function isSanctioned(base, m) {
  return SANCTIONED.some((s) => s.file === base && s.host_ip === m.host_ip
    && s.published === m.published && s.target === m.target && s.protocol === m.protocol);
}

function checkFile(file) {
  const base = path.basename(file);
  const violations = [];
  let docs;
  try { docs = parseComposeYaml(fs.readFileSync(file, 'utf8')); }
  catch (e) {
    if (e instanceof ParseError) return { unparseable: `${base}: ${e.message}` };
    throw e;
  }
  const found = [];
  for (const doc of docs) collectPorts(doc, [], found);
  for (const { path: where, node } of found) {
    if (node.kind !== 'seq') {
      violations.push(`${base}: ${where} is not a sequence (${node.kind}) — a ports value must be a list`);
      continue;
    }
    for (const entry of node.value) {
      const r = normalisePort(entry);
      if (!r.ok) { violations.push(`${base}:${entry.line}: ${where}: ${r.why}`); continue; }
      const m = r.mapping;
      if (m.host_ip === LOOPBACK) continue;
      if (isSanctioned(base, m)) continue;
      const shown = `${m.host_ip === null ? '(all interfaces)' : m.host_ip}:${m.published}:${m.target}/${m.protocol}`;
      violations.push(`${base}:${entry.line}: ${where}: publishes ${shown} — not loopback and not sanctioned`);
    }
  }
  return { violations, ports: found.length };
}

// ===========================================================================
// ADR-2062 — the listener rule
// ===========================================================================
// A loopback *publish* constrains host->container only. It says nothing about
// container->container traffic on a shared bridge, and agentbox joins the
// external `visionclaw_network` (docker-compose.yml networks: -> the override's
// `external: true`). So a supervised program that binds 0.0.0.0 inside the
// container is reachable, unauthenticated, by every sibling container — and is
// invisible to the `ports:` rule above in ANY syntax and at any level of
// parsing rigour, because it is never declared as a port at all.
//
// This section therefore audits the OTHER plane: the generated supervisord text
// inside flake.nix. For each `[program:NAME]` block it reads the `command=` and
// `environment=` lines and extracts every stated bind address, from:
//
//   --bind / --bind-addr / --host / --listen / --ip / --address / --addr
//     (both `--flag value` and `--flag=value`)
//   --port with a host-carrying value (`--port 0.0.0.0:8888`)
//   a BARE positional IPv4 literal (`wayvnc --output=… 0.0.0.0 5901`) — a
//     dotted quad standing alone in a supervised command IS a bind address, and
//     ignoring it would let the gate lie about the shape it most needs to catch
//   environment assignments named BIND / HOST or suffixed _BIND / _BIND_ADDR /
//     _LISTEN / _LISTEN_ADDR / _HOST (e.g. AGENTBOX_RELAY_BIND)
//
// The rule: a program that binds a non-loopback address must be on
// LISTENER_SANCTIONED with a reason, or it is a violation naming the program,
// the flag, the address and the flake.nix line.
//
// Nix interpolation. Bind values are frequently `${var}`. Resolution is
// three-way and never silently optimistic:
//   RESOLVED  — a plain string literal, or a `let` binding whose RHS is one.
//   DEFAULTED — `cfg.attr or "127.0.0.1:9720"` (directly or via a `let`
//               binding, e.g. `mcpHubBind`). The literal default is used and
//               the listener is reported as manifest-overridable, because the
//               operator's agentbox.toml can move it. A DEFAULTED value that
//               defaults NON-loopback still needs a sanction.
//   UNRESOLVED — anything else. Reported explicitly and exits 2 (unauditable),
//               never passed over. "Resolve, or reject" — there is no third
//               outcome in which a bind address is silently ignored.
//
// LIMITS, stated so the gate does not overclaim (cf. the publish rule's own
// NO DEPLOYMENT CLAIM):
//   - A program that binds every interface by DEFAULT while stating no address
//     is undetectable statically (`x11vnc -rfbport 5901`, `Xvnc :1 -rfbport
//     5901`). Static text cannot see a library default.
//   - A DEFAULTED loopback value can be overridden non-loopback in
//     agentbox.toml. The enumeration marks these so the override is visible.
//   - Conditional Nix branches are all audited, since any of them may be the
//     text that is generated. That is fail-closed and deliberate.
//   - Auth posture is NOT inferred from the command line; a sanction records it
//     by citation. This gate proves reachability, ADR-2040 owns the credential.

// ---------------------------------------------------------------------------
// Sanctioned non-loopback LISTENERS, keyed by supervisor program name. Adding
// an entry is a security decision — the reason must cite the record that
// establishes the program authenticates (or is otherwise sanctioned).
//
// Seeded with the two programs ADR-2040 names as authenticated non-loopback
// listeners, each confirmed in flake.nix at the time of writing:
//   code-server  — `--auth password`, password minted 0600 at boot by
//                  config/entrypoint-unified.sh into the --config file.
//   jupyter-lab  — the empty `--IdentityProvider.token=` was DROPPED, so
//                  jupyter_server falls through to JUPYTER_TOKEN, minted 0600
//                  at boot and exported into PID 1's environment.
// ---------------------------------------------------------------------------
const LISTENER_SANCTIONED = [
  { program: 'code-server', reason: 'ADR-2040 — binds 0.0.0.0:8080 but authenticates: --auth password, credential minted 0600 at boot' },
  { program: 'jupyter-lab', reason: 'ADR-2040 — binds 0.0.0.0:8888 but authenticates: JUPYTER_TOKEN minted 0600 at boot, empty --IdentityProvider.token= removed' },
  // The three desktop-stack VNC servers (one runs per desktop.stack branch) are
  // UNAUTHENTICATED by construction (wayvnc no auth, x11vnc -nopw, Xvnc
  // -SecurityTypes None) and must bind a non-loopback address so the compose
  // publish 127.0.0.1:5901:5901 (host loopback only, ADR-2013) can reach them.
  // Sanctioned as a KNOWN, RECORDED exception of the ADR-2040 class: the
  // exposure is the docker network only, and VNC authentication minted at boot
  // is ADR-2040's open follow-on. x11vnc and Xvnc declare no bind flag (they
  // bind every interface implicitly), so only wayvnc is visible to this rule.
  { program: 'wayvnc', reason: 'ADR-2040 follow-on — VNC desktop server, unauthenticated, docker-network only; host publish is loopback-only (127.0.0.1:5901)' },
  { program: 'x11vnc', reason: 'ADR-2040 follow-on — VNC desktop server (-nopw), docker-network only; host publish is loopback-only (127.0.0.1:5901)' },
  { program: 'xvnc', reason: 'ADR-2040 follow-on — VNC desktop server (-SecurityTypes None), docker-network only; host publish is loopback-only (127.0.0.1:5901)' },
];

// Flags whose value is a bind address.
const BIND_FLAGS = new Set([
  '--bind', '--bind-addr', '--bind-address', '--host', '--hostname',
  '--listen', '--listen-addr', '--listen-address', '--ip', '--address', '--addr', '--http-address',
]);
// `--port` only carries a host when its value is host:port.
const PORT_FLAGS = new Set(['--port', '--http-port']);

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

// --- Nix interpolation resolution -------------------------------------------

// Single-line `let` bindings: `name = <expr>;`. Multi-line RHSs are not
// collected, so an interpolation naming one resolves to UNRESOLVED rather than
// to a guess.
export function collectNixLetBindings(text) {
  const lets = new Map();
  const lines = text.split('\n');
  for (const line of lines) {
    const m = /^\s{2,}([A-Za-z_][A-Za-z0-9_'-]*)\s*=\s*(.+?);\s*$/.exec(line);
    if (m && !lets.has(m[1])) lets.set(m[1], m[2].trim());
  }
  return lets;
}

// Split a string into literal chunks and `${...}` interpolations, honouring
// nested braces so `${toString (a or 1)}` and `${x}${y}` both split correctly.
function splitInterpolations(s) {
  const out = [];
  let lit = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '$' && s[i + 1] === '{') {
      let depth = 1, j = i + 2, expr = '';
      for (; j < s.length && depth > 0; j++) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}') { depth--; if (depth === 0) break; }
        expr += s[j];
      }
      if (depth !== 0) { lit += s.slice(i); break; }
      if (lit) { out.push({ lit }); lit = ''; }
      out.push({ expr });
      i = j;
      continue;
    }
    lit += s[i];
  }
  if (lit) out.push({ lit });
  return out;
}

function resolveNixExpr(expr, lets, depth = 0) {
  const e = expr.trim();
  if (depth > 6) return { ok: false, why: 'interpolation nests too deeply to resolve' };
  // "literal" — a plain double-quoted string with no interpolation of its own.
  const q = /^"([^"$]*)"$/.exec(e);
  if (q) return { ok: true, value: q[1], defaulted: false };
  // (X) and toString (X) / toString X
  let m = /^\((.*)\)$/s.exec(e);
  if (m) return resolveNixExpr(m[1], lets, depth + 1);
  m = /^toString\s+(.*)$/s.exec(e);
  if (m) return resolveNixExpr(m[1], lets, depth + 1);
  // <attrpath> or <default> — the manifest may override, the default is known.
  m = /^(.+?)\s+or\s+(.+)$/s.exec(e);
  if (m) {
    const d = resolveNixExpr(m[2], lets, depth + 1);
    if (!d.ok) {
      const num = /^-?\d+$/.exec(m[2].trim());
      if (num) return { ok: true, value: num[0], defaulted: true };
      return d;
    }
    return { ok: true, value: d.value, defaulted: true };
  }
  // A bare number (a port default reached through `or`).
  if (/^-?\d+$/.test(e)) return { ok: true, value: e, defaulted: false };
  // A `let` identifier: recurse into its single-line RHS.
  if (/^[A-Za-z_][A-Za-z0-9_'-]*$/.test(e)) {
    if (!lets.has(e)) return { ok: false, why: `\`${e}\` is not a resolvable single-line let binding` };
    return resolveNixExpr(lets.get(e), lets, depth + 1);
  }
  return { ok: false, why: `\`${e}\` is not a literal, a defaulted attribute, or a resolvable let binding` };
}

// Resolve a whole value (literals + interpolations) to a string.
export function resolveNixValue(raw, lets) {
  const parts = splitInterpolations(raw);
  let value = '', defaulted = false;
  for (const p of parts) {
    if (p.lit !== undefined) { value += p.lit; continue; }
    const r = resolveNixExpr(p.expr, lets);
    if (!r.ok) return { ok: false, why: `\${${p.expr}}: ${r.why}` };
    value += r.value;
    defaulted = defaulted || r.defaulted;
  }
  return { ok: true, value, defaulted };
}

// --- supervisor block reading -----------------------------------------------

// A block runs from its `[program:NAME]` header to the next header or to the
// end of the enclosing Nix string (`''`), whichever comes first. Bounding on
// `''` matters: without it, trailing Nix code far below the last block would be
// attributed to that block.
export function splitProgramBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^\s*\[program:([^\]]+)\]\s*$/.exec(line);
    if (h) { cur = { program: h[1].trim(), startLine: i + 1, lines: [] }; blocks.push(cur); continue; }
    if (!cur) continue;
    if (/^\s*''/.test(line)) { cur = null; continue; }
    cur.lines.push({ n: i + 1, text: line });
  }
  return blocks;
}

// Split an `environment=` payload on commas that are not inside quotes or
// inside a `${...}` interpolation (Nix interpolations contain their own quotes,
// e.g. `"${cfg.bind or "127.0.0.1"}:7777"`).
function splitEnvAssignments(s) {
  const out = [];
  let cur = '', inQuote = false, depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '$' && s[i + 1] === '{') { depth++; cur += '${'; i++; continue; }
    if (depth > 0) {
      if (c === '{') depth++;
      else if (c === '}') depth--;
      cur += c;
      continue;
    }
    if (c === '"') { inQuote = !inQuote; cur += c; continue; }
    if (c === ',' && !inQuote) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const unquote = (s) => s.replace(/^['"]/, '').replace(/['"]$/, '');

// Env var names that state a bind address. `_HOST` is included but treated
// conservatively below, because a `*_HOST` far more often names a peer to
// CONNECT to than an interface to bind.
const ENV_BIND = /^(?:[A-Z0-9_]*_)?(BIND|BIND_ADDR|BIND_ADDRESS|LISTEN|LISTEN_ADDR|LISTEN_ADDRESS)$/;
const ENV_HOST = /^(?:[A-Z0-9_]*_)?HOST$/;

// Tokenise a `command=` value. Whitespace splitting is sufficient and
// deliberately blunt: over-collecting tokens is harmless because every
// candidate is then classified, while a clever tokeniser could drop one.
function commandTokens(cmd) {
  return cmd.split(/\s+/).filter(Boolean);
}

// Extract every stated bind address in one block.
export function extractBinds(block, lets) {
  const found = [];
  const add = (o) => found.push({ program: block.program, ...o });

  for (const { n, text } of block.lines) {
    const cmd = /^\s*command=(.*)$/.exec(text);
    if (cmd) {
      const toks = commandTokens(cmd[1]);
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        const eq = t.indexOf('=');
        const flag = eq === -1 ? t : t.slice(0, eq);
        if (BIND_FLAGS.has(flag) || PORT_FLAGS.has(flag)) {
          const raw = eq === -1 ? (toks[i + 1] ?? '') : t.slice(eq + 1);
          if (eq === -1) i++;
          if (!raw) continue;
          // `--port 9095` states no host; only a host:port form does.
          if (PORT_FLAGS.has(flag) && !unquote(raw).includes(':')) continue;
          add({ source: flag, raw: unquote(raw), line: n });
          continue;
        }
        if (t.startsWith('-')) continue;
        // A bare dotted quad IS a bind address, whether it stands alone (the
        // wayvnc shape, `wayvnc --output=HEADLESS-1 0.0.0.0 5901`) or is the
        // value of a flag this gate does not know by name (`--allowed-host
        // 127.0.0.1`). Unknown flags are deliberately NOT allowed to swallow a
        // following address: a missed bind is the failure mode that matters, so
        // the address is reported and merely LABELLED with the preceding flag.
        const bare = /^["']?(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?["']?$/.exec(t);
        if (bare) {
          const prev = toks[i - 1];
          const label = prev && prev.startsWith('-') && !prev.includes('=') ? prev : '(positional)';
          add({ source: label, raw: unquote(t), line: n });
        }
      }
      continue;
    }
    const env = /^\s*environment=(.*)$/.exec(text);
    if (env) {
      for (const assign of splitEnvAssignments(env[1])) {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(assign);
        if (!m) continue;
        const [, name, rawVal] = m;
        const val = unquote(rawVal.trim());
        if (ENV_BIND.test(name)) { add({ source: `env ${name}`, raw: val, line: n }); continue; }
        if (ENV_HOST.test(name)) {
          // Conservative: only an address literal in a *_HOST is read as a bind.
          const probe = val.replace(/^\[|\]$/g, '').split(':')[0];
          if (IPV4.test(probe) || probe === 'localhost' || val.startsWith('[')) {
            add({ source: `env ${name}`, raw: val, line: n });
          }
        }
      }
    }
  }
  return found;
}

// loopback | non-loopback | ignore
export function classifyAddress(value) {
  let v = String(value).trim();
  if (!v) return 'ignore';
  if (v.startsWith('[')) {                       // [::1]:8080 / [::]:8080
    const end = v.indexOf(']');
    if (end === -1) return 'ignore';
    const inner = v.slice(1, end);
    return (inner === '::1' || inner === '0:0:0:0:0:0:0:1') ? 'loopback' : 'non-loopback';
  }
  // A BARE IPv6 literal carries no port (a port needs the bracket form), so it
  // must be judged whole. Without this, `::1` loses its `:1` to the port strip
  // below and `::` — bind every v6 interface — would be silently ignored.
  if ((v.match(/:/g) || []).length >= 2) {
    return (v === '::1' || v === '0:0:0:0:0:0:0:1') ? 'loopback' : 'non-loopback';
  }
  // Strip a :port suffix only when what precedes it looks like a host.
  const lastColon = v.lastIndexOf(':');
  if (lastColon > 0 && /^\d+$/.test(v.slice(lastColon + 1))) v = v.slice(0, lastColon);
  if (v === 'localhost' || v === '::1') return 'loopback';
  if (v === '::' || v === '*') return 'non-loopback';
  if (IPV4.test(v)) return v.startsWith('127.') ? 'loopback' : 'non-loopback';
  if (/^%\(ENV_[A-Z0-9_]+\)s$/.test(v)) return 'ignore';   // supervisord's own expansion
  if (/^[A-Za-z][A-Za-z0-9.-]*$/.test(v)) return 'non-loopback';  // a hostname bind
  return 'ignore';
}

function listenerSanction(program) {
  return LISTENER_SANCTIONED.find((s) => s.program === program);
}

// The listener gate over the generated supervisord text in flake.nix.
export function checkListeners(text) {
  const lets = collectNixLetBindings(text);
  const listeners = [], violations = [], unresolved = [];
  for (const block of splitProgramBlocks(text)) {
    for (const b of extractBinds(block, lets)) {
      const r = resolveNixValue(b.raw, lets);
      if (!r.ok) {
        unresolved.push(`flake.nix:${b.line}: [program:${b.program}] ${b.source} ${b.raw} — UNRESOLVED: ${r.why}`);
        listeners.push({ ...b, verdict: 'UNRESOLVED', address: b.raw });
        continue;
      }
      const verdict = classifyAddress(r.value);
      if (verdict === 'ignore') continue;
      const entry = { ...b, address: r.value, defaulted: r.defaulted, verdict };
      if (verdict === 'non-loopback') {
        const s = listenerSanction(b.program);
        if (s) entry.sanction = s.reason;
        else violations.push(`flake.nix:${b.line}: [program:${b.program}] ${b.source} ${b.raw === r.value ? b.raw : `${b.raw} -> ${r.value}`} binds ${r.value} — non-loopback, not sanctioned`);
      }
      listeners.push(entry);
    }
  }
  return { listeners, violations, unresolved };
}

function renderListeners(listeners) {
  const out = [];
  const width = Math.max(0, ...listeners.map((l) => l.program.length + l.source.length));
  for (const l of listeners) {
    const head = `[program:${l.program}] ${l.source}`.padEnd(width + 12);
    const marks = [];
    if (l.verdict === 'loopback') marks.push('loopback');
    if (l.verdict === 'non-loopback') marks.push('NON-LOOPBACK');
    if (l.verdict === 'UNRESOLVED') marks.push('UNRESOLVED');
    if (l.defaulted) marks.push('manifest-overridable');
    if (l.sanction) marks.push(`sanctioned: ${l.sanction}`);
    out.push(`    ${head} ${l.address}  [${marks.join('; ')}]  flake.nix:${l.line}`);
  }
  return out;
}

// Run the listener rule against `<root>/flake.nix`. A root with no flake.nix
// (the shape every compose fixture uses) reports that the rule did not apply
// rather than inventing a pass or a failure.
function runListenerRule(root) {
  const flake = path.join(root, 'flake.nix');
  if (!fs.existsSync(flake)) {
    console.log('NOTE (check-listeners, ADR-2062): no flake.nix under the audited root — the listener rule did not apply.');
    return 0;
  }
  const { listeners, violations, unresolved } = checkListeners(fs.readFileSync(flake, 'utf8'));
  if (unresolved.length) {
    console.error('FAIL (check-listeners, ADR-2062): bind address(es) whose Nix interpolation could not be');
    console.error('  resolved to a literal. An address this gate cannot resolve cannot be audited, so it is');
    console.error('  rejected rather than skipped:');
    for (const u of unresolved) console.error(`    ${u}`);
  }
  if (violations.length) {
    console.error('FAIL (check-listeners, ADR-2062): supervised program(s) bind a non-loopback address without');
    console.error('  authenticating. A loopback compose publish does not constrain container->container traffic');
    console.error('  on the shared bridge, so these are reachable by every sibling container:');
    for (const v of violations) console.error(`    ${v}`);
    console.error('  Bind 127.0.0.1 where the surface is reached only by a co-resident process (ADR-2040 case 1),');
    console.error('  authenticate it (ADR-2040 case 2), or add the program to LISTENER_SANCTIONED in');
    console.error('  scripts/ci/check-ports-loopback.mjs with a reason citing the governing record.');
  }
  const enumeration = renderListeners(listeners);
  const sink = (unresolved.length || violations.length) ? console.error : console.log;
  sink(`LISTENERS (check-listeners, ADR-2062): ${listeners.length} declared bind address(es) across the generated supervisor blocks`);
  for (const line of enumeration) sink(line);
  if (unresolved.length) return 2;
  if (violations.length) return 1;
  return 0;
}

function main(argv) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = argv[0] ? path.resolve(argv[0]) : path.resolve(here, '../..');
  let names;
  try { names = fs.readdirSync(root); }
  catch (e) { console.error(`FAIL (check-ports-loopback): cannot read ${root}: ${e.message}`); return 3; }
  const files = names.filter((n) => /^docker-compose.*\.ya?ml$/.test(n)).sort()
    .map((n) => path.join(root, n)).filter((f) => fs.statSync(f).isFile());
  if (files.length === 0) {
    console.error(`FAIL (check-ports-loopback): no docker-compose*.yml found under ${root}`);
    return 3;
  }
  const violations = [], unparseable = [];
  let audited = 0;
  for (const f of files) {
    const r = checkFile(f);
    if (r.unparseable) { unparseable.push(r.unparseable); continue; }
    audited += r.ports;
    violations.push(...r.violations);
  }
  // --- the publish rule (ADR-2013). Its output format is load-bearing: other
  // --- tooling parses these exact lines, so nothing here changes shape.
  let publishCode = 0;
  if (unparseable.length) {
    console.error('FAIL (check-ports-loopback): compose file(s) could not be parsed. A file this gate');
    console.error('  cannot parse cannot be audited, so it is rejected rather than skipped:');
    for (const u of unparseable) console.error(`    ${u}`);
    publishCode = 2;
  } else if (violations.length) {
    console.error('FAIL (check-ports-loopback): ports entries that are not loopback, not sanctioned,');
    console.error('  or not auditable (interpolation/ranges/IPv6/bare container ports are rejected):');
    for (const v of violations) console.error(`    ${v}`);
    console.error('  Bind 127.0.0.1:, or add the exact normalised mapping to SANCTIONED in');
    console.error('  scripts/ci/check-ports-loopback.mjs with a citation to the governing record.');
    publishCode = 1;
  } else {
    console.log(`PASS (check-ports-loopback): ${files.length} compose file(s), ${audited} ports block(s) — all publishes loopback-only or explicitly sanctioned`);
  }

  // --- the listener rule (ADR-2062). Always runs, whatever the publish rule
  // --- decided, so one invocation reports both planes rather than hiding the
  // --- second behind a failure in the first.
  const listenerCode = runListenerRule(root);

  return publishCode || listenerCode;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-ports-loopback.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
