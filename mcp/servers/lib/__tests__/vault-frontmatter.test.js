'use strict';
// Unit tests for vault-frontmatter.js — the V2 frontmatter reader/writer.
// Run: node --test mcp/servers/lib/__tests__/vault-frontmatter.test.js
//      npm run test:vault
//
// The contract under test is project/docs/VAULT-corpus-format.md §V2 (frontmatter
// shape), §V5 (writers emit vault format only, converting a legacy leading block
// on write) and Invariant 6 (legacy tolerance is bounded to the LEADING block).

const test = require('node:test');
const assert = require('node:assert');

const {
  parseLeadingBlock,
  toFrontmatter,
  ensureFrontmatter,
} = require('../vault-frontmatter');

// ── parseLeadingBlock ────────────────────────────────────────────────────────

test('parseLeadingBlock: reads a V2 frontmatter block and splits the body', () => {
  const page = '---\npublic: true\ntitle: Smart Contract\n---\n\n# Smart Contract\n\nbody text\n';
  const r = parseLeadingBlock(page);
  assert.equal(r.kind, 'frontmatter');
  assert.equal(r.props.public, true, 'public is a real boolean, not "true"');
  assert.equal(r.props.title, 'Smart Contract');
  assert.equal(r.body, '\n# Smart Contract\n\nbody text\n');
});

test('parseLeadingBlock: reads a legacy Logseq leading property block', () => {
  const page = 'public:: true\nalias:: AI Agent, Agent\nowl:class:: mv:Foo\n\n# Title\n';
  const r = parseLeadingBlock(page);
  assert.equal(r.kind, 'logseq');
  assert.equal(r.props.public, true);
  assert.deepEqual(r.props.aliases, ['AI Agent', 'Agent'], 'alias:: maps to the aliases list');
  assert.equal(r.props['owl-class'], 'mv:Foo', 'owl:class:: maps to owl-class');
  assert.equal(r.body, '\n# Title\n');
});

test('parseLeadingBlock: a page with no property block is kind "none" and keeps its body whole', () => {
  const page = '# Just a heading\n\nsome prose\n';
  const r = parseLeadingBlock(page);
  assert.equal(r.kind, 'none');
  assert.deepEqual(r.props, {});
  assert.equal(r.body, page);
  assert.equal(r.raw, '');
});

test('parseLeadingBlock: body-level key:: value lines are NOT metadata (Invariant 6)', () => {
  // 193 pages in the 2026-09-02 corpus carry body-level properties. The block
  // ends at the first non-property line; everything after is body, untouched.
  const page = 'public:: true\n\n# Title\n\n- claim\n  source:: somewhere\n  confidence:: 0.9\n';
  const r = parseLeadingBlock(page);
  assert.equal(r.kind, 'logseq');
  assert.deepEqual(Object.keys(r.props), ['public'], 'only the leading block is parsed');
  assert.ok(r.body.includes('source:: somewhere'), 'body-level properties survive verbatim');
  assert.ok(r.body.includes('confidence:: 0.9'));
});

test('parseLeadingBlock: a property-looking line after a heading is body, not metadata', () => {
  const page = '# Title\n\npublic:: true\n';
  const r = parseLeadingBlock(page);
  assert.equal(r.kind, 'none');
  assert.equal(r.body, page);
});

test('parseLeadingBlock: collapsed:: and id:: are dropped (outliner-only)', () => {
  const r = parseLeadingBlock('public:: true\ncollapsed:: true\nid:: 64f0-abc\n\nbody\n');
  assert.deepEqual(Object.keys(r.props), ['public']);
});

test('parseLeadingBlock: frontmatter block sequences and flow lists both parse', () => {
  const block = '---\npublic: true\naliases:\n  - "AI Agent"\n  - Agent\ntags: [ai, agents]\n---\nbody\n';
  const r = parseLeadingBlock(block);
  assert.deepEqual(r.props.aliases, ['AI Agent', 'Agent']);
  assert.deepEqual(r.props.tags, ['ai', 'agents']);
});

// ── toFrontmatter ────────────────────────────────────────────────────────────

test('toFrontmatter: emits a delimited block with public as a real YAML boolean', () => {
  const out = toFrontmatter({ public: true });
  assert.equal(out, '---\npublic: true\n---\n');
  assert.ok(!out.includes('"true"'), 'never the string "true" (V2 rule)');
});

