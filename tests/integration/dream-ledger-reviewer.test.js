'use strict';

/**
 * dream-ledger reviewer columns — PRD-augmentation-conditions FR6.6,
 * EXP-AC-006: "The dream-cycle ledger schema gains `Reviewer` and
 * `Review-minutes` columns, populated from the PR merge event."
 *
 * Conditions C4 (deepening learning) and C6 (job purpose) are LONGITUDINAL:
 * they need a measurement, repeated. The dream cycle already measures the
 * agent's side of every night — finding, verdict, effect, witness — and
 * measures nothing at all about the human who reviewed the PR it opened. These
 * two columns are the first human measurement in that ledger.
 *
 * Backward compatibility is not optional: every existing ledger in the estate
 * is 10 columns wide, and a parser that drops those rows would delete the
 * baseline the longitudinal reading depends on.
 */

const {
  LEDGER_KEYS,
  LEGACY_LEDGER_KEYS,
  parseLedger,
  reviewFromMergeEvent,
  reviewerStats,
} = require('../../management-api/lib/dream-ledger');

const HEADER12 = '| Date | Deep | Finding | Issue | PR | Evaluated? | Verdict | Effect | Witness | Prior-night fates | Reviewer | Review-minutes |';
const SEP12 = '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';
const HEADER10 = '| Date | Deep | Finding | Issue | PR | Evaluated? | Verdict | Effect | Witness | Prior-night fates |';
const SEP10 = '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';

const row12 = (date, reviewer, minutes, verdict = 'ACCEPT') =>
  `| ${date} | deep | finding | #1 | #7 | yes | ${verdict} |  | abc123 | #7:MERGED | ${reviewer} | ${minutes} |`;
const row10 = (date, verdict = 'ACCEPT') =>
  `| ${date} | deep | finding | #1 | #7 | yes | ${verdict} |  | abc123 |  |`;

const ledger = (header, sep, rows) => [header, sep, ...rows].join('\n') + '\n';

describe('the 12-column row schema', () => {
  test('LEDGER_KEYS gains reviewer and reviewMinutes, in that order, at the end', () => {
    expect(LEDGER_KEYS).toEqual([
      'date', 'deep', 'finding', 'issue', 'pr', 'evaluated', 'verdict', 'effect',
      'witness', 'priorFates', 'reviewer', 'reviewMinutes',
    ]);
    // The legacy order is preserved exactly — the new columns are APPENDED, so
    // every existing row's cells still land on the same keys.
    expect(LEDGER_KEYS.slice(0, 10)).toEqual(LEGACY_LEDGER_KEYS);
  });
});

describe('parsing', () => {
  test('a 12-column row yields the reviewer and review minutes', () => {
    const { rows } = parseLedger(ledger(HEADER12, SEP12, [row12('2026-09-14', 'jjohare', '42')]));
    expect(rows).toHaveLength(1);
    expect(rows[0].reviewer).toBe('jjohare');
    expect(rows[0].reviewMinutes).toBe(42);
  });

  test('a did:nostr reviewer is preserved verbatim', () => {
    const did = 'did:nostr:' + 'a'.repeat(64);
    const { rows } = parseLedger(ledger(HEADER12, SEP12, [row12('2026-09-14', did, '7')]));
    expect(rows[0].reviewer).toBe(did);
  });

  test('BACKWARD COMPATIBILITY: a legacy 10-column row parses with both fields null', () => {
    const { rows } = parseLedger(ledger(HEADER10, SEP10, [row10('2026-08-16'), row10('2026-08-17', 'REJECT')]));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: '2026-08-16', verdict: 'ACCEPT', reviewer: null, reviewMinutes: null });
    expect(rows[1].reviewMinutes).toBeNull();
  });

  test('a 12-column ledger and a 10-column ledger can be read as one series', () => {
    const md = ledger(HEADER10, SEP10, [row10('2026-08-16')])
      + row12('2026-09-14', 'jjohare', '18') + '\n';
    const { rows } = parseLedger(md);
    expect(rows.map(r => r.reviewer)).toEqual([null, 'jjohare']);
  });

  test('ABSENCE RENDERS AS ABSENCE: empty / placeholder cells are null, never 0 or ""', () => {
    const md = ledger(HEADER12, SEP12, [
      row12('2026-09-14', '', ''),
      row12('2026-09-15', '—', '—'),
      row12('2026-09-16', 'NONE', 'n/a'),
      row12('2026-09-17', '-', '-'),
    ]);
    const { rows } = parseLedger(md);
    for (const r of rows) {
      expect(r.reviewer).toBeNull();
      expect(r.reviewMinutes).toBeNull();
    }
  });

  test('a non-numeric review-minutes cell is null, not NaN', () => {
    const { rows } = parseLedger(ledger(HEADER12, SEP12, [row12('2026-09-14', 'jjohare', 'about an hour')]));
    expect(rows[0].reviewer).toBe('jjohare');
    expect(rows[0].reviewMinutes).toBeNull();
  });

  test('a negative review-minutes cell is rejected — a merge cannot precede its PR', () => {
    const { rows } = parseLedger(ledger(HEADER12, SEP12, [row12('2026-09-14', 'jjohare', '-5')]));
    expect(rows[0].reviewMinutes).toBeNull();
  });

  test('a row shorter than the legacy width is still skipped', () => {
    const md = ledger(HEADER12, SEP12, [row12('2026-09-14', 'jjohare', '5'), '| too | few | cols |']);
    expect(parseLedger(md).rows).toHaveLength(1);
  });
});

