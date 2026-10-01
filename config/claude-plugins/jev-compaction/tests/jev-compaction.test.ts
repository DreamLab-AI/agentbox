// Engine-level tests for the ADR-2093 amendment (2026-09-25): the plugin runs
// under the real engine chain, with the session, the network and the clock
// answered beneath it. Run: claude plugin test config/claude-plugins/jev-compaction
//
// The pure decisions are covered by tests/config/jev-compaction-policy.test.mjs;
// these prove the hooks wire them: taint is sticky across a summary, the token
// trigger fires with hysteresis, and an idle large session compacts while warm.

import { describe, expect, mock, test } from 'claude-code/testing';
import type { On, SessionMessage } from 'claude-code';
import type { MockClock } from 'claude-code/testing';

const SID = 'session-under-test';
const EMAIL: SessionMessage = { role: 'assistant', text: '', toolUses: [{ tool_use_id: 't1', tool: 'mcp__email-gateway__ask_email', input: { q: 'invoice' } }] };
const SUMMARY: SessionMessage = { role: 'user', text: 'Summary: the invoice from X said pay by Friday.', toolUses: [] };

type World = {
  fetches: number; bodies: string[]; usageReads: number; compacts: string[]; tokens: number; messages: SessionMessage[]; clock: MockClock;
  /** When set, http.fetch waits this long on the virtual clock before answering. */
  stallMs?: number;
  /** When true, http.fetch answers every question with noul 0 (drop everything). */
  answer?: boolean;
};

/** Answer every engine noun the plugin reads, beneath it; record what reaches the bottom. */
function world(on: On, init: Partial<World> = {}): World {
  const w: World = { fetches: 0, bodies: [], usageReads: 0, compacts: [], tokens: 0, messages: [], ...init, clock: mock.clock(on, { now: 1_800_000_000_000 }) };
  mock.store(on);
  mock.env(on, { TYPESAFE_API_KEY: 'test-key' });
  on('session.id', async () => ({ value: SID }));
  on('session.messages', async () => ({ value: w.messages }));
  on('session.usage', async () => (w.usageReads += 1, { value: { context: { tokens: w.tokens, window: 1_000_000, percent: Math.round(w.tokens / 10_000) }, rateLimits: [{ window: 'five_hour' } as never] } }));
  on('http.fetch', async (_$, e) => {
    w.fetches += 1;
    w.bodies.push(e.init?.body ?? '');
    if (w.stallMs) await w.clock.sleep(w.stallMs);
    if (!w.answer) return { value: { status: 500, ok: false, headers: {}, text: 'no' } };
    const { questions } = JSON.parse(e.init?.body ?? '{}') as { questions: Record<string, unknown> };
    const answers = Object.fromEntries(Object.keys(questions).map((k) => [k, { type: 'noul', noul: 0 }]));
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers }) } };
  });
  on('session.compact', async (_$, e) => { w.compacts.push(e.trigger ?? 'plugin'); return { messages: [SUMMARY] }; });
  on('ui.log', async () => ({ value: undefined }));
  on('ui.toast', async () => ({ value: undefined }));
  on('command.register', async () => ({ value: { command: 'jev-compact' } }));
  on('turn.complete', async () => ({ text: '' }));
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }));
  on('tool.call', async () => ({ result: 'ok' }) as never);
  on('skill.prompt', async (_$, e) => ({ text: e.text }));
  return w;
}

/** A clean stretch of work Jev would be asked about: twelve Reads with large results. */
function cleanWork(): SessionMessage[] {
  const msgs: SessionMessage[] = [{ role: 'user', text: 'Tidy the parser.', toolUses: [] }];
  for (let i = 0; i < 12; i++) {
    msgs.push({ role: 'assistant', text: '', toolUses: [{ tool_use_id: `r${i}`, tool: 'Read', input: { file_path: `/src/f${i}.rs` } }] });
    msgs.push({ role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: `r${i}`, text: 'fn main() {}\n'.repeat(200), isError: false }] });
  }
  return msgs;
}

const turnDone = { answer: '', durationMs: 1, isAborted: false, turnId: 'turn', reason: 'answer' as const };

