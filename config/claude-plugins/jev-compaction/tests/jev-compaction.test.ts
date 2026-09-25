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

type World = { fetches: number; compacts: string[]; tokens: number; messages: SessionMessage[]; clock: MockClock };

/** Answer every engine noun the plugin reads, beneath it; record what reaches the bottom. */
function world(on: On, init: Partial<World> = {}): World {
  const w: World = { fetches: 0, compacts: [], tokens: 0, messages: [], ...init, clock: mock.clock(on, { now: 1_800_000_000_000 }) };
  mock.store(on);
  mock.env(on, { TYPESAFE_API_KEY: 'test-key' });
  on('session.id', async () => ({ value: SID }));
  on('session.messages', async () => ({ value: w.messages }));
  on('session.usage', async () => ({ value: { context: { tokens: w.tokens, window: 1_000_000, percent: Math.round(w.tokens / 10_000) }, rateLimits: [{ window: 'five_hour' } as never] } }));
  on('http.fetch', async () => { w.fetches += 1; return { value: { status: 500, ok: false, headers: {}, text: 'no' } }; });
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
