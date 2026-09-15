'use strict';

/**
 * Unit tests for management-api/lib/junkiejarvis-clarify — the
 * clarify-before-acting gate (ADR-2088).
 *
 * Everything under test is PURE: the clarity check, the question generator, the
 * DM body composer, the awaiting-clarification state machine, and the reply
 * matcher. No relay, no LLM, no key material, no clock — `now` is always passed
 * in so the 7-day expiry is deterministic.
 */

const clarify = require('../../management-api/lib/junkiejarvis-clarify');

const {
  // pure clarity check
  assessClarity,
  clarityQuestions,
  specificityScore,
  looksLikeBugReport,
  hasReproSteps,
  hasSurface,
  hasConcreteTarget,
  composeClarificationDm,
  // state machine
  emptyClarifyState,
  openClarification,
  findPending,
  shouldSendClarification,
  applyReply,
  expireStale,
  matchReplyToPending,
  composeForRecheck,
  // config
  clarifyBeforeActingEnabled,
  // constants
  CLARIFY_EXPIRY_MS,
  MIN_SPECIFICITY,
  MAX_QUESTIONS,
  MISSING_CODES,
} = clarify;

const AUTHOR = 'b'.repeat(64);
const OTHER = 'c'.repeat(64);
const JJ = '2de44d5622eef79519ac078f6e227a85aecbaefd561e4e50c5f51dfadbf916e9';
const T0 = Date.parse('2026-09-01T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const post = (content, over = {}) => ({
  id: 'e'.repeat(64),
  pubkey: AUTHOR,
  content,
  created_at: Math.floor(T0 / 1000),
  ...over,
});

// ───────────────────────────────────────────────────────────────────────────
// Clarity check — table tests
// ───────────────────────────────────────────────────────────────────────────