test('toFrontmatter: quotes wikilink values (V2 rule)', () => {
  const out = toFrontmatter({ public: true, elevatedFrom: '[[Working Page]]' });
  assert.ok(out.includes('elevatedFrom: "[[Working Page]]"'), out);
});

test('toFrontmatter: lists render as block sequences', () => {
  const out = toFrontmatter({ public: true, aliases: ['A', 'B'] });
  assert.equal(out, '---\npublic: true\naliases:\n  - A\n  - B\n---\n');
});

test('toFrontmatter: well-known keys lead, extras keep insertion order', () => {
  const out = toFrontmatter({ zeta: '1', 'owl-class': 'mv:Foo', public: true, alpha: 'x' });
  const keys = out.split('\n').slice(1, -2).map((l) => l.split(':')[0]);
  assert.deepEqual(keys, ['public', 'owl-class', 'zeta', 'alpha']);
});

test('toFrontmatter: values that would parse as another YAML type are quoted', () => {
  const out = toFrontmatter({ public: true, title: '2026-09-02', version: 'true' });
  assert.ok(out.includes('title: "2026-09-02"'), out);
  assert.ok(out.includes('version: "true"'), out);
});

// ── ensureFrontmatter ────────────────────────────────────────────────────────

test('ensureFrontmatter: converts a legacy leading block to frontmatter (V5)', () => {
  const legacy = 'public:: true\nsource-domain:: ai\n\n# AI Agent\n\nprose\n';
  const r = ensureFrontmatter(legacy);
  assert.equal(r.converted, true);
  assert.equal(r.changed, true);
  assert.ok(r.text.startsWith('---\npublic: true\n'), r.text);
  assert.ok(r.text.includes('source-domain: ai'));
  assert.ok(!/^public:: /m.test(r.text), 'no key:: value line survives on write (Invariant 1)');
  assert.ok(r.text.includes('# AI Agent'), 'body preserved');
});

test('ensureFrontmatter: adds public: true to a page with no property block at all', () => {
  const r = ensureFrontmatter('# New Page\n\nbody\n');
  assert.equal(r.converted, false);
  assert.equal(r.props.public, true);
  assert.equal(r.text, '---\npublic: true\n---\n\n# New Page\n\nbody\n');
});

test('ensureFrontmatter: is idempotent — a second pass changes nothing', () => {
  const once = ensureFrontmatter('public:: true\nalias:: A, B\n\n# T\n\nbody\n').text;
  const twice = ensureFrontmatter(once);
  assert.equal(twice.text, once, 'byte-identical on the second pass');
  assert.equal(twice.changed, false);
  assert.equal(twice.converted, false);
});

test('ensureFrontmatter: extraProps win over what the page already declared', () => {
  const r = ensureFrontmatter('---\npublic: false\n---\nbody\n', { public: true, 'owl-class': 'mv:Foo' });
  assert.equal(r.props.public, true);
  assert.ok(r.text.includes('public: true'));
  assert.ok(r.text.includes('owl-class: "mv:Foo"'), r.text);
});

test('ensureFrontmatter: an owl-class page needs no public gate (V4 clause 2)', () => {
  const r = ensureFrontmatter('# Class page\n', { 'owl-class': 'mv:Foo' });
  assert.ok(!Object.prototype.hasOwnProperty.call(r.props, 'public'),
    'owl-class ingests unconditionally; no public key is invented');
});

test('ensureFrontmatter: defaultPublic:false authors a private page (fail-closed gate)', () => {
  const r = ensureFrontmatter('# Draft\n', {}, { defaultPublic: false });
  assert.deepEqual(r.props, {});
  assert.equal(r.text, '---\n---\n\n# Draft\n');
});

test('ensureFrontmatter: legacy public:: false stays false', () => {
  const r = ensureFrontmatter('public:: false\ntype:: podcast-news\n\n# T\n');
  assert.equal(r.props.public, false);
  assert.ok(r.text.includes('public: false'));
});

test('ensureFrontmatter: leaves the JSON-LD fences in the body untouched', () => {
  const page = [
    'public:: true',
    '',
    '# T',
    '```json-ld',
    '{"@type": "Class", "label": "T"}',
    '```',
    '',
  ].join('\n');
  const r = ensureFrontmatter(page);
  assert.ok(r.text.includes('```json-ld\n{"@type": "Class", "label": "T"}\n```'),
    'fences carry over byte-for-byte (V2: frontmatter never duplicates their content)');
});