describe('reviewFromMergeEvent', () => {
  test('a merged PR yields the merging identity and the elapsed review minutes', () => {
    expect(reviewFromMergeEvent({
      merged_by: 'jjohare',
      pr_opened_at: '2026-09-14T09:00:00Z',
      merged_at: '2026-09-14T10:30:00Z',
    })).toEqual({ reviewer: 'jjohare', reviewMinutes: 90 });
  });

  test('a did:nostr merger is preserved; a login object is read by `login`', () => {
    expect(reviewFromMergeEvent({
      merged_by: { login: 'jjohare' },
      pr_opened_at: '2026-09-14T09:00:00Z', merged_at: '2026-09-14T09:05:00Z',
    })).toEqual({ reviewer: 'jjohare', reviewMinutes: 5 });
    const did = 'did:nostr:' + 'b'.repeat(64);
    expect(reviewFromMergeEvent({
      merged_by: { did }, pr_opened_at: '2026-09-14T09:00:00Z', merged_at: '2026-09-14T09:05:00Z',
    }).reviewer).toBe(did);
  });

  test('minutes round to the nearest whole minute', () => {
    expect(reviewFromMergeEvent({
      merged_by: 'x', pr_opened_at: '2026-09-14T09:00:00Z', merged_at: '2026-09-14T09:00:40Z',
    }).reviewMinutes).toBe(1);
    expect(reviewFromMergeEvent({
      merged_by: 'x', pr_opened_at: '2026-09-14T09:00:00Z', merged_at: '2026-09-14T09:00:20Z',
    }).reviewMinutes).toBe(0);
  });

  test('NEVER FABRICATED: an unmerged, absent or unparseable event yields nulls', () => {
    const empty = { reviewer: null, reviewMinutes: null };
    expect(reviewFromMergeEvent(null)).toEqual(empty);
    expect(reviewFromMergeEvent({})).toEqual(empty);
    expect(reviewFromMergeEvent({ merged_by: 'jjohare' })).toEqual({ reviewer: 'jjohare', reviewMinutes: null });
    expect(reviewFromMergeEvent({ pr_opened_at: '2026-09-14T09:00:00Z', merged_at: '2026-09-14T10:00:00Z' }))
      .toEqual({ reviewer: null, reviewMinutes: 60 });
    expect(reviewFromMergeEvent({ merged_by: 'x', pr_opened_at: 'nonsense', merged_at: '2026-09-14T10:00:00Z' }))
      .toEqual({ reviewer: 'x', reviewMinutes: null });
  });

  test('a merge recorded BEFORE the PR opened is refused rather than negated', () => {
    expect(reviewFromMergeEvent({
      merged_by: 'x', pr_opened_at: '2026-09-14T10:00:00Z', merged_at: '2026-09-14T09:00:00Z',
    }).reviewMinutes).toBeNull();
  });
});

describe('reviewerStats — the human measurement', () => {
  test('counts reviews and reports median minutes per reviewer', () => {
    const { rows } = parseLedger(ledger(HEADER12, SEP12, [
      row12('2026-09-10', 'jjohare', '10'),
      row12('2026-09-11', 'jjohare', '30'),
      row12('2026-09-12', 'jjohare', '20'),
      row12('2026-09-13', 'someone-else', '5'),
    ]));
    const stats = reviewerStats(rows);
    expect(stats.reviewers.jjohare).toEqual({ reviews: 3, medianReviewMinutes: 20, measuredMinutes: 3 });
    expect(stats.reviewers['someone-else'].reviews).toBe(1);
    expect(stats.reviewed).toBe(4);
    expect(stats.unreviewed).toBe(0);
  });

  test('an even count takes the mean of the two middle values', () => {
    const { rows } = parseLedger(ledger(HEADER12, SEP12, [
      row12('2026-09-10', 'jjohare', '10'), row12('2026-09-11', 'jjohare', '30'),
    ]));
    expect(reviewerStats(rows).reviewers.jjohare.medianReviewMinutes).toBe(20);
  });

  test('legacy rows count as UNREVIEWED, not as a reviewer named ""', () => {
    const { rows } = parseLedger(ledger(HEADER10, SEP10, [row10('2026-08-16'), row10('2026-08-17')]));
    const stats = reviewerStats(rows);
    expect(stats.reviewed).toBe(0);
    expect(stats.unreviewed).toBe(2);
    expect(Object.keys(stats.reviewers)).toHaveLength(0);
  });

  test('a reviewer with no timing yields a null median, never a zero', () => {
    const { rows } = parseLedger(ledger(HEADER12, SEP12, [row12('2026-09-10', 'jjohare', '')]));
    expect(reviewerStats(rows).reviewers.jjohare).toEqual({
      reviews: 1, medianReviewMinutes: null, measuredMinutes: 0,
    });
  });

  test('tolerates an empty row set', () => {
    expect(reviewerStats([])).toEqual({ reviewers: {}, reviewed: 0, unreviewed: 0 });
    expect(reviewerStats(null)).toEqual({ reviewers: {}, reviewed: 0, unreviewed: 0 });
  });
});