describe('sticky taint', () => {
  test('a summary that absorbed email is never sent to Jev at the next compaction', async ($, on) => {
    const w = world(on, { messages: [EMAIL] });
    // The first compaction sees the email call: built-in summary.
    await $.session.compact({ trigger: 'manual', messages: [EMAIL] } as never);
    expect(w.fetches).toBe(0);
    // The transcript is now only the summary text — no email tool call left to find.
    w.messages = [SUMMARY, ...cleanWork()];
    await $.session.compact({ trigger: 'manual', messages: w.messages } as never);
    expect(w.fetches).toBe(0);
    expect(w.compacts).toEqual(['manual', 'manual']);
  });

  test('the taint is recorded at the tool call itself, before any scan', async ($, on) => {
    const w = world(on);
    await $.tool.call({ tool: 'mcp__email-gateway__ask_email', q: 'x' } as never);
    await $.session.compact({ trigger: 'manual', messages: [SUMMARY, ...cleanWork()] } as never);
    expect(w.fetches).toBe(0);
  });

  test('the email skill expanded as a slash command taints the session', async ($, on) => {
    const w = world(on);
    await $.skill.prompt({ skill: 'email-search', text: 'search mail' });
    await $.session.compact({ trigger: 'manual', messages: [SUMMARY, ...cleanWork()] } as never);
    expect(w.fetches).toBe(0);
  });

  test('a clean session still goes to Jev (fetch attempted, then fails open)', async ($, on) => {
    const w = world(on);
    const msgs = cleanWork();
    await $.session.compact({ trigger: 'manual', messages: msgs } as never);
    expect(w.fetches).toBeGreaterThan(0);
    expect(w.compacts).toEqual(['manual']);
  });
});

describe('token trigger with hysteresis', () => {
  test('180k on a 1M window compacts; the next turn above the trigger but not re-armed does not', async ($, on) => {
    const w = world(on, { tokens: 185_000 });
    await $.turn.complete(turnDone as never);
    expect(w.compacts).toEqual(['plugin']);
    // First turn after: the post-compaction size becomes the baseline.
    w.tokens = 190_000;
    await $.turn.complete(turnDone as never);
    w.tokens = 200_000;
    await $.turn.complete(turnDone as never);
    expect(w.compacts).toEqual(['plugin']);
    // Grown 40k past the baseline: re-armed.
    w.tokens = 230_000;
    await $.turn.complete(turnDone as never);
    expect(w.compacts).toEqual(['plugin', 'plugin']);
  });
});

describe('cache-warm nudge', () => {
  test('an idle session above the floor compacts just before a 1 h cache expires', async ($, on) => {
    const w = world(on, { tokens: 120_000 });
    const clock = w.clock;
    await $.turn.complete(turnDone as never);
    expect(w.compacts).toEqual([]);
    await clock.advance(3_300_000 - 1);
    expect(w.compacts).toEqual([]);
    await clock.advance(1);
    expect(w.compacts).toEqual(['plugin']);
  });

  test('a new turn cancels the pending nudge', async ($, on) => {
    const w = world(on, { tokens: 120_000 });
    const clock = w.clock;
    await $.turn.complete(turnDone as never);
    await $.turn.start({ text: 'next', turnId: 't2' });
    await clock.advance(3_600_000);
    expect(w.compacts).toEqual([]);
  });

  test('below the floor nothing is armed', async ($, on) => {
    const w = world(on, { tokens: 50_000 });
    const clock = w.clock;
    await $.turn.complete(turnDone as never);
    await clock.advance(4_000_000);
    expect(w.compacts).toEqual([]);
  });
});

// ── amendment 2026-10-01: ported from upstream PRs #112 (#107), #117, #98 ──

