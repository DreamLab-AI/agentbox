// ADR-2093 — the decisions the jev-compaction plugin makes before anything
// leaves the network. Pure-function tests over hooks/policy.mjs; no engine,
// no network. Run: node --test tests/config/jev-compaction-policy.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TAINT_SKILLS, DEFAULT_TAINT_TOOLS, decide, listOption, parseSwitchArgs, resolveEnabled, scanTaint, taintsSession,
} from '../../config/claude-plugins/jev-compaction/hooks/policy.mjs';

const use = (tool, input = {}) => ({ tool_use_id: 'x', tool, input });
const msg = (...toolUses) => ({ role: 'assistant', text: '', toolUses });

describe('taint — email never leaves', () => {
  test('every email-gateway tool taints, by prefix', () => {
    for (const t of ['mcp__email-gateway__ask_email', 'mcp__email-gateway__fetch_email_raw', 'mcp__email-gateway__refresh_inbox']) {
      assert.equal(taintsSession(use(t), DEFAULT_TAINT_TOOLS, DEFAULT_TAINT_SKILLS), true, t);
    }
    assert.equal(taintsSession(use('mcp__claude_ai_Gmail__authenticate'), DEFAULT_TAINT_TOOLS, DEFAULT_TAINT_SKILLS), true);
  });
  test('a Skill load of email-search taints; other skills do not', () => {
    assert.equal(taintsSession(use('Skill', { skill: 'email-search' }), DEFAULT_TAINT_TOOLS, DEFAULT_TAINT_SKILLS), true);
    assert.equal(taintsSession(use('Skill', { skill: 'diagrams-as-code' }), DEFAULT_TAINT_TOOLS, DEFAULT_TAINT_SKILLS), false);
  });
  test('ordinary tools and other MCP servers are clean', () => {
    for (const t of ['Read', 'Bash', 'Edit', 'mcp__claude-flow__memory_search', 'mcp__ontology-bridge__ontology_ask', 'email']) {
      assert.equal(taintsSession(use(t), DEFAULT_TAINT_TOOLS, DEFAULT_TAINT_SKILLS), false, t);
    }
  });
  test('prefix is anchored at the start — a tool merely mentioning the prefix does not match', () => {
    assert.equal(taintsSession(use('mcp__other__mcp__email-gateway__x'), DEFAULT_TAINT_TOOLS, DEFAULT_TAINT_SKILLS), false);
  });
  test('scanTaint finds a single email call anywhere in a long transcript, pinned or not', () => {
    const clean = Array.from({ length: 50 }, () => msg(use('Read'), use('Bash')));
    assert.deepEqual(scanTaint(clean), { tainted: false, count: 0, sample: [] });
    const dirty = [...clean.slice(0, 10), msg(use('mcp__email-gateway__ask_email')), ...clean.slice(10)];
    const r = scanTaint(dirty);
    assert.equal(r.tainted, true); assert.equal(r.count, 1); assert.deepEqual(r.sample, ['mcp__email-gateway__ask_email']);
    const last = [...clean, msg(use('Skill', { skill: 'email-search' }))];
    assert.equal(scanTaint(last).tainted, true, 'a taint in the pinned tail still taints');
  });
  test('per-project fences: extra prefixes add to the rule, they do not replace email', () => {
    const tools = listOption('mcp__email-gateway__, mcp__ontology-bridge__', DEFAULT_TAINT_TOOLS);
    assert.equal(taintsSession(use('mcp__ontology-bridge__kg_neighbors'), tools, DEFAULT_TAINT_SKILLS), true);
    assert.equal(taintsSession(use('mcp__email-gateway__ask_email'), tools, DEFAULT_TAINT_SKILLS), true);
  });
  test('malformed messages never throw', () => {
    assert.equal(scanTaint(null).tainted, false);
    assert.equal(scanTaint([{}, { toolUses: [null, {}, { tool: 7 }] }]).tainted, false);
  });
});

describe('the switch', () => {
  test('store beats manifest default; nothing set ⇒ on', () => {
    assert.equal(resolveEnabled(undefined, undefined), true);
    assert.equal(resolveEnabled(undefined, false), false);
    assert.equal(resolveEnabled(undefined, 'off'), false);
    assert.equal(resolveEnabled(true, false), true);
    assert.equal(resolveEnabled(false, true), false);
  });
  test('/jev-compact args', () => {
    assert.equal(parseSwitchArgs('on'), 'on'); assert.equal(parseSwitchArgs(' OFF '), 'off');
    assert.equal(parseSwitchArgs(''), 'status'); assert.equal(parseSwitchArgs('status'), 'status');
    assert.equal(parseSwitchArgs('maybe'), 'help');
  });
  test('listOption accepts arrays, comma strings, and falls back', () => {
    assert.deepEqual(listOption(['a', ' b '], ['z']), ['a', 'b']);
    assert.deepEqual(listOption('a, b,,', ['z']), ['a', 'b']);
    assert.deepEqual(listOption('', ['z']), ['z']);
    assert.deepEqual(listOption(undefined, DEFAULT_TAINT_TOOLS), [...DEFAULT_TAINT_TOOLS]);
  });
});

describe('decide — the built-in summary is the normal path, with a named reason', () => {
  const clean = scanTaint([msg(use('Read'))]);
  const dirty = scanTaint([msg(use('mcp__email-gateway__ask_email'))]);
  test('switched off wins over everything', () => {
    assert.deepEqual(decide({ enabled: false, apiKey: 'k', taint: clean }), { run: false, reason: 'switched-off' });
  });
  test('no key ⇒ no request', () => {
    assert.deepEqual(decide({ enabled: true, apiKey: '', taint: clean }), { run: false, reason: 'no-key' });
  });
  test('tainted ⇒ built-in summary, with the offending tool named', () => {
    const d = decide({ enabled: true, apiKey: 'k', taint: dirty });
    assert.equal(d.run, false); assert.equal(d.reason, 'tainted'); assert.match(d.detail, /mcp__email-gateway__ask_email/);
  });
  test('clean, on, keyed ⇒ run', () => {
    assert.deepEqual(decide({ enabled: true, apiKey: 'k', taint: clean }), { run: true, reason: 'ok' });
  });
});