describe('assessClarity — table', () => {
  // [name, text, expectedClear, expectedMissingSubset]
  const CASES = [
    [
      'vague one-liner',
      'it is broken, please fix',
      false,
      ['repro', 'surface', 'target'],
    ],
    [
      'pronoun-only target',
      'this thing does not work on my end, can you sort it out sometime',
      false,
      ['target'],
    ],
    [
      'bug with repro but no surface',
      'The upload fails. Steps: 1. open the editor 2. drag a 4MB png 3. it returns a 500 error every time.',
      false,
      ['surface'],
    ],
    [
      'bug with surface but no repro',
      'The calendar page on the web forum is broken for me in Chrome, throws an error.',
      false,
      ['repro'],
    ],
    [
      'complete bug report',
      'Bug on the web forum in Chrome 140: the /events calendar page throws a 500. Steps to reproduce: 1. sign in 2. open /community/events 3. click "next month". Expected the June grid, got a blank page.',
      true,
      [],
    ],
    [
      'clear feature suggestion (repro not required)',
      'Suggestion for the web forum: add a "copy link" button to the top-right of each thread header on the /community/forums pages, so members can share a permalink without opening the browser address bar.',
      true,
      [],
    ],
    [
      'short feature suggestion, too vague',
      'add dark mode please',
      false,
      ['specificity'],
    ],
    [
      'empty content',
      '',
      false,
      ['specificity', 'target'],
    ],
    [
      'whitespace only',
      '   \n  ',
      false,
      ['specificity', 'target'],
    ],
    [
      'long rambling with no concrete anchor',
      'I have been thinking about this for a while and honestly something feels off about the whole experience, it could be better somehow, maybe you could look at improving things generally when you get a chance because it is not great at the moment and people have mentioned it too.',
      false,
      ['target'],
    ],
  ];

  test.each(CASES)('%s', (_name, text, expectedClear, expectedMissing) => {
    const a = assessClarity(post(text));
    expect(a.clear).toBe(expectedClear);
    for (const code of expectedMissing) expect(a.missing).toContain(code);
    if (expectedClear) expect(a.missing).toHaveLength(0);
  });

  test('is deterministic — same input, same output', () => {
    const p = post('it is broken, please fix');
    expect(assessClarity(p)).toEqual(assessClarity(p));
  });

  test('never throws on malformed input', () => {
    for (const bad of [null, undefined, {}, { content: 42 }, { content: [] }, 'string']) {
      const a = assessClarity(bad);
      expect(a.clear).toBe(false);
      expect(Array.isArray(a.missing)).toBe(true);
      expect(Array.isArray(a.questions)).toBe(true);
    }
  });

  test('every missing code is a known code', () => {
    const a = assessClarity(post('it broke'));
    for (const code of a.missing) expect(MISSING_CODES).toContain(code);
  });

  test('score is a finite 0..1 number', () => {
    for (const t of ['', 'x', 'add dark mode please', 'a '.repeat(500)]) {
      const s = specificityScore(t);
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  test('MIN_SPECIFICITY is the documented threshold', () => {
    expect(specificityScore('add dark mode please')).toBeLessThan(MIN_SPECIFICITY);
    expect(
      specificityScore(
        'Bug on the web forum in Chrome 140: the /events calendar page throws a 500 after clicking "next month".'
      )
    ).toBeGreaterThanOrEqual(MIN_SPECIFICITY);
  });
});

describe('clarity signal helpers', () => {
  test('looksLikeBugReport', () => {
    expect(looksLikeBugReport('the page crashes with a 500 error')).toBe(true);
    expect(looksLikeBugReport('it is broken')).toBe(true);
    expect(looksLikeBugReport('doesn\'t work when I click save')).toBe(true);
    expect(looksLikeBugReport('please add a dark mode toggle')).toBe(false);
    expect(looksLikeBugReport('')).toBe(false);
  });

  test('hasReproSteps', () => {
    expect(hasReproSteps('steps to reproduce: 1. open 2. click')).toBe(true);
    expect(hasReproSteps('1. open the editor\n2. drag a file\n3. boom')).toBe(true);
    expect(hasReproSteps('when I click save it errors every time')).toBe(true);
    expect(hasReproSteps('it is broken')).toBe(false);
  });

  test('hasSurface', () => {
    expect(hasSurface('on android')).toBe(true);
    expect(hasSurface('in the web forum')).toBe(true);
    expect(hasSurface('the CLI hangs')).toBe(true);
    expect(hasSurface('on my phone')).toBe(true);
    expect(hasSurface('it is broken')).toBe(false);
  });

  test('hasConcreteTarget', () => {
    expect(hasConcreteTarget('the /community/events page')).toBe(true);
    expect(hasConcreteTarget('the "next month" button')).toBe(true);
    expect(hasConcreteTarget('`nostr-bridge.js` throws')).toBe(true);
    expect(hasConcreteTarget('https://dreamlab-ai.com/events is blank')).toBe(true);
    expect(hasConcreteTarget('this thing does not work')).toBe(false);
    expect(hasConcreteTarget('it is broken, please fix')).toBe(false);
  });
});

describe('clarityQuestions', () => {
  test('returns 1..MAX_QUESTIONS concrete questions when unclear', () => {
    const a = assessClarity(post('it is broken, please fix'));
    expect(a.questions.length).toBeGreaterThanOrEqual(1);
    expect(a.questions.length).toBeLessThanOrEqual(MAX_QUESTIONS);
    for (const q of a.questions) {
      expect(typeof q).toBe('string');
      expect(q.trim().length).toBeGreaterThan(10);
      expect(q.trim().endsWith('?')).toBe(true);
    }
  });

  test('returns no questions when clear', () => {
    const a = assessClarity(
      post(
        'Bug on the web forum in Chrome 140: the /events calendar page throws a 500. Steps to reproduce: 1. sign in 2. open /community/events 3. click "next month". Expected the June grid, got a blank page.'
      )
    );
    expect(a.questions).toEqual([]);
  });

  test('question order follows the fixed priority repro > target > surface > specificity', () => {
    const qs = clarityQuestions(['specificity', 'surface', 'target', 'repro']);
    expect(qs).toHaveLength(MAX_QUESTIONS);
    expect(qs[0]).toMatch(/step/i);
    expect(qs[1]).toMatch(/which|where exactly|name/i);
  });

  test('is deduplicated and stable', () => {
    expect(clarityQuestions(['repro', 'repro', 'repro'])).toHaveLength(1);
    expect(clarityQuestions([])).toEqual([]);
    expect(clarityQuestions(null)).toEqual([]);
  });
});

describe('composeClarificationDm', () => {
  test('includes every question, numbered, and never leaks internals', () => {
    const a = assessClarity(post('it is broken, please fix'));
    const dm = composeClarificationDm(post('it is broken, please fix'), a);
    expect(typeof dm).toBe('string');
    for (const q of a.questions) expect(dm).toContain(q);
    expect(dm).toMatch(/1\./);
    expect(dm).not.toMatch(/system prompt|privkey|PRIVKEY|specificity score/i);
    expect(dm.length).toBeLessThanOrEqual(900);
  });

  test('is a no-op safe string for a clear item', () => {
    expect(composeClarificationDm(post('x'), { clear: true, questions: [] })).toBe('');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// awaiting-clarification state machine
// ───────────────────────────────────────────────────────────────────────────

describe('clarification state machine', () => {
  const ITEM = 'f'.repeat(64);

  test('emptyClarifyState is an empty pending map', () => {
    const s = emptyClarifyState();
    expect(s).toEqual({ pending: {} });
    expect(findPending(s, ITEM)).toBeNull();
  });

  test('openClarification records status, questions, dm event id and timestamps', () => {
    const s = openClarification(emptyClarifyState(), {
      itemId: ITEM,
      pubkey: AUTHOR,
      questions: ['What exactly broke?'],
      dmEventId: 'd'.repeat(64),
      text: 'it is broken',
      now: T0,
    });
    const p = findPending(s, ITEM);
    expect(p.status).toBe('awaiting-clarification');
    expect(p.pubkey).toBe(AUTHOR);
    expect(p.questions).toEqual(['What exactly broke?']);
    expect(p.dmEventId).toBe('d'.repeat(64));
    expect(p.askedAt).toBe(T0);
    expect(p.dmCount).toBe(1);
    expect(p.replies).toEqual([]);
  });

  test('does not mutate the input state', () => {
    const before = emptyClarifyState();
    const snapshot = JSON.stringify(before);
    openClarification(before, { itemId: ITEM, pubkey: AUTHOR, questions: ['q?'], dmEventId: 'x', now: T0 });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  test('rate limit: one clarification DM per item', () => {
    const s0 = emptyClarifyState();
    expect(shouldSendClarification(s0, ITEM)).toBe(true);
    const s1 = openClarification(s0, { itemId: ITEM, pubkey: AUTHOR, questions: ['q?'], dmEventId: 'x', now: T0 });
    expect(shouldSendClarification(s1, ITEM)).toBe(false);
    // a second open must not increment past 1 nor re-arm the DM
    const s2 = openClarification(s1, { itemId: ITEM, pubkey: AUTHOR, questions: ['q2?'], dmEventId: 'y', now: T0 + 1000 });
    expect(findPending(s2, ITEM).dmCount).toBe(1);
    expect(findPending(s2, ITEM).dmEventId).toBe('x');
    expect(shouldSendClarification(s2, ITEM)).toBe(false);
  });

  test('applyReply appends the reply and marks the item resumable', () => {
    const s1 = openClarification(emptyClarifyState(), {
      itemId: ITEM, pubkey: AUTHOR, questions: ['q?'], dmEventId: 'x', text: 'it is broken', now: T0,
    });
    const { state, resumed } = applyReply(s1, {
      itemId: ITEM,
      replyText: 'On the web forum in Chrome. Steps: 1. open /events 2. click next month 3. blank page.',
      replyEventId: 'r'.repeat(64),
      now: T0 + DAY,
    });
    expect(resumed).toBe(true);
    const p = findPending(state, ITEM);
    expect(p.status).toBe('clarified');
    expect(p.replies).toHaveLength(1);
    expect(p.replies[0].eventId).toBe('r'.repeat(64));
    expect(p.repliedAt).toBe(T0 + DAY);
  });

  test('applyReply on an unknown item is a fail-open no-op', () => {
    const { state, resumed } = applyReply(emptyClarifyState(), {
      itemId: ITEM, replyText: 'hi', replyEventId: 'r', now: T0,
    });
    expect(resumed).toBe(false);
    expect(findPending(state, ITEM)).toBeNull();
  });

  test('applyReply on an expired item does not resume it', () => {
    const s1 = openClarification(emptyClarifyState(), {
      itemId: ITEM, pubkey: AUTHOR, questions: ['q?'], dmEventId: 'x', now: T0,
    });
    const { state: stale } = expireStale(s1, T0 + CLARIFY_EXPIRY_MS + 1);
    const { resumed } = applyReply(stale, { itemId: ITEM, replyText: 'late', replyEventId: 'r', now: T0 + 8 * DAY });
    expect(resumed).toBe(false);
  });

  test('expireStale flips to stale exactly after 7 days, not before', () => {
    const s1 = openClarification(emptyClarifyState(), {
      itemId: ITEM, pubkey: AUTHOR, questions: ['q?'], dmEventId: 'x', now: T0,
    });
    expect(CLARIFY_EXPIRY_MS).toBe(7 * DAY);

    const notYet = expireStale(s1, T0 + CLARIFY_EXPIRY_MS - 1);
    expect(notYet.expired).toEqual([]);
    expect(findPending(notYet.state, ITEM).status).toBe('awaiting-clarification');

    const now = expireStale(s1, T0 + CLARIFY_EXPIRY_MS);
    expect(now.expired).toEqual([ITEM]);
    expect(findPending(now.state, ITEM).status).toBe('stale');
    expect(findPending(now.state, ITEM).staleAt).toBe(T0 + CLARIFY_EXPIRY_MS);
  });

  test('expireStale never re-expires or touches clarified items', () => {
    const s1 = openClarification(emptyClarifyState(), {
      itemId: ITEM, pubkey: AUTHOR, questions: ['q?'], dmEventId: 'x', now: T0,
    });
    const { state: s2 } = applyReply(s1, { itemId: ITEM, replyText: 'ok', replyEventId: 'r', now: T0 + DAY });
    const { state: s3, expired } = expireStale(s2, T0 + 30 * DAY);
    expect(expired).toEqual([]);
    expect(findPending(s3, ITEM).status).toBe('clarified');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// reply matching
// ───────────────────────────────────────────────────────────────────────────

describe('matchReplyToPending', () => {
  const ITEM = 'f'.repeat(64);
  const DM_ID = 'd'.repeat(64);
  const base = openClarification(emptyClarifyState(), {
    itemId: ITEM, pubkey: AUTHOR, questions: ['q?'], dmEventId: DM_ID, now: T0,
  });
  const rumor = (over = {}) => ({
    id: 'r'.repeat(64),
    pubkey: AUTHOR,
    kind: 14,
    content: 'here are the details',
    created_at: Math.floor((T0 + DAY) / 1000),
    tags: [['p', JJ]],
    ...over,
  });

  test('matches by author pubkey when the reply is newer than the DM', () => {
    expect(matchReplyToPending(base, rumor())).toBe(ITEM);
  });

  test('matches by explicit e-tag thread reference even from an older clock', () => {
    const ev = rumor({ created_at: Math.floor(T0 / 1000) - 10, tags: [['p', JJ], ['e', DM_ID]] });
    expect(matchReplyToPending(base, ev)).toBe(ITEM);
  });

  test('does not match a different pubkey', () => {
    expect(matchReplyToPending(base, rumor({ pubkey: OTHER }))).toBeNull();
  });

  test('does not match a reply older than the clarification DM', () => {
    expect(matchReplyToPending(base, rumor({ created_at: Math.floor(T0 / 1000) - 60 }))).toBeNull();
  });

  test('does not match once the item is clarified or stale', () => {
    const { state: clarified } = applyReply(base, { itemId: ITEM, replyText: 'x', replyEventId: 'r', now: T0 + DAY });
    expect(matchReplyToPending(clarified, rumor())).toBeNull();
    const { state: stale } = expireStale(base, T0 + CLARIFY_EXPIRY_MS);
    expect(matchReplyToPending(stale, rumor())).toBeNull();
  });

  test('ignores empty and malformed events', () => {
    for (const bad of [null, undefined, {}, { pubkey: AUTHOR }, { pubkey: AUTHOR, content: '   ' }]) {
      expect(matchReplyToPending(base, bad)).toBeNull();
    }
  });

  test('picks the OLDEST matching pending item when the author has several', () => {
    const ITEM2 = '9'.repeat(64);
    const two = openClarification(base, {
      itemId: ITEM2, pubkey: AUTHOR, questions: ['q2?'], dmEventId: 'e2', now: T0 + 2 * DAY,
    });
    expect(matchReplyToPending(two, rumor({ created_at: Math.floor((T0 + 3 * DAY) / 1000) }))).toBe(ITEM);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// re-check with the reply appended
// ───────────────────────────────────────────────────────────────────────────

describe('composeForRecheck + re-run of the clarity check', () => {
  const ITEM = 'f'.repeat(64);
  const ORIGINAL = 'the calendar is broken';

  test('appends replies to the original text in order', () => {
    const text = composeForRecheck(ORIGINAL, [
      { text: 'on the web forum in Chrome' },
      { text: 'steps: 1. open /events 2. click next month 3. blank page' },
    ]);
    expect(text.startsWith(ORIGINAL)).toBe(true);
    expect(text).toContain('Chrome');
    expect(text.indexOf('Chrome')).toBeLessThan(text.indexOf('blank page'));
  });

  test('an unclear item becomes clear once the reply supplies the missing detail', () => {
    const before = assessClarity(post(ORIGINAL));
    expect(before.clear).toBe(false);

    const merged = composeForRecheck(ORIGINAL, [
      {
        text:
          'It is the web forum in Chrome 140, the /community/events page. Steps to reproduce: 1. sign in 2. open /community/events 3. click "next month". Expected the June grid, got a blank page.',
      },
    ]);
    expect(assessClarity(post(merged)).clear).toBe(true);
  });

  test('a waffly reply leaves the item unclear (no free pass for replying)', () => {
    const merged = composeForRecheck(ORIGINAL, [{ text: 'yeah it is just generally not great' }]);
    expect(assessClarity(post(merged)).clear).toBe(false);
  });

  test('handles empty/malformed reply lists', () => {
    expect(composeForRecheck(ORIGINAL, null)).toBe(ORIGINAL);
    expect(composeForRecheck(ORIGINAL, [])).toBe(ORIGINAL);
    expect(composeForRecheck(ORIGINAL, [{}, { text: '' }, null])).toBe(ORIGINAL);
    expect(composeForRecheck(null, [{ text: 'x' }])).toContain('x');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// manifest gate
// ───────────────────────────────────────────────────────────────────────────

describe('clarifyBeforeActingEnabled', () => {
  test('defaults to true when nothing is configured', () => {
    expect(clarifyBeforeActingEnabled({}, {})).toBe(true);
    expect(clarifyBeforeActingEnabled(null, null)).toBe(true);
  });

  test('manifest key turns it off', () => {
    expect(
      clarifyBeforeActingEnabled({ sovereign_mesh: { junkiejarvis_clarify_before_acting: false } }, {})
    ).toBe(false);
    expect(
      clarifyBeforeActingEnabled({ sovereign_mesh: { junkiejarvis_clarify_before_acting: true } }, {})
    ).toBe(true);
  });

  test('env var is the runtime override, as everywhere else in the mesh', () => {
    const m = { sovereign_mesh: { junkiejarvis_clarify_before_acting: true } };
    expect(clarifyBeforeActingEnabled(m, { JUNKIEJARVIS_CLARIFY_BEFORE_ACTING: 'false' })).toBe(false);
    expect(clarifyBeforeActingEnabled(m, { JUNKIEJARVIS_CLARIFY_BEFORE_ACTING: '0' })).toBe(false);
    expect(
      clarifyBeforeActingEnabled({ sovereign_mesh: { junkiejarvis_clarify_before_acting: false } }, {
        JUNKIEJARVIS_CLARIFY_BEFORE_ACTING: 'true',
      })
    ).toBe(true);
  });

  test('a junk env value falls through to the manifest rather than failing closed', () => {
    expect(clarifyBeforeActingEnabled({}, { JUNKIEJARVIS_CLARIFY_BEFORE_ACTING: 'banana' })).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The full gate sequence the nightly tenant implements
// ───────────────────────────────────────────────────────────────────────────

describe('clarify-before-acting lifecycle', () => {
  const ITEM = '7'.repeat(64);

  test('unclear → DM → parked → reply → clear → actionable', () => {
    const original = 'the calendar is broken, please fix';

    // 1. Unclear: the tenant must NOT triage.
    const first = assessClarity(post(original, { id: ITEM }));
    expect(first.clear).toBe(false);
    expect(first.questions.length).toBeGreaterThan(0);

    // 2. Park it with the DM event id.
    let state = openClarification(emptyClarifyState(), {
      itemId: ITEM, pubkey: AUTHOR, questions: first.questions,
      dmEventId: 'd'.repeat(64), text: original, now: T0,
    });
    expect(findPending(state, ITEM).status).toBe('awaiting-clarification');
    expect(shouldSendClarification(state, ITEM)).toBe(false); // never a second DM

    // 3. The author replies two days later; it matches by pubkey + recency.
    const reply = {
      id: 'r'.repeat(64), pubkey: AUTHOR, kind: 14, tags: [['p', JJ]],
      content: 'Web forum in Chrome 140, the /community/events page. Steps: 1. sign in 2. open /community/events 3. click "next month". Expected the June grid, got a blank page.',
      created_at: Math.floor((T0 + 2 * DAY) / 1000),
    };
    expect(matchReplyToPending(state, reply)).toBe(ITEM);
    ({ state } = applyReply(state, {
      itemId: ITEM, replyText: reply.content, replyEventId: reply.id, now: T0 + 2 * DAY,
    }));

    // 4. Re-run the SAME check with the reply appended — now actionable.
    const merged = composeForRecheck(original, findPending(state, ITEM).replies);
    expect(assessClarity(post(merged)).clear).toBe(true);
  });

  test('silence for 7 days ends in stale, never in action', () => {
    let state = openClarification(emptyClarifyState(), {
      itemId: ITEM, pubkey: AUTHOR, questions: ['q?'], dmEventId: 'd', text: 'vague', now: T0,
    });
    ({ state } = expireStale(state, T0 + CLARIFY_EXPIRY_MS));
    expect(findPending(state, ITEM).status).toBe('stale');
    // A late reply cannot revive it, and no second DM is ever armed.
    expect(matchReplyToPending(state, {
      id: 'r', pubkey: AUTHOR, kind: 14, content: 'sorry, late', created_at: Math.floor((T0 + 9 * DAY) / 1000), tags: [],
    })).toBeNull();
    expect(shouldSendClarification(state, ITEM)).toBe(false);
  });

  test('a reply that is still vague does not unlock action', () => {
    let state = openClarification(emptyClarifyState(), {
      itemId: ITEM, pubkey: AUTHOR, questions: ['q?'], dmEventId: 'd', text: 'it broke', now: T0,
    });
    ({ state } = applyReply(state, {
      itemId: ITEM, replyText: 'yeah just generally not great', replyEventId: 'r', now: T0 + DAY,
    }));
    const merged = composeForRecheck('it broke', findPending(state, ITEM).replies);
    expect(assessClarity(post(merged)).clear).toBe(false);
    // and the rate limit still holds — no second grilling.
    expect(shouldSendClarification(state, ITEM)).toBe(false);
  });
});