describe('scope: precompute and subagent compactions never reach Jev', () => {
  test('a precompute is skipped before Jev and before core', async ($, on) => {
    const w = world(on);
    const r = await $.session.compact({ trigger: 'precompute', messages: cleanWork() } as never);
    expect(w.fetches).toBe(0);
    expect(w.compacts).toEqual([]);
    expect((r as { skip?: string }).skip).toContain('precompute');
  });

  test("a subagent's own transcript goes to core, and its email use still taints the session", async ($, on) => {
    const w = world(on);
    await $.session.compact({ trigger: 'auto', agentId: 'agent-1', messages: [EMAIL, ...cleanWork()] } as never);
    expect(w.fetches).toBe(0);
    expect(w.compacts).toEqual(['auto']);
    // The main conversation is clean, but the session is now tainted.
    await $.session.compact({ trigger: 'manual', messages: cleanWork() } as never);
    expect(w.fetches).toBe(0);
  });
});

describe('turn.complete: only completed main-loop answers trigger, one at a time', () => {
  test('an aborted or errored turn above the trigger does not compact', async ($, on) => {
    const w = world(on, { tokens: 185_000 });
    await $.turn.complete({ ...turnDone, reason: 'aborted', isAborted: true } as never);
    await $.turn.complete({ ...turnDone, reason: 'error' } as never);
    expect(w.compacts).toEqual([]);
    await $.turn.complete(turnDone as never);
    expect(w.compacts).toEqual(['plugin']);
  });

  test('two overlapping turn completions: one evaluates, the other passes straight through', async ($, on) => {
    const w = world(on, { tokens: 185_000 });
    // Counted beneath the plugin: the guard is claimed before the first await, so the
    // second dispatch never reads usage, never writes the baseline, never arms a nudge.
    await Promise.all([$.turn.complete(turnDone as never), $.turn.complete(turnDone as never)]);
    expect(w.compacts).toEqual(['plugin']);
    expect(w.usageReads).toBe(1);
    // Released by its claimant: the next turn evaluates again.
    await $.turn.complete(turnDone as never);
    expect(w.usageReads).toBe(2);
  });
});

describe('deadline: a stalled Jev falls open to the built-in summary', () => {
  test('past 15 s the built-in summary runs; the late answer installs nothing', async ($, on) => {
    const w = world(on, { stallMs: 60_000, answer: true });
    let settled = false;
    const pending = $.session.compact({ trigger: 'manual', messages: cleanWork() } as never).then((r) => { settled = true; return r; });
    await w.clock.settle();
    expect(w.fetches).toBeGreaterThan(0);
    await w.clock.advance(14_999);
    expect(settled).toBe(false);
    expect(w.compacts).toEqual([]);
    await w.clock.advance(1);
    const r = await pending;
    expect(w.compacts).toEqual(['manual']);
    expect(r.messages?.[0]?.text).toBe(SUMMARY.text);
    await w.clock.advance(60_000);
    expect(w.compacts).toEqual(['manual']);
  });

  test('an answer inside the deadline compacts verbatim, no summary', async ($, on) => {
    const w = world(on, { stallMs: 1_000, answer: true });
    const msgs = cleanWork();
    const pending = $.session.compact({ trigger: 'manual', messages: msgs } as never);
    await w.clock.settle();
    await w.clock.advance(1_000);
    const r = await pending;
    expect(w.compacts).toEqual([]);
    expect(r.messages?.[0]?.text).toBe('Tidy the parser.');
    expect((r.messages?.length ?? 0)).toBeLessThan(msgs.length);
  });
});

describe('redaction: credentials never reach the Jev request body', () => {
  test('a token in a tool input and the plugin key are redacted; the transcript is not', async ($, on) => {
    const w = world(on);
    const token = ['gh', 'p_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('');
    const msgs = cleanWork();
    msgs.splice(1, 0,
      { role: 'assistant', text: 'pushing with test-key', toolUses: [{ tool_use_id: 'b1', tool: 'Bash', input: { command: `git push https://x:${token}@github.com/o/r` } }] },
      { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'b1', text: 'ok', isError: false }] },
    );
    const before = JSON.stringify(msgs);
    await $.session.compact({ trigger: 'manual', messages: msgs } as never);
    expect(w.fetches).toBeGreaterThan(0);
    const sent = w.bodies.join('\n');
    expect(sent).not.toContain(token);
    expect(sent).not.toContain('test-key');
    expect(sent).toContain('[REDACTED]');
    expect(JSON.stringify(msgs)).toBe(before);
  });
});
