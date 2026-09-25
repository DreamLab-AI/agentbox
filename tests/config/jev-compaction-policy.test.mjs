// ADR-2093 — the decisions the jev-compaction plugin makes before anything
// leaves the network. Pure-function tests over hooks/policy.mjs; no engine,
// no network. Run: node --test tests/config/jev-compaction-policy.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_TAINT_SKILLS, DEFAULT_TAINT_TOOLS, decide, listOption, parseSwitchArgs, resolveEnabled, scanTaint, taintsSession,
  skillTaints, mergeTaint, taintRecord, triggerTokens, rearmGap, shouldCompact, cacheTtlSeconds, nudgeDelayMs, cacheWarmMode,
  shouldArmNudge, expiredSessionKeys, SESSION_STATE_TTL_MS,
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
    for (const t of ['Read', 'Bash', 'Edit', 'mcp__claude-flow__memory_search', 'mcp__codebase-memory__search_graph', 'email']) {
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
    const tools = listOption('mcp__email-gateway__, mcp__codebase-memory__', DEFAULT_TAINT_TOOLS);
    assert.equal(taintsSession(use('mcp__codebase-memory__search_graph'), tools, DEFAULT_TAINT_SKILLS), true);
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

// SSO contract §7. The fence exists because the transcript leaves the LAN. A
// provably local judge removes the reason for it — and nothing else. Every test
// below asks the same question from a different angle: can anything other than
// an explicit boolean `true` from resolved config open it?
describe('decide — backendLocal (SSO §7): the fence opens only for a provably local judge', () => {
  const clean = scanTaint([msg(use('Read'))]);
  const dirty = scanTaint([msg(use('mcp__email-gateway__ask_email'))]);

  test('tainted + local backend ⇒ runs, reported as ok-local with the offending call still named', () => {
    const d = decide({ enabled: true, apiKey: 'k', taint: dirty, backendLocal: true });
    assert.equal(d.run, true);
    assert.equal(d.reason, 'ok-local', 'a compacted tainted session must not log as a clean one');
    assert.match(d.detail, /mcp__email-gateway__ask_email/);
  });

  test('tainted + cloud backend ⇒ built-in summary', () => {
    const d = decide({ enabled: true, apiKey: 'k', taint: dirty, backendLocal: false });
    assert.equal(d.run, false);
    assert.equal(d.reason, 'tainted');
  });

  test('tainted + backendLocal omitted ⇒ built-in summary (the safe default)', () => {
    assert.equal(decide({ enabled: true, apiKey: 'k', taint: dirty }).reason, 'tainted');
  });

  test('only the boolean true opens the fence — no truthy value, no string, no URL stands in for it', () => {
    for (const v of [undefined, null, false, 0, 1, '', 'true', 'TRUE', 'yes', 'on', 'local',
      'http://systemone:8097/v1/systemone', '127.0.0.1', {}, [], ['true'], NaN]) {
      const d = decide({ enabled: true, apiKey: 'k', taint: dirty, backendLocal: v });
      assert.equal(d.run, false, `backendLocal=${JSON.stringify(v)} must not open the fence`);
      assert.equal(d.reason, 'tainted', `backendLocal=${JSON.stringify(v)}`);
    }
  });

  test('a local backend does not resurrect a switched-off or keyless session — precedence is unchanged', () => {
    assert.deepEqual(decide({ enabled: false, apiKey: 'k', taint: dirty, backendLocal: true }), { run: false, reason: 'switched-off' });
    assert.deepEqual(decide({ enabled: false, apiKey: 'k', taint: clean, backendLocal: true }), { run: false, reason: 'switched-off' });
    assert.deepEqual(decide({ enabled: true, apiKey: '', taint: dirty, backendLocal: true }), { run: false, reason: 'no-key' });
    assert.deepEqual(decide({ enabled: true, apiKey: undefined, taint: clean, backendLocal: true }), { run: false, reason: 'no-key' });
  });

  test('a clean session is reported as ok on either backend — the relaxation adds no new clean-path reason', () => {
    assert.deepEqual(decide({ enabled: true, apiKey: 'k', taint: clean, backendLocal: true }), { run: true, reason: 'ok' });
    assert.deepEqual(decide({ enabled: true, apiKey: 'k', taint: clean, backendLocal: false }), { run: true, reason: 'ok' });
  });

  // The relaxation is currently INERT in production, and that is deliberate: the
  // façade does not exist yet and [features.sovereign_system_one] defaults off, so
  // the shipped hook calls decide() without the flag and every tainted session still
  // gets the built-in summary. Pinning it here means the day someone wires the flag
  // to resolved config is the day this test fails and asks them to say so out loud.
  test('the shipped hook passes backendLocal from resolved config at every decide() site', () => {
    // Was: an assertion that the fence was NOT yet wired, written so that wiring it
    // could not happen silently. It has now been wired deliberately (ADR-2094 §7), so
    // the assertion is inverted rather than deleted: every call site must pass the flag
    // FROM CONFIG, and none may compute it inline from a URL or any other proxy.
    const src = readFileSync(new URL('../../config/claude-plugins/jev-compaction/hooks/jev-compaction.ts', import.meta.url), 'utf8');
    const calls = src.match(/decide\(\{[^}]*\}\)/g) ?? [];
    assert.ok(calls.length >= 2, 'expected the command.run and session.compact call sites');
    for (const c of calls) {
      assert.match(c, /backendLocal:\s*cfg\.backendLocal/,
        `${c} must take backendLocal from resolved config, not compute it`);
    }
    // The resolver accepts only a real boolean or the projector's literal string.
    assert.match(src, /backendLocal:\s*options\['backendLocal'\] === true \|\| options\['backendLocal'\] === 'true'/);
    // And locality is never derived from the endpoint anywhere in the hook.
    const derived = /backendLocal[^;\n]*(baseUrl|includes\(|startsWith\(|127\.0\.0\.1|localhost)/;
    assert.equal(derived.test(src), false, 'backendLocal must never be inferred from an endpoint');
  });

  test('the ADR-2093 cloud contract is bit-identical when the new input is absent', () => {
    for (const taint of [clean, dirty]) {
      for (const enabled of [true, false]) {
        for (const apiKey of ['k', '']) {
          assert.deepEqual(decide({ enabled, apiKey, taint }), decide({ enabled, apiKey, taint, backendLocal: false }));
        }
      }
    }
  });
});

// ── ADR-2093 amendment 2026-09-25 ─────────────────────────────────────────────
describe('sticky taint — a summary that absorbed email never goes to Jev', () => {
  const dirty = scanTaint([msg(use('mcp__email-gateway__ask_email'))]);
  const summarised = scanTaint([{ role: 'user', text: 'Summary: the invoice from X said…', toolUses: [] }]);
  test('a clean-looking post-summary transcript stays tainted once the session was', () => {
    assert.equal(summarised.tainted, false, 'the leak: the scan alone sees nothing');
    const sticky = taintRecord(dirty, 1);
    const merged = mergeTaint(sticky, summarised);
    assert.equal(merged.tainted, true);
    assert.deepEqual(merged.sample, ['mcp__email-gateway__ask_email']);
    assert.deepEqual(decide({ enabled: true, apiKey: 'k', taint: merged }).reason, 'tainted');
  });
  test('a fresh taint wins over no record; no record and a clean scan stays clean', () => {
    assert.equal(mergeTaint(undefined, dirty).tainted, true);
    assert.equal(mergeTaint(undefined, summarised).tainted, false);
    assert.equal(mergeTaint({ tainted: false }, summarised).tainted, false);
    assert.equal(mergeTaint('garbage', summarised).tainted, false, 'a malformed record is not a taint, but never throws');
  });
  test('the email skill expanded as a command taints, bare or plugin-qualified', () => {
    assert.equal(skillTaints('email-search', DEFAULT_TAINT_SKILLS), true);
    assert.equal(skillTaints('agentbox:email-search', DEFAULT_TAINT_SKILLS), true);
    assert.equal(skillTaints('email-search-extra', DEFAULT_TAINT_SKILLS), false);
    assert.equal(skillTaints('', DEFAULT_TAINT_SKILLS), false);
  });
  test('a local backend still opens the fence for a sticky taint, reported ok-local', () => {
    const merged = mergeTaint(taintRecord(dirty, 1), summarised);
    assert.equal(decide({ enabled: true, apiKey: 'k', taint: merged, backendLocal: true }).reason, 'ok-local');
  });
});

describe('trigger — tokens as well as percent, with hysteresis', () => {
  const base = { compactAtPercent: 60, compactAtTokens: 180_000, rearmTokens: 40_000 };
  test('1M window: the absolute figure wins; 200k window: the percentage does', () => {
    assert.equal(triggerTokens({ window: 1_000_000, ...base }), 180_000);
    assert.equal(triggerTokens({ window: 200_000, ...base }), 120_000);
    assert.equal(triggerTokens({ window: undefined, ...base }), 180_000);
    assert.equal(triggerTokens({ window: 1_000_000, compactAtPercent: 60, compactAtTokens: 0 }), 600_000, '0 disables the absolute cap');
  });
  test('below the trigger nothing happens; at it, with no prior compaction, it runs', () => {
    assert.equal(shouldCompact({ ...base, window: 1_000_000, tokens: 179_999 }).run, false);
    assert.equal(shouldCompact({ ...base, window: 1_000_000, tokens: 180_000 }).run, true);
  });
  test('a compaction that left context above the trigger does not re-run every turn', () => {
    const after = 190_000;
    const v1 = shouldCompact({ ...base, window: 1_000_000, tokens: 200_000, baseline: after });
    assert.deepEqual([v1.run, v1.reason, v1.need], [false, 'hysteresis', 230_000]);
    assert.equal(shouldCompact({ ...base, window: 1_000_000, tokens: 230_000, baseline: after }).run, true);
  });
  test('re-arm gap: explicit tokens, else a quarter of the trigger', () => {
    assert.equal(rearmGap(180_000, 40_000), 40_000);
    assert.equal(rearmGap(180_000, 0), 45_000);
  });
  test('without a token figure the percentage still triggers, but never repeatedly', () => {
    assert.equal(shouldCompact({ ...base, window: 1_000_000, percent: 70 }).run, true);
    assert.equal(shouldCompact({ ...base, window: 1_000_000, percent: 70, baseline: 150_000 }).run, false);
  });
});

describe('cache-warm nudge', () => {
  test('TTL: explicit wins; subscription 1 h; API key 5 min; unknown 1 h', () => {
    assert.equal(cacheTtlSeconds({ configured: 900, rateLimitsCount: 2, hasApiKey: true }), 900);
    assert.equal(cacheTtlSeconds({ configured: 0, rateLimitsCount: 2, hasApiKey: true }), 3600);
    assert.equal(cacheTtlSeconds({ configured: 0, rateLimitsCount: 0, hasApiKey: true }), 300);
    assert.equal(cacheTtlSeconds({ configured: 0, rateLimitsCount: 0, hasApiKey: false }), 3600);
  });
  test('delay: TTL minus margin, or half a TTL the margin would swallow', () => {
    assert.equal(nudgeDelayMs(3600, 300), 3_300_000);
    assert.equal(nudgeDelayMs(300, 300), 150_000);
  });
  test('armed only above the floor and only once grown past the last compaction', () => {
    assert.equal(shouldArmNudge({ tokens: 90_000, floorTokens: 100_000, gap: 40_000 }), false);
    assert.equal(shouldArmNudge({ tokens: 120_000, floorTokens: 100_000, gap: 40_000 }), true);
    assert.equal(shouldArmNudge({ tokens: 120_000, floorTokens: 100_000, baseline: 110_000, gap: 40_000 }), false);
    assert.equal(shouldArmNudge({ tokens: 150_000, floorTokens: 100_000, baseline: 110_000, gap: 40_000 }), true);
  });
  test('mode parsing defaults to compact; off and notify are opt-outs', () => {
    assert.equal(cacheWarmMode(undefined), 'compact');
    assert.equal(cacheWarmMode('OFF'), 'off');
    assert.equal(cacheWarmMode(false), 'off');
    assert.equal(cacheWarmMode('notify'), 'notify');
  });
  test('per-session store keys expire after 30 days; other keys are never pruned', () => {
    const now = SESSION_STATE_TTL_MS * 2;
    const keys = expiredSessionKeys([
      ['taint:old', { at: 0 }], ['taint:new', { at: now - 1000 }], ['baseline:junk', 'x'],
      ['enabled', true], ['last', 'note'],
    ], now);
    assert.deepEqual(keys, ['taint:old', 'baseline:junk']);
  });
});
