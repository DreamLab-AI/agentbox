'use strict';

/**
 * Unit test for config/hooks/nostr-live-mirror.cjs REC-9 provenance reference
 * (PRD-019 / ADR-037 D5).
 *
 * Locks the falsification clauses:
 *   1. a mirrored turn carries a resolvable urn:agentbox:activity reference;
 *   2. the reference resolves (structurally) to the execution/activity record;
 *   3. the reference stays WITHIN the per-message rumor body cap — the urn is
 *      never truncated even when the turn text is huge;
 *   4. fail-open: a missing/unmintable urn degrades to text-only.
 */

const mirror = require('../../config/hooks/nostr-live-mirror.cjs');
const uris = require('../../management-api/lib/uris.js');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('nostr-live-mirror event selection', () => {
  let previous;
  let dir;
  let payload;
  beforeEach(() => {
    previous = process.env.AGENTBOX_LIVE_MIRROR_EVENTS;
    delete process.env.AGENTBOX_LIVE_MIRROR_EVENTS;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-events-'));
    const transcript = path.join(dir, 'transcript.jsonl');
    fs.writeFileSync(transcript, JSON.stringify({ message: { role: 'assistant', content: 'Synthetic reply' } }) + '\n');
    payload = { session_id: 'test-session', prompt: 'Synthetic prompt', transcript_path: transcript };
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.AGENTBOX_LIVE_MIRROR_EVENTS;
    else process.env.AGENTBOX_LIVE_MIRROR_EVENTS = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  test('defaults to Stop only', () => {
    expect(mirror.bodyForEvent('Stop', payload)).toContain('Synthetic reply');
    for (const event of ['SessionStart', 'UserPromptSubmit', 'SessionEnd']) {
      expect(mirror.bodyForEvent(event, payload)).toBeNull();
    }
  });
  test('explicit events restore the broader mirror', () => {
    process.env.AGENTBOX_LIVE_MIRROR_EVENTS = 'SessionStart,UserPromptSubmit,Stop,SessionEnd';
    for (const event of process.env.AGENTBOX_LIVE_MIRROR_EVENTS.split(',')) {
      expect(mirror.bodyForEvent(event, payload)).not.toBeNull();
    }
  });
  test('a trimmed subset excludes other events', () => {
    process.env.AGENTBOX_LIVE_MIRROR_EVENTS = ' UserPromptSubmit , SessionEnd ';
    expect(mirror.bodyForEvent('UserPromptSubmit', payload)).toContain('Synthetic prompt');
    expect(mirror.bodyForEvent('SessionEnd', payload)).not.toBeNull();
    expect(mirror.bodyForEvent('Stop', payload)).toBeNull();
    expect(mirror.bodyForEvent('SessionStart', payload)).toBeNull();
  });
});

describe('nostr-live-mirror.composeBody — REC-9 reference within the cap', () => {
  const urn = 'urn:agentbox:activity:' + '0'.repeat(64) + ':sha256-12-deadbeef1234';

  test('a huge turn text + urn stays within MAX_BODY_CHARS AND keeps the full urn', () => {
    const huge = 'x'.repeat(mirror.MAX_BODY_CHARS * 3);
    const out = mirror.composeBody(huge, urn);
    expect(out.length).toBeLessThanOrEqual(mirror.MAX_BODY_CHARS);
    expect(out).toContain(urn); // the reference is never truncated
    expect(out.endsWith(urn)).toBe(true); // it rides at the end, after the (truncated) text
  });

  test('a short turn text + urn carries both, reference last', () => {
    const out = mirror.composeBody('🧑 [abcd1234] fix the parser', urn);
    expect(out).toContain('fix the parser');
    expect(out).toContain(urn);
    expect(out.length).toBeLessThanOrEqual(mirror.MAX_BODY_CHARS);
  });

  test('FALSIFICATION 4: no urn → text-only, original cap behaviour (fail-open)', () => {
    const out = mirror.composeBody('a plain turn with no provenance', '');
    expect(out).toBe('a plain turn with no provenance');
    expect(out).not.toContain('urn:agentbox');
  });

  test('no urn + over-cap text → truncates to the cap, still text-only', () => {
    const huge = 'y'.repeat(mirror.MAX_BODY_CHARS * 2);
    const out = mirror.composeBody(huge, '');
    expect(out.length).toBeLessThanOrEqual(mirror.MAX_BODY_CHARS + 1); // +1 for the ellipsis
    expect(out).not.toContain('urn:agentbox');
  });
});

describe('nostr-live-mirror.mintActivityUrn — REC-9 resolvable reference', () => {
  test('mints a canonical urn:agentbox:activity from the session id', () => {
    const urn = mirror.mintActivityUrn(uris, { session_id: 'sess-abc-123' });
    expect(urn).toMatch(/^urn:agentbox:activity:/);
    expect(uris.isCanonical(urn)).toBe(true);
    const parsed = uris.parse(urn);
    expect(parsed.kind).toBe('activity');
  });

  test('FALSIFICATION 2: the reference resolves to the agent-events (activity) surface', () => {
    const urn = mirror.mintActivityUrn(uris, { session_id: 'sess-resolve-me' });
    const url = uris.resolveCanonical(urn, { managementApiBase: 'http://127.0.0.1:9090' });
    // The activity kind resolves through the management-api URI resolver, which
    // 307-redirects /v1/uri/<urn> → /v1/agent-events?id=<urn> (uri-resolver.js).
    expect(url).toContain('/v1/uri/');
    expect(url).toContain('surface=agent-events');
  });

  test('deterministic: same session id + scope → same urn (both egress paths converge)', () => {
    const a = mirror.mintActivityUrn(uris, { session_id: 'stable-session' });
    const b = mirror.mintActivityUrn(uris, { session_id: 'stable-session' });
    expect(a).toBe(b);
  });

  test('FALSIFICATION 4: no session id → "" (fail-open, text-only)', () => {
    expect(mirror.mintActivityUrn(uris, {})).toBe('');
    expect(mirror.mintActivityUrn(uris, { session_id: '   ' })).toBe('');
  });

  test('uris minter unavailable → "" (fail-open, never throws)', () => {
    expect(mirror.mintActivityUrn(null, { session_id: 'x' })).toBe('');
    expect(mirror.mintActivityUrn({}, { session_id: 'x' })).toBe('');
  });
});
